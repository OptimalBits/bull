/*eslint-env node */
'use strict';

var Promise = require('bluebird');
var _ = require('lodash');
var utils = require('./utils');
var scripts = require('./scripts');
var debuglog = require('debuglog')('bull');
var errors = require('./errors');
var backoffs = require('./backoffs');

var FINISHED_WATCHDOG = 5000;

/**
interface JobOptions
{
  priority: Priority;
  attempts: number;
  delay: number;
}
*/

// queue: Queue, data: {}, opts: JobOptions
var Job = function(queue, name, data, opts) {
  if (typeof name !== 'string') {
    opts = data;
    data = name;
    name = '__default__';
  }

  // defaults
  this.opts = setDefaultOpts(opts);

  this.name = name;
  this.queue = queue;
  this.data = data;
  this._progress = 0;
  this.delay = this.opts.delay;
  this.timestamp = this.opts.timestamp;
  this.stacktrace = [];
  this.returnvalue = null;
  this.attemptsMade = 0;

  this.toKey = _.bind(queue.toKey, queue);
};

function setDefaultOpts(opts) {
  var _opts = Object.assign({}, opts);

  _opts.attempts = typeof _opts.attempts == 'undefined' ? 1 : _opts.attempts;
  _opts.delay = typeof _opts.delay == 'undefined' ? 0 : _opts.delay;
  _opts.timestamp =
    typeof _opts.timestamp == 'undefined' ? Date.now() : _opts.timestamp;

  _opts.attempts = parseInt(_opts.attempts);
  _opts.backoff = backoffs.normalize(_opts.backoff);

  return _opts;
}

Job.DEFAULT_JOB_NAME = '__default__';

function addJob(queue, job) {
  var opts = job.opts;

  var jobData = job.toData();
  return scripts.addJob(
    queue.client,
    queue,
    jobData,
    {
      lifo: opts.lifo,
      customJobId: opts.jobId,
      priority: opts.priority
    },
    queue.token
  );
}

Job.create = function(queue, name, data, opts) {
  var job = new Job(queue, name, data, opts);

  return queue
    .isReady()
    .then(function() {
      return addJob(queue, job);
    })
    .then(function(jobId) {
      job.id = jobId;
      job.lockKey = job.toKey(jobId) + ':lock';
      debuglog('Job added', jobId);
      return job;
    });
};

Job.fromId = function(queue, jobId) {
  // jobId can be undefined if moveJob returns undefined
  if (!jobId) {
    return Promise.resolve();
  }
  return queue.client.hgetall(queue.toKey(jobId)).then(function(jobData) {
    return utils.isEmpty(jobData) ? null : Job.fromJSON(queue, jobData, jobId);
  });
};

Job.prototype.progress = function(progress) {
  if (_.isUndefined(progress)) {
    return this._progress;
  }
  this._progress = progress;
  return scripts.updateProgress(this, progress);
};

Job.prototype.update = function(data) {
  return this.queue.client.hset(
    this.queue.toKey(this.id),
    'data',
    JSON.stringify(data)
  );
};

Job.prototype.toJSON = function() {
  var opts = Object.assign({}, this.opts);
  return {
    id: this.id,
    name: this.name,
    data: this.data || {},
    opts: opts,
    progress: this._progress,
    delay: this.delay, // Move to opts
    timestamp: this.timestamp,
    attemptsMade: this.attemptsMade,
    failedReason: this.failedReason,
    stacktrace: this.stacktrace || null,
    returnvalue: this.returnvalue || null,
    finishedOn: this.finishedOn || null,
    processedOn: this.processedOn || null
  };
};

Job.prototype.toData = function() {
  var json = this.toJSON();

  json.data = JSON.stringify(json.data);
  json.opts = JSON.stringify(json.opts);
  json.stacktrace = JSON.stringify(json.opts);
  json.failedReason = JSON.stringify(json.failedReason);
  json.returnvalue = JSON.stringify(json.returnvalue);

  return json;
};

/**
  Return a unique key representing a lock for this Job
*/
Job.prototype.lockKey = function() {
  return this.toKey(this.id) + ':lock';
};

/**
  Takes a lock for this job so that no other queue worker can process it at the
  same time.
*/
Job.prototype.takeLock = function() {
  return scripts.takeLock(this.queue, this).then(function(lock) {
    return lock || false;
  });
};

/**
  Releases the lock. Only locks owned by the queue instance can be released.
*/
Job.prototype.releaseLock = function() {
  var _this = this;
  return scripts.releaseLock(this.queue, this.id).then(function(unlocked) {
    if (unlocked != 1) {
      throw new Error('Could not release lock for job ' + _this.id);
    }
  });
};

