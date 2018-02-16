'use strict';
var redis = require('redis');
var when = require('when');

/**
interface JobOptions
{
  attempts: number;
}
*/

// queue: Queue, msgId: string, data: {}, opts: JobOptions
var Message = function Message(queue, msgId, data, opts) {
  this.queue = queue;
  this.msgId = msgId;
  this.data = data;
  this.opts = opts;
  this._progress = 0;
};

Message.create = function(queue, msgId, data, opts) {
  var deferred = when.defer();
  var msg = new Message(queue, msgId, data, opts);
  queue.client.HMSET(queue.toKey(msgId), msg.toData(), function(err) {
    if (err) {
      deferred.reject(err);
    } else {
      deferred.resolve(job);
    }
  });
  return deferred.promise;
};

Message.fromId = function(queue, msgId) {
  var deferred = when.defer();
  queue.client.HGETALL(queue.toKey(msgId), function(err, data) {
    if (data) {
      deferred.resolve(Message.fromData(queue, msgId, data));
    } else {
      deferred.reject(err);
    }
  });
  return deferred.promise;
};

Message.prototype.toData = function() {
  return {
    name: this.name,
    data: JSON.stringify(this.data || {}),
    opts: JSON.stringify(this.opts || {}),
    progress: this._progress
  };
};

Message.prototype.progress = function(progress) {
  if (progress) {
    var deferred = when.defer();
    var _this = this;
    this.queue.client.hset(
      this.queue.toKey(this.msgId),
      'progress',
      progress,
      function(err) {
        if (err) {
          deferred.reject(err);
        } else {
          deferred.resolve();
          _this.queue.emit('progress', _this, progress);
        }
      }
    );
    return deferred.promise;
  } else {
    return this._progress;
  }
};

Job.prototype.completed = function() {
  return this._done('completed');
};

Job.prototype.failed = function(err) {
  return this._done('failed');
};

Job.prototype.isCompleted = function() {
  return this._isDone('completed');
};

Job.prototype.isFailed = function() {
  return this._isDone('failed');
};

Job.prototype._isDone = function(list) {
  var deferred = when.defer();
  this.queue.client.SISMEMBER(this.queue.toKey(list), this.jobId, function(
    err,
    isMember
  ) {
    if (err) {
      deferred.reject(err);
    } else {
      deferred.resolve(isMember === 1);
    }
  });
  return deferred.promise;
};

Job.prototype._done = function(list) {
  var deferred = when.defer();
  var queue = this.queue;
  var activeList = queue.toKey('active');
  var completedList = queue.toKey(list);

  queue.client
    .multi()
    .lrem(activeList, 0, this.jobId)
    .sadd(completedList, this.jobId)
    .exec(function(err) {
      !err && deferred.resolve();
      err && deferred.reject(err);
    });
  return deferred.promise;
};

/**
 */
Job.fromData = function(queue, jobId, data) {
  var job = new Job(queue, jobId, data.name, JSON.parse(data.data), data.opts);
  job._progress = parseInt(data.progress);
  return job;
};

module.exports = Job;
