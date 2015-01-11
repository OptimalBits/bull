"use strict";
var redis = require('redis');
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
  this.queue = queue;
  this.jobId = jobId;
  this.data = data;
  this.opts = opts || {};
  this._progress = 0;
}

Job.create = function(queue, jobId, data, opts){
  var job = new Job(queue, jobId, data, opts);
  return queue.client.hmsetAsync(queue.toKey(jobId), job.toData()).then(function(){
    return job;
  });
}

Job.fromId = function(queue, jobId){
  return queue.client.hgetallAsync(queue.toKey(jobId)).then(function(jobData){
    if(jobData){
      return Job.fromData(queue, +jobId, jobData);
    } else{
      return jobData;
    }
  });
}

Job.prototype.toData = function(){
  return {
    data: JSON.stringify(this.data || {}),
    opts: JSON.stringify(this.opts || {}),
    progress: this._progress
  }
}

Job.prototype.progress = function(progress){
  if(progress){
    var _this = this;
    return this.queue.client.hsetAsync(this.queue.toKey(this.jobId), 'progress', progress).then(function(){
      _this.queue.emit('progress', _this, progress);
    });
  }else{
    return this._progress;
  }
}

/**
  Return a unique key representin a lock for this Job
*/
Job.prototype.lockKey = function(){
  return this.queue.toKey(this.jobId)+':lock';
}

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
}

/**
  Renews a lock so that it gets some more time before expiring.
*/
Job.prototype.renewLock = function(token){
  return this.takeLock(token, true);
}

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
}

Job.prototype.moveToCompleted = function(){
  return this._moveToSet('completed');
}

Job.prototype.moveToFailed = function(err){
  return this._moveToSet('failed');
}

Job.prototype.retry = function(){
  var key = this.queue.toKey('wait');
  var failed = this.queue.toKey('failed');
  var channel = this.queue.toKey('jobs');
  var multi = this.queue.client.multi();
  
  multi.srem(failed, this.jobId);
  // if queue is LIFO use rpushAsync
  multi[(this.opts.lifo ? 'r' : 'l') + 'push'](key, this.jobId);
  multi.publish(channel, this.jobId);
  
  return multi.execAsync().then(function(){
    return this;
  });
}

Job.prototype.isCompleted = function(){
  return this._isDone('completed');
}

Job.prototype.isFailed = function(){
  return this._isDone('failed');
}

/**
  Removes a job from the queue and from all the lists where it may be stored.
*/
Job.prototype.remove = function(){
  var queue = this.queue;

  var script = [
    'if (redis.call("SISMEMBER", KEYS[4], ARGV[1]) == 0) and (redis.call("SISMEMBER", KEYS[5], ARGV[1]) == 0) then',
    '  redis.call("LREM", KEYS[1], 0, ARGV[1])',
    '  redis.call("LREM", KEYS[2], 0, ARGV[1])',
    '  redis.call("LREM", KEYS[3], 0, ARGV[1])',
    'end',
    'redis.call("SREM", KEYS[4], ARGV[1])',
    'redis.call("SREM", KEYS[5], ARGV[1])',
    'redis.call("DEL", KEYS[6])'].join('\n');

  var keys = _.map([
    'active',
    'wait',
    'paused',
    'completed',
    'failed',
    this.jobId], function(name){
      return queue.toKey(name);
  });

  return this.queue.client.evalAsync(
    script,
    keys.length,
    keys[0],
    keys[1],
    keys[2],
    keys[3],
    keys[4],
    keys[5],
    this.jobId);
}

// -----------------------------------------------------------------------------
// Private methods
// -----------------------------------------------------------------------------
Job.prototype._isDone = function(list){
  return this.queue.client
    .sismemberAsync(this.queue.toKey(list), this.jobId).then(function(isMember){
      return isMember === 1;
    });
}

Job.prototype._moveToSet = function(set){
  var queue = this.queue;
  var activeList = queue.toKey('active');
  var destinationSet = queue.toKey(set);

  var multi = queue.multi();

  return multi
    .lrem(activeList, 0, this.jobId)
    .sadd(destinationSet, this.jobId)
    .execAsync();
}

/**
*/
Job.fromData = function(queue, jobId, data){
  var job = new Job(queue, jobId, JSON.parse(data.data), JSON.parse(data.opts));
  job._progress = parseInt(data.progress);
  return job;
}

module.exports = Job;
