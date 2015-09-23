/*eslint-env node */
/*global Promise:true */
'use strict';

var Promise = require('bluebird');
var _ = require('lodash');

/**
interface JobOptions
{
  priority: Priority;
  attempts: number;
}
*/

// queue: Queue, jobId: string, data: {}, opts: JobOptions
var Job = function(queue, jobId, data, opts){
  opts = opts || {};
  this.queue = queue;
  this.jobId = jobId;
  this.data = data;
  this.opts = opts;
  this._progress = 0;
  this.delay = this.opts.delay;
  this.timestamp = opts.timestamp || Date.now();
  this.stacktrace = null;
};

Job.create = function(queue, jobId, data, opts){
  var job = new Job(queue, jobId, data, opts);
  return queue.client.hmsetAsync(queue.toKey(jobId), job.toData()).then(function(){
    return job;
  });
};

Job.fromId = function(queue, jobId){
  return queue.client.hgetallAsync(queue.toKey(jobId)).then(function(jobData){
    if(jobData){
      return Job.fromData(queue, +jobId, jobData);
    } else{
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
    timestamp: this.timestamp
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
  var script = [
    'if redis.call("get", KEYS[1]) == ARGV[1]',
    'then',
    'return redis.call("del", KEYS[1])',
    'else',
    'return 0',
    'end'].join('\n');

  return this.queue.client.evalAsync(script, 1, this.lockKey(), token).then(function(result){
    return result === 1;
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

Job.prototype.moveToCompleted = function(){
  return this._moveToSet('completed');
};

Job.prototype.moveToFailed = function(err){
  var _this = this;
  return this._moveToSet('failed').then(function() {
    _this.stacktrace = err.stack;
    return _this.queue.client.hsetAsync(_this.queue.toKey(_this.jobId), 'stacktrace', err.stack);
  });
};

Job.prototype.moveToDelayed = function(timestamp){
  return this._moveToSet('delayed', timestamp);
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

  var script = [
    'if (redis.call("SISMEMBER", KEYS[5], ARGV[1]) == 0) and (redis.call("SISMEMBER", KEYS[6], ARGV[1]) == 0) then',
    '  redis.call("LREM", KEYS[1], 0, ARGV[1])',
    '  redis.call("LREM", KEYS[2], 0, ARGV[1])',
    '  redis.call("ZREM", KEYS[3], ARGV[1])',
    '  redis.call("LREM", KEYS[4], 0, ARGV[1])',
    'end',
    'redis.call("SREM", KEYS[5], ARGV[1])',
    'redis.call("SREM", KEYS[6], ARGV[1])',
    'redis.call("DEL", KEYS[7])'].join('\n');

  var keys = _.map([
    'active',
    'wait',
    'delayed',
    'paused',
    'completed',
    'failed',
    this.jobId], function(name){
      return queue.toKey(name);
    }
  );

  var job = this;
  return this.queue.client.evalAsync(
    script,
    keys.length,
    keys[0],
    keys[1],
    keys[2],
    keys[3],
    keys[4],
    keys[5],
    keys[6],
    this.jobId).then(function () {
      queue.emit('removed', job);
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

Job.prototype._moveToSet = function(set, delayTimestamp){
  var queue = this.queue;
  var jobId = this.jobId;

  delayTimestamp = +delayTimestamp || 0;
  delayTimestamp = delayTimestamp < 0 ? 0 : delayTimestamp;

  var script = [
    'if redis.call("EXISTS", KEYS[3]) == 1 then',
    ' if tonumber(ARGV[1]) ~= 0 then',
    '  redis.call("ZADD", KEYS[2], ARGV[1], ARGV[2])',
    '  redis.call("PUBLISH", KEYS[2], ARGV[1])',
    ' else',
    '  redis.call("SADD", KEYS[2], ARGV[2])',
    ' end',
    ' redis.call("LREM", KEYS[1], 0, ARGV[2])',
    ' return 0',
    'else',
    ' return -1',
    'end'
    ].join('\n');

  var keys = _.map([
    'active',
    set,
    jobId], function(name){
      return queue.toKey(name);
    }
  );

  return queue.client.evalAsync(
    script,
    keys.length,
    keys[0],
    keys[1],
    keys[2],
    delayTimestamp,
    jobId).then(function(result){
      if(result === -1){
        throw new Error('Missing Job ' + jobId + ' when trying to move from active to ' + set);
      }
    });
};


/**
*/
Job.fromData = function(queue, jobId, data){
  var job = new Job(queue, jobId, JSON.parse(data.data), JSON.parse(data.opts));
  job._progress = parseInt(data.progress);
  job.delay = parseInt(data.delay);
  job.timestamp = parseInt(data.timestamp);
  job.stacktrace = data.stacktrace;

  return job;
};

module.exports = Job;