Job.prototype.moveToCompleted = function(returnValue, ignoreLock) {
  this.returnvalue = returnValue || 0;

  returnValue = utils.tryCatch(JSON.stringify, JSON, [returnValue]);
  if (returnValue === utils.errorObject) {
    var err = utils.errorObject.value;
    return Promise.reject(err);
  }

  return scripts.moveToCompleted(
    this,
    returnValue,
    this.opts.removeOnComplete,
    ignoreLock
  );
};

Job.prototype.discard = function() {
  this._discarded = true;
};

Job.prototype.moveToFailed = function(err, ignoreLock) {
  var _this = this;
  this.failedReason = err.message;
  return new Promise(function(resolve, reject) {
    var command;
    var multi = _this.queue.client.multi();
    _this._saveAttempt(multi, err);

    // Check if an automatic retry should be performed
    if (_this.attemptsMade < _this.opts.attempts && !_this._discarded) {
      // Check if backoff is needed
      var delay = backoffs.calculate(
        _this.opts.backoff,
        _this.attemptsMade,
        _this.queue.settings.backoffStrategies
      );

      if (delay) {
        // If so, move to delayed (need to unlock job in this case!)
        var args = scripts.moveToDelayedArgs(
          _this.queue,
          _this.id,
          Date.now() + delay,
          ignoreLock
        );
        multi.moveToDelayed(args);
        command = 'delayed';
      } else {
        // If not, retry immediately
        multi.retryJob(scripts.retryJobArgs(_this, ignoreLock));
        command = 'retry';
      }
    } else {
      // If not, move to failed
      var args = scripts.moveToFailedArgs(
        _this,
        err.message,
        _this.opts.removeOnFail,
        ignoreLock
      );
      multi.moveToFinished(args);
      command = 'failed';
    }
    return multi.exec().then(function(results) {
      var code = _.last(results)[1];
      if (code < 0) {
        return reject(scripts.finishedErrors(code, _this.id, command));
      }
      resolve();
    }, reject);
  });
};

Job.prototype.moveToDelayed = function(timestamp, ignoreLock) {
  return scripts.moveToDelayed(this.queue, this.id, timestamp, ignoreLock);
};

Job.prototype.promote = function() {
  var queue = this.queue;
  var jobId = this.id;

  var script = [
    'if redis.call("ZREM", KEYS[1], ARGV[1]) == 1 then',
    ' redis.call("LPUSH", KEYS[2], ARGV[1])',
    ' return 0',
    'else',
    ' return -1',
    'end'
  ].join('\n');

  var keys = _.map(['delayed', 'wait'], function(name) {
    return queue.toKey(name);
  });

  return queue.client
    .eval(script, keys.length, keys[0], keys[1], jobId)
    .then(function(result) {
      if (result === -1) {
        throw new Error('Job ' + jobId + ' is not in a delayed state');
      }
    });
};

/**
 * Attempts to retry the job. Only a job that has failed can be retried.
 *
 * @return {Promise} If resolved and return code is 1, then the queue emits a waiting event
 * otherwise the operation was not a success and throw the corresponding error. If the promise
 * rejects, it indicates that the script failed to execute
 */
Job.prototype.retry = function() {
  return scripts.reprocessJob(this, { state: 'failed' }).then(function(result) {
    if (result === 1) {
      return;
    } else if (result === 0) {
      throw new Error(errors.Messages.RETRY_JOB_NOT_EXIST);
    } else if (result === -1) {
      throw new Error(errors.Messages.RETRY_JOB_IS_LOCKED);
    } else if (result === -2) {
      throw new Error(errors.Messages.RETRY_JOB_NOT_FAILED);
    }
  });
};

Job.prototype.isCompleted = function() {
  return this._isDone('completed');
};

Job.prototype.isFailed = function() {
  return this._isDone('failed');
};

Job.prototype.isDelayed = function() {
  return this._isDone('delayed');
};

Job.prototype.isActive = function() {
  return this._isInList('active');
};

Job.prototype.isWaiting = function() {
  return this._isInList('wait');
};

Job.prototype.isPaused = function() {
  return this._isInList('paused');
};

Job.prototype.isStuck = function() {
  return this.getState().then(function(state) {
    return state === 'stuck';
  });
};

Job.prototype.getState = function() {
  var _this = this;
  var fns = [
    { fn: 'isCompleted', state: 'completed' },
    { fn: 'isFailed', state: 'failed' },
    { fn: 'isDelayed', state: 'delayed' },
    { fn: 'isActive', state: 'active' },
    { fn: 'isWaiting', state: 'waiting' },
    { fn: 'isPaused', state: 'paused' }
  ];

  return Promise.reduce(
    fns,
    function(state, fn) {
      if (state) {
        return state;
      }
      return _this[fn.fn]().then(function(result) {
        return result ? fn.state : null;
      });
    },
    null
  ).then(function(result) {
    return result ? result : 'stuck';
  });
};

