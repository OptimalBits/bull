/*eslint-env node */
'use strict';

var Promise = require('bluebird');
var _ = require('lodash');
var scripts = require('./scripts');
var debuglog = require('debuglog')('bull');
var errors = require('./errors');

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
var Job = function(queue, name, data, opts){
  if(typeof name !== 'string'){
    opts = data;
    data = name;
    name = '__default__';
  }

  this.opts = _.defaults(opts, {
    attempts: 1,
    delay: 0,
    timestamp: Date.now()
  });

  this.opts.attempts = parseInt(this.opts.attempts);

  this.name = name;
  this.queue = queue;
  this.data = data;
  this._progress = 0;
  this.delay = this.opts.delay;
  this.timestamp = this.opts.timestamp;
  this.stacktrace = [];
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
  return queue.isReady().then(function(){
    return addJob(queue, job).then(function(jobId){
      job.id = jobId;
      queue.distEmit('waiting', job, null);
      debuglog('Job added', jobId);
      return job;
    });
  });
};

Job.fromId = function(queue, jobId){
  // jobId can be undefined if moveJob returns undefined
  if(!jobId) {
    return Promise.resolve();
  }
  return queue.client.hgetall(queue.toKey(jobId)).then(function(jobData){
    if(!_.isEmpty(jobData)){
      return Job.fromData(queue, jobData, jobId);
    }else{
      return null;
    }
  });
};

Job.prototype.progress = function(progress){
  if(progress){
    var _this = this;
    this._progress = progress;
    return this.queue.client.hset(this.queue.toKey(this.id), 'progress', progress).then(function(){
      _this.queue.distEmit('progress', _this, progress);
    });
  }else{
    return this._progress;
  }
};

Job.prototype.toJSON = function(){
  var opts = _.extend({}, this.opts || {});
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
    returnvalue: this.returnvalue || null
  };
};

Job.prototype.toData = function(){
  var json = this.toJSON();
  var whitelist = ['data', 'opts', 'stacktrace', 'returnvalue'];
  
  _.extend(json, _.mapValues(_.pick(json, whitelist), JSON.stringify));

  return json;
};

/**
  Return a unique key representing a lock for this Job
*/
Job.prototype.lockKey = function(){
  return this.queue.toKey(this.id) + ':lock';
};

/**
  Takes a lock for this job so that no other queue worker can process it at the
  same time.
*/
Job.prototype.takeLock = function(){
  return scripts.takeLock(this.queue, this).then(function(lock) {
    return lock || false;
  });
};

/**
  Releases the lock. Only locks owned by the queue instance can be released.
*/
Job.prototype.releaseLock = function(){
  var _this = this;
  return scripts.releaseLock(this.queue, this.id).then(function(unlocked) {
    if(unlocked != 1){
      throw Error('Could not release lock for job ' + _this.id);
    }
  });
};

Job.prototype.moveToCompleted = function(returnValue, ignoreLock){
  this.returnvalue = returnValue || 0;
  return scripts.moveToCompleted(this, this.returnvalue, this.opts.removeOnComplete, ignoreLock);
};

Job.prototype.discard = function(){
  this._discarded = true;
};

Job.prototype.moveToFailed = function(err, ignoreLock){
  var _this = this;
  return new Promise(function(resolve, reject){
    var multi = _this.queue.client.multi();
    _this._saveAttempt(multi, err);

    // Check if an automatic retry should be performed
    if(_this.attemptsMade < _this.opts.attempts && !_this._discarded){
      // Check if backoff is needed
      var backoff = _this._getBackOff();
      if(backoff){
        // If so, move to delayed (need to unlock job in this case!)
        var args = scripts.moveToDelayedArgs(_this.queue, _this.id, Date.now() + backoff);
        multi.moveToDelayed(args);
      }else{
        // If not, retry immediately
        multi.retryJob(scripts.retryJobArgs(_this), function(err, result){
          if(err){
            reject();
          }else{
            if(result === -1){
              reject(new Error('Missing Job ' + _this.id + ' during retry'));
            }
          }
        });
      }
    } else {
      // If not, move to failed
      var args = scripts.moveToFailedArgs(_this, err.message, _this.opts.removeOnFail, ignoreLock);
      multi.moveToFinished(args);
    }
    return multi.exec().then(resolve, reject);
  });
};

Job.prototype.moveToDelayed = function(timestamp){
  return scripts.moveToDelayed(this.queue, this.id, timestamp);
};

Job.prototype.promote = function(){
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
      queue.distEmit('waiting', _this, null);
    } else if (result === 0) {
      throw new Error(errors.Messages.RETRY_JOB_NOT_EXIST);
    } else if (result === -1) {
      throw new Error(errors.Messages.RETRY_JOB_IS_LOCKED);
    } else if (result === -2) {
      throw new Error(errors.Messages.RETRY_JOB_NOT_FAILED);
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

Job.prototype.remove = function(){
  var queue = this.queue;
  var job = this;

  return scripts.remove(queue, job.id).then(function(removed) {
    if(removed){
      queue.emit('removed', job);
    }else{
      throw Error('Could not remove job ' + job.id);
    }
  });
};

/**
 * Returns a promise the resolves when the job has finished. (completed or failed).
 */
Job.prototype.finished = function(){
  var _this = this;

  return scripts.isFinished(_this).then(function(status){
    var finished = status > 0;
    if(finished){
      if(status == 2){
        return Job.fromId(_this.queue, _this.id, 'failedReason').then(function(data){
          throw Error(data.failedReason);
        });
      }
    }else{
      return new Promise(function(resolve, reject){
        var interval;
        function onCompleted(job){
          if(String(job.id) === String(_this.id)){
            resolve();
            removeListeners();
            clearInterval(interval);
          }
        }

        function onFailed(job, err){
          if(String(job.id) === String(_this.id)){
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
              clearInterval(interval);
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
Job.prototype._isDone = function(list){
  return this.queue.client
    .zscore(this.queue.toKey(list), this.id).then(function(score){
      return score !== null;
    });
};

Job.prototype._isInList = function(list) {
  return scripts.isJobInList(this.queue.client, this.queue.toKey(list), this.id);
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

Job.prototype._saveAttempt = function(multi, err){
  this.attemptsMade++;

  var params = {
    attemptsMade: this.attemptsMade
  };

  this.stacktrace.push(err.stack);
  params.stacktrace = JSON.stringify(this.stacktrace);
  params.failedReason = err.message;

  multi.hmset(this.queue.toKey(this.id), params);
};

Job.fromData = function(queue, raw, jobId){
  raw = _.extend({}, raw);
  raw.data = JSON.parse(raw.data);
  raw.opts = JSON.parse(raw.opts);

  var job = Job.fromJSON(queue, raw, jobId);

  return job;
};

Job.fromJSON = function(queue, json, jobId){
  var job = new Job(queue, json.name || Job.DEFAULT_JOB_NAME, json.data, json.opts);

  job.id = json.id || jobId;
  job._progress = parseInt(json.progress || 0);
  job.delay = parseInt(json.delay);
  job.timestamp = parseInt(json.timestamp);

  job.failedReason = json.failedReason;
  job.attemptsMade = parseInt(json.attemptsMade || 0);
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
};

module.exports = Job;
