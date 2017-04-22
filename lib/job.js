/*eslint-env node */
'use strict';

var Promise = require('bluebird');
var _ = require('lodash');
var scripts = require('./scripts');
var debuglog = require('debuglog')('bull');

/**
interface JobOptions
{
  priority: Priority;
  attempts: number;
}
*/

// queue: Queue, data: {}, opts: JobOptions
var Job = function(queue, name, data, opts){
  if(typeof name !== 'string'){
    opts = data;
    data = name;
    name = '__default__';
  }

  opts = opts || {};
  this.name = name;
  this.queue = queue;
  this.data = data;
  this.opts = opts;
  this._progress = 0;
  this.delay = opts.delay || 0;
  this.timestamp = opts.timestamp || Date.now();
  this.stacktrace = [];
  if(this.opts.attempts > 1){
    this.attempts = opts.attempts;
  }else{
    this.attempts = 1;
  }
  this.returnvalue = null;
  this.attemptsMade = 0;
};

Job.DEFAULT_JOB_NAME = '__default__';

function addJob(queue, job){
  var opts = job.opts;
  var jobData = job.toData();
  var toKey = _.bind(queue.toKey, queue);
  return scripts.addJob(queue.client, toKey, jobData, {
    lifo: opts.lifo,
    customJobId: opts.jobId,
    priority: opts.priority 
  });
}

Job.create = function(queue, name, data, opts){
  var job = new Job(queue, name, data, opts);

  return addJob(queue, job).then(function(jobId){
    job.jobId = jobId;
    queue.distEmit('waiting', job);
    debuglog('Job added', jobId);
    return job;
  });
};

Job.fromId = function(queue, jobId){
  // jobId can be undefined if moveJob returns undefined
  if(!jobId) {
    return Promise.resolve();
  }
  return queue.client.hgetall(queue.toKey(jobId)).then(function(jobData){
    if(!_.isEmpty(jobData)){
      return Job.fromData(queue, jobId, jobData);
    }else{
      return null;
    }
  });
};

Job.prototype.toData = function(){
  return {
    name: this.name,
    data: JSON.stringify(this.data || {}),
    opts: JSON.stringify(this.opts || {}),
    progress: this._progress,
    delay: this.delay,
    timestamp: this.timestamp,
    attempts: this.attempts,
    attemptsMade: this.attemptsMade,
    failedReason: this.failedReason,
    stacktrace: JSON.stringify(this.stacktrace || null),
    returnvalue: JSON.stringify(this.returnvalue || null)
  };
};

Job.prototype.progress = function(progress){
  if(progress){
    var _this = this;
    this._progress = progress;
    return this.queue.client.hset(this.queue.toKey(this.jobId), 'progress', progress).then(function(){
      _this.queue.distEmit('progress', _this, progress);
    });
  }else{
    return this._progress;
  }
};

//
// toData and fromData should be deprecated.
//
Job.prototype.toJSON = function(){
  var opts = _.extend({}, this.opts || {});
  opts.jobId = this.jobId;
  return {
    name: this.name,
    id: this.jobId,
    data: this.data || {},
    opts: opts,
    progress: this._progress,
    delay: this.delay,
    timestamp: this.timestamp,
    attempts: this.attempts,
    attemptsMade: this.attemptsMade,
    failedReason: this.failedReason,
    stacktrace: this.stacktrace || null,
    returnvalue: this.returnvalue || null
  };
};

/**
  Return a unique key representing a lock for this Job
*/
Job.prototype.lockKey = function(){
  return this.queue.toKey(this.jobId) + ':lock';
};

/**
  Takes a lock for this job so that no other queue worker can process it at the
  same time.
*/
Job.prototype.takeLock = function(renew, ensureActive){
  var _this = this;
  return scripts.takeLock(this.queue, this, renew, ensureActive).then(function(lock) {
    if (lock){
      _this.lock = lock;
    } 
    return lock || false;
  });
};

/**
  Renews a lock so that it gets some more time before expiring.
*/
Job.prototype.renewLock = function(){
  return this.takeLock(true /* Renew */);
};

/**
  Releases the lock. Only locks owned by the queue instance can be released.
*/
Job.prototype.releaseLock = function(){
  var _this = this;
  return scripts.releaseLock(this).then(function() {
    _this.lock = null;
  });
};

Job.prototype.delayIfNeeded = function(){
  if(this.delay){
    var jobDelayedTimestamp = this.timestamp + this.delay;
    if(jobDelayedTimestamp > Date.now()){
      return this.moveToDelayed(jobDelayedTimestamp).then(function(){
        return true;
      });
    }
  }
  return Promise.resolve(false);
};

Job.prototype.moveToCompleted = function(returnValue){
  this.returnvalue = returnValue || 0;
  return scripts.moveToCompleted(this, this.returnvalue, this.opts.removeOnComplete);
};