Job.prototype.remove = function() {
  var queue = this.queue;
  var job = this;

  return scripts.remove(queue, job.id).then(function(removed) {
    if (removed) {
      queue.emit('removed', job);
    } else {
      throw new Error('Could not remove job ' + job.id);
    }
  });
};

/**
 * Returns a promise the resolves when the job has finished. (completed or failed).
 */
Job.prototype.finished = function() {
  var _this = this;

  return scripts.isFinished(_this).then(function(status) {
    var finished = status > 0;
    if (finished) {
      return Job.fromId(_this.queue, _this.id).then(function(job) {
        if (status == 2) {
          throw new Error(job.failedReason);
        } else {
          return job.returnvalue;
        }
      });
    } else {
      return new Promise(function(resolve, reject) {
        var interval;
        function onCompleted(jobId, resultValue) {
          if (String(jobId) === String(_this.id)) {
            var result = void 0;
            try {
              if (typeof resultValue === 'string') {
                result = JSON.parse(resultValue);
              }
            } catch (err) {
              //swallow exception because the resultValue got corrupted somehow.
              debuglog('corrupted resultValue: ' + resultValue, err);
            }
            resolve(result);
            removeListeners();
          }
        }

        function onFailed(jobId, failedReason) {
          if (String(jobId) === String(_this.id)) {
            reject(new Error(failedReason));
            removeListeners();
          }
        }

        _this.queue.on('global:completed', onCompleted);
        _this.queue.on('global:failed', onFailed);

        function removeListeners() {
          clearInterval(interval);
          _this.queue.removeListener('global:completed', onCompleted);
          _this.queue.removeListener('global:failed', onFailed);
        }

        //
        // Watchdog
        //
        interval = setInterval(function() {
          scripts.isFinished(_this).then(function(status) {
            var finished = status > 0;
            if (finished) {
              Job.fromId(_this.queue, _this.id).then(function(job) {
                removeListeners();
                if (status == 2) {
                  reject(new Error(job.failedReason));
                } else {
                  resolve(job.returnvalue);
                }
              });
            }
          });
        }, FINISHED_WATCHDOG);
      });
    }
  });
};

// -----------------------------------------------------------------------------
// Private methods
// -----------------------------------------------------------------------------
Job.prototype._isDone = function(list) {
  return this.queue.client
    .zscore(this.queue.toKey(list), this.id)
    .then(function(score) {
      return score !== null;
    });
};

Job.prototype._isInList = function(list) {
  return scripts.isJobInList(
    this.queue.client,
    this.queue.toKey(list),
    this.id
  );
};

Job.prototype._saveAttempt = function(multi, err) {
  this.attemptsMade++;

  var params = {
    attemptsMade: this.attemptsMade
  };

  if (this.opts.stackTraceLimit) {
    this.stacktrace = this.stacktrace.slice(0, this.opts.stackTraceLimit - 1);
  }

  this.stacktrace.push(err.stack);
  params.stacktrace = JSON.stringify(this.stacktrace);
  params.failedReason = err.message;

  multi.hmset(this.queue.toKey(this.id), params);
};

Job.fromJSON = function(queue, json, jobId) {
  var data = JSON.parse(json.data || '{}');
  var opts = JSON.parse(json.opts || '{}');

  var job = new Job(queue, json.name || Job.DEFAULT_JOB_NAME, data, opts);

  job.id = json.id || jobId;
  job._progress = parseInt(json.progress || 0);
  job.delay = parseInt(json.delay);
  job.timestamp = parseInt(json.timestamp);
  if (json.finishedOn) {
    job.finishedOn = parseInt(json.finishedOn);
  }

  if (json.processedOn) {
    job.processedOn = parseInt(json.processedOn);
  }

  job.failedReason = json.failedReason;
  job.attemptsMade = parseInt(json.attemptsMade || 0);

  job.stacktrace = getTraces(json.stacktrace);

  if (typeof json.returnvalue === 'string') {
    job.returnvalue = getReturnValue(json.returnvalue);
  }

  return job;
};

function getTraces(stacktrace) {
  var _traces;

  _traces = utils.tryCatch(JSON.parse, JSON, [stacktrace]);

  if (_traces === utils.errorObject || !(_traces instanceof Array)) {
    return [];
  } else {
    return _traces;
  }
}

function getReturnValue(_value) {
  var value = utils.tryCatch(JSON.parse, JSON, [_value]);
  if (value !== utils.errorObject) {
    return value;
  } else {
    debuglog('corrupted returnvalue: ' + _value, value);
  }
}

module.exports = Job;
