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

// queue: Queue, jobId: string, data: {}, opts: JobOptions
var Job = function(queue, data, opts){
  opts = opts || {};
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

//
// TODO: events emission to be based on pubsub to make them global.
//
function addJob(queue, job){
  var jobData = job.toData();
  var toKey = _.bind(queue.toKey, queue);
  return scripts.addJob(queue.client, toKey, job.opts.lifo, jobData);
}

Job.create = function(queue, data, opts){
  var job = new Job(queue, data, opts);

  return addJob(queue, job).then(function(jobId){
    job.jobId = jobId;
    queue.emit('waiting', job);
    debuglog('Job added', jobId);
    //
    // TODO: emit event based on pubsub
    //_this.emit('delayed', job);
    //
    return job;
  });
};

Job.fromId = function(queue, jobId){
  // jobId can be undefined if moveJob returns undefined
  if(!jobId) {
    return Promise.resolve();
  }
  return queue.client.hgetallAsync(queue.toKey(jobId)).then(function(jobData){
    if(jobData){
      return Job.fromData(queue, +jobId, jobData);
    }else{
      return jobData;
    }
  });
};

Job.prototype.toData = function(){
  return {
    data: JSON.stringify(this.data || {}),
    opts: JSON.stringify(this.opts || {}),
    progress: this._progress,
    delay: this.delay,
    timestamp: this.timestamp,
    attempts: this.attempts,
    attemptsMade: this.attemptsMade,
    stacktrace: JSON.stringify(this.stacktrace || null),
    returnvalue: JSON.stringify(this.returnvalue || null)
  };
};

Job.prototype.progress = function(progress){
  if(progress){
    var _this = this;
    return this.queue.client.hsetAsync(this.queue.toKey(this.jobId), 'progress', progress).then(function(){
      _this.queue.emit('progress', _this, progress);
    });
  }else{
    return this._progress;
  }
};

/**
  Return a unique key representin a lock for this Job
*/
Job.prototype.lockKey = function(){
  return this.queue.toKey(this.jobId) + ':lock';
};

/**
  Takes a lock for this job so that no other queue worker can process it at the
  same time.
*/
Job.prototype.takeLock = function(token, renew){
  var args = [this.lockKey(), token, 'PX', this.queue.LOCK_RENEW_TIME];
  if(!renew){
    args.push('NX');
  }

  return this.queue.client.setAsync.apply(this.queue.client, args).then(function(result){
    return result === 'OK';
  });
};

/**
  Renews a lock so that it gets some more time before expiring.
*/
Job.prototype.renewLock = function(token){
  return this.takeLock(token, true);
};

/**
  Releases the lock. Only locks owned by the queue instance can be released.
*/
Job.prototype.releaseLock = function(token){
  return scripts.releaseLock(this, token);
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
  this.returnvalue = returnValue;
  return scripts.moveToCompleted(this);
};

Job.prototype.moveToFailed = function(err){
  var _this = this;
  this.stacktrace.push(err.stack);
  return this._saveAttempt().then(function() {
    // Check if an automatic retry should be performed
    if(_this.attemptsMade < _this.attempts){
      // Check if backoff is needed
      var backoff = _this._getBackOff();
      if(backoff){
        // If so, move to delayed
        return _this._moveToSet('delayed', Date.now() + backoff);
      }else{
        // If not, retry immediately
        return _this._retryAtOnce();
      }
    }
    // If not, move to failed
    return _this._moveToSet('failed');
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

  return queue.client.evalAsync(
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

Job.prototype.retry = function(){
  var key = this.queue.toKey('wait');
  var failed = this.queue.toKey('failed');
  var channel = this.queue.toKey('jobs');
  var multi = this.queue.multi();
  var _this = this;

  multi.srem(failed, this.jobId);
  // if queue is LIFO use rpushAsync
  multi[(this.opts.lifo ? 'r' : 'l') + 'push'](key, this.jobId);
  multi.publish(channel, this.jobId);

  return multi.execAsync().then(function(){
    _this.queue.emit('waiting', _this);
    return _this;
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
    .zrankAsync(this.queue.toKey('delayed'), this.jobId).then(function(rank) {
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
        return job.releaseLock();
      });
  });
};

// -----------------------------------------------------------------------------
// Private methods
// -----------------------------------------------------------------------------
Job.prototype._isDone = function(list){
  return this.queue.client
    .sismemberAsync(this.queue.toKey(list), this.jobId).then(function(isMember){
      return isMember === 1;
    });
};

Job.prototype._isInList = function(list) {
  var script = [
    'local function item_in_list (list, item)',
    '  for _, v in pairs(list) do',
    '    if v == item then',
    '      return 1',
    '    end',
    '  end',
    '  return nil',
    'end',
    'local items = redis.call("LRANGE", KEYS[1], 0, -1)',
    'return item_in_list(items, ARGV[1])'
  ].join('\n');

  return this.queue.client.evalAsync(script, 1, this.queue.toKey(list), this.jobId).then(function(result){
    return result === 1;
  });
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

  return queue.client.evalAsync(
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

Job.prototype._saveAttempt = function(){
  if(isNaN(this.attemptsMade)){
    this.attemptsMade = 1;
  }else{
    this.attemptsMade++;
  }
  var params = {
    attemptsMade: this.attemptsMade
  };
  if(this.stacktrace){
    params.stacktrace = JSON.stringify(this.stacktrace);
  }
  return this.queue.client.hmsetAsync(this.queue.toKey(this.jobId), params);
};

/**
*/
Job.fromData = function(queue, jobId, data){
  var job = new Job(queue, JSON.parse(data.data), JSON.parse(data.opts));
  job.jobId = jobId;
  job._progress = parseInt(data.progress);
  job.delay = parseInt(data.delay);
  job.timestamp = parseInt(data.timestamp);
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

module.exports = Job;
