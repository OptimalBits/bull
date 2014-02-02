"use strict";
var redis = require('redis');
var Promise = require('bluebird');

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
  this.opts = opts;
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

Job.prototype.completed = function(){
  return this._done('completed');
}

Job.prototype.failed = function(err){
  return this._done('failed');
}

Job.prototype.isCompleted = function(){
  return this._isDone('completed');
}

Job.prototype.isFailed = function(){
  return this._isDone('failed');
}

/**
  Removes a job from the queue and from all the lists where it may be.
*/
Job.prototype.remove = function(){
  var queue = this.queue;
  return queue.multi()
    .lrem(queue.toKey('active'), 0, this.jobId)
    .lrem(queue.toKey('wait'), 0, this.jobId)
    .lrem(queue.toKey('paused'), 0, this.jobId)
    .srem(queue.toKey('completed'), this.jobId)
    .srem(queue.toKey('failed'), this.jobId)
    .del(queue.toKey(this.jobId))
    .execAsync();
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

Job.prototype._done = function(list){
  var queue = this.queue;
  var activeList = queue.toKey('active');
  var completedList = queue.toKey(list);
  
  var multi = queue.multi();
    
  return multi
    .lrem(activeList, 0, this.jobId)
    .sadd(completedList, this.jobId)
    .execAsync();
}

/**
*/
Job.fromData = function(queue, jobId, data){
  var job = new Job(queue, jobId, JSON.parse(data.data), data.opts);
  job._progress = parseInt(data.progress);
  return job;
}

module.exports = Job;