Job.prototype.move = function(src, target, returnValue){
  if(target === 'completed'){
    this.returnvalue = returnValue || 0;
    if(this.opts.removeOnComplete){
      target = void 0;
    }
  }
  return scripts.move(this, src, target);
}

Job.prototype.discard = function(){
  this._discarded = true;
}

Job.prototype.moveToFailed = function(err, noReleaseLock){
  var _this = this;
  var promise;
  return this._saveAttempt(err).then(function() {
    // Check if an automatic retry should be performed
    if(_this.attemptsMade < _this.attempts && !_this._discarded){
      // Check if backoff is needed
      var backoff = _this._getBackOff();
      if(backoff){
        // If so, move to delayed
        promise = _this.moveToDelayed(Date.now() + backoff);
      }else{
        // If not, retry immediately
        promise = _this._retryAtOnce();
      }
    } else if(_this.opts.removeOnFail){
      return _this.releaseLock().then(function(){
        return _this.remove();
      });
    } else {
      // If not, move to failed
      promise = scripts.moveToFailed(_this, err.message, _this.opts.removeOnFail);
    }
    return promise.then(function(){
      if(!noReleaseLock){
        return _this.releaseLock();
      }
    });
  });
};

Job.prototype.moveToDelayed = function(timestamp){
  return this._moveToSet('delayed', timestamp);
};

Job.prototype.promote = function(){
  var queue = this.queue;
  var jobId = this.jobId;

  var script = [
    'if redis.call("ZREM", KEYS[1], ARGV[1]) == 1 then',
    ' redis.call("LPUSH", KEYS[2], ARGV[1])',
    ' return 0',
    'else',
    ' return -1',
    'end'
  ].join('\n');

  var keys = _.map(['delayed', 'wait'], function(name){
    return queue.toKey(name);
  });

  return queue.client.eval(
    script,
    keys.length,
    keys[0],
    keys[1],
    jobId).then(function(result){
      if(result === -1){
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
Job.prototype.retry = function(){
  var queue = this.queue;
  var _this = this;
  return scripts.reprocessJob(this, { state: 'failed' }).then(function(result) {
    if (result === 1) {
      queue.emit('waiting', _this);
    } else if (result === 0) {
      throw new Error('Couldn\'t retry job: The job doesn\'t exist');
    } else if (result === -1) {
      throw new Error('Couldn\'t retry job: The job is locked');
    } else if (result === -2) {
      throw new Error('Couldn\'t retry job: The job has been already retried or has not failed');
    }
  });
};

Job.prototype.isCompleted = function(){
  return this._isDone('completed');
};

Job.prototype.isFailed = function(){
  return this._isDone('failed');
};

Job.prototype.isDelayed = function() {
  return this.queue.client
    .zrank(this.queue.toKey('delayed'), this.jobId).then(function(rank) {
      return rank !== null;
    });
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

  return Promise.reduce(fns, function(state, fn) {
    if(state){
      return state;
    }
    return _this[fn.fn]().then(function(result) {
      return result ? fn.state : null;
    });
  }, null).then(function(result) {
    return result ? result : 'stuck';
  });
};

/**
  Removes a job from the queue and from all the lists where it may be stored.
*/
Job.prototype.remove = function(){
  var queue = this.queue;
  var job = this;

  return job.takeLock().then(function(lock) {
    if (!lock) {
      throw new Error('Could not get lock for job: ' + job.jobId + '. Cannot remove job.');
    }
    return scripts.remove(queue, job.jobId)
      .then(function() {
        queue.emit('removed', job);
      })
      .finally(function () {
        return job.releaseLock().catch(function(err){
          queue.emit('error', err);
        })
      });
  });
};

/**
 * Returns a promise the resolves when the job has been finished.
 * TODO: Add a watchdog to check if the job has finished periodically.
 * since pubsub does not give any guarantees.
 */
Job.prototype.finished = function(){
  var _this = this;

  function status(resolve, reject){
    return _this.isCompleted().then(function(completed){
      if(!completed){
        return _this.isFailed().then(function(failed){
          if(failed){
            return Job.fromId(_this.queue, _this.jobId, 'failedReason').then(function(data){
              reject(Error(data.failedReason));
              return true;
            });
          }
        });
      }
      resolve();
      return true;
    });
  }

  return new Promise(function(resolve, reject){
    status(resolve, reject).then(function(finished){
      if(!finished){
        var interval;
        function onCompleted(job){
          if(String(job.jobId) === String(_this.jobId)){
            resolve();
            removeListeners();
            clearInterval(interval);
          }
        }

        function onFailed(job, err){
          if(String(job.jobId) === String(_this.jobId)){
            reject(err);
            removeListeners();
            clearInterval(interval);
          }
        }

        function removeListeners(){
          _this.queue.removeListener('completed', onCompleted);
          _this.queue.removeListener('failed', onFailed);
        }

        _this.queue.on('completed', onCompleted);
        _this.queue.on('failed', onFailed);

        //
        // Watchdog
        //
        interval = setInterval(function(){
          status(resolve, reject).then(function(finished){
            if(finished){
              removeListeners();
              clearInterval(interval );
            }
          })
        }, 5000);
      };
    });
  });
}

// -----------------------------------------------------------------------------
// Private methods
// -----------------------------------------------------------------------------
Job.prototype._isDone = function(list){
  return this.queue.client
    .zscore(this.queue.toKey(list), this.jobId).then(function(score){
      return score !== null;
    });
};

Job.prototype._isInList = function(list) {
  return scripts.isJobInList(this.queue.client, this.queue.toKey(list), this.jobId);
};

Job.prototype._moveToSet = function(set, context){
  var queue = this.queue;
  var jobId = this.jobId;

  return scripts.moveToSet(queue, set, jobId, context);
};

Job.prototype._getBackOff = function() {
  var backoff = 0;
  var delay;
  if(this.opts.backoff){
    if(!isNaN(this.opts.backoff)){
      backoff = this.opts.backoff;
    }else if(this.opts.backoff.type === 'fixed'){
      backoff = this.opts.backoff.delay;
    }else if(this.opts.backoff.type === 'exponential'){
      delay = this.opts.backoff.delay;
      backoff = Math.round((Math.pow(2, this.attemptsMade) - 1) * delay);
    }
  }
  return backoff;
};

Job.prototype._retryAtOnce = function(){
  var queue = this.queue;
  var jobId = this.jobId;

  var script = [
    'if redis.call("EXISTS", KEYS[3]) == 1 then',
    ' redis.call("LREM", KEYS[1], 0, ARGV[2])',
    ' redis.call(ARGV[1], KEYS[2], ARGV[2])',
    ' return 0',
    'else',
    ' return -1',
    'end'
  ].join('\n');

  var keys = _.map(['active', 'wait', jobId], function(name){
    return queue.toKey(name);
  });

  var pushCmd = (this.opts.lifo ? 'R' : 'L') + 'PUSH';

  return queue.client.eval(
    script,
    keys.length,
    keys[0],
    keys[1],
    keys[2],
    pushCmd,
    jobId).then(function(result){
      if(result === -1){
        throw new Error('Missing Job ' + jobId + ' during retry');
      }
    });
};

Job.prototype._saveAttempt = function(err){
  if(isNaN(this.attemptsMade)){
    this.attemptsMade = 1;
  }else{
    this.attemptsMade++;
  }
  var params = {
    attemptsMade: this.attemptsMade
  };

  this.stacktrace.push(err.stack);
  params.stacktrace = JSON.stringify(this.stacktrace);
  params.failedReason = err.message;

  return this.queue.client.hmset(this.queue.toKey(this.jobId), params);
};

/**
*/
Job.fromData = function(queue, jobId, data){
  var job = new Job(queue, data.name || Job.DEFAULT_JOB_NAME, JSON.parse(data.data), JSON.parse(data.opts));
  job.jobId = jobId;
  job._progress = parseInt(data.progress);
  job.delay = parseInt(data.delay);
  job.timestamp = parseInt(data.timestamp);

  job.failedReason = data.failedReason;
  job.attempts = parseInt(data.attempts);
  if(isNaN(job.attempts)) {
    job.attempts = 1; // Default to 1 try for legacy jobs
  }
  job.attemptsMade = parseInt(data.attemptsMade);
  var _traces;
  try{
    _traces = JSON.parse(data.stacktrace);
    if(!(_traces instanceof Array)){
      _traces = [];
    }
  }catch (err){
    _traces = [];
  }

  job.stacktrace = _traces;
  try{
    job.returnvalue = JSON.parse(data.returnvalue);
  }catch (e){
    //swallow exception because the returnvalue got corrupted somehow.
    debuglog('corrupted returnvalue: ' + data.returnvalue, e);
  }
  return job;
};

Job.fromJSON = function(queue, json){
  var job = new Job(queue, json.name || Job.DEFAULT_JOB_NAME, json.data, json.opts);
  job.jobId = json.opts.jobId;
  job._progress = parseInt(json.progress);
  job.delay = parseInt(json.delay);
  job.timestamp = parseInt(json.timestamp);
  job.attempts = parseInt(json.attempts);
  if(isNaN(job.attempts)) {
    job.attempts = 1; // Default to 1 try for legacy jobs
  }
  job.attemptsMade = parseInt(json.attemptsMade);
  var _traces;
  try{
    _traces = JSON.parse(json.stacktrace);
    if(!(_traces instanceof Array)){
      _traces = [];
    }
  }catch (err){
    _traces = [];
  }

  job.stacktrace = _traces;
  try{
    job.returnvalue = JSON.parse(json.returnvalue);
  }catch (e){
    //swallow exception because the returnvalue got corrupted somehow.
    debuglog('corrupted returnvalue: ' + json.returnvalue, e);
  }
  return job;
}

module.exports = Job;
