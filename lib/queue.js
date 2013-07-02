"use strict";
var redis = require('redis');
var when = require('when');
var Job = require('./job');

/**
  Gets or creates a new Queue with the given name.
  
  The Queue keeps 4 data structures:
    - wait (list)
    - active (list)
    - completed (a set)
    - failed (a set)
                           completed
                          /
    job -> wait -> active 
                          \
                           failed
*/
var Queue = function(name, redisPort, redisHost, redisOptions){
  this.name = name;
  this.handlers = {};
  this.client = redis.createClient(redisPort, redisHost, redisOptions);
  this.bclient = redis.createClient(redisPort, redisHost, redisOptions);
  this.run().otherwise(function(err){
    console.log(err);
  });
}

Queue.prototype.run = function(){
  var _this = this;
  return this.processOldJobs().then(function(){
    return _this.processJobs();
  });  
}

Queue.prototype.processOldJobs = function(){
  var _this = this;
  var deferred = when.defer();

  this.client.lrange(this.toKey('active'), 0, -1, function(err, active){
    if(err){
      deferred.reject(err);
    }else{
      when.all(active.map(function(jobId){
        return Job.fromId(_this, jobId);
      })).then(function(jobs){
        return when.all(jobs.map(function(job){
          return job.completed();
        })).then(function(){
          deferred.resolve();
        })
      }, function(err){
        deferred.reject(err);
      });
    }
  });
  return deferred.promise;
}

Queue.prototype.processJobs = function(){
  var _this = this;
  return this.getNextJob().then(function(job){
    return _this.processJob(job);
  }).then(function(){
    return _this.processJobs();
  });
}

Queue.prototype.processJob = function(job){
  var handler = this.handlers[job.name];
  var deferred = when.defer();
  if(handler){
    handler(job.data, function(err){
      if(err){
        job.failed(err);
      }else{
        job.completed();
      }
      deferred.resolve();
    });
  }else{
    job.completed();
    deferred.resolve();
  }
  return deferred.promise;
}

Queue.prototype.process = function(jobName, handler){
  this.handlers[jobName] = handler;
};

/**
interface JobOptions
{
  priority: Priority;
  attempts: number;
}
*/

/**
  @param name: string Name representing this type of job.
  @param data: {} Custom data to store for this job. Should be JSON serializable.
  @param opts: JobOptions Options for this job.
*/
Queue.prototype.createJob = function(name, data, opts){
  var deferred = when.defer();
  var _this = this;
  this.client.INCR(this.toKey('id'), function(err, jobId){
    if(err){
      deferred.reject();
    }else{
      deferred.resolve(jobId);
    }
  });
  return deferred.promise.then(function(jobId){
    return Job.create(_this, jobId, name, data, opts).then(function(job){
      var deferred = when.defer();      
      var key = _this.toKey('wait');
      
      _this.client.LPUSH(key, jobId, function(err){
        if(err){
          deferred.reject(err);
        }else{
          deferred.resolve(job);
        }
      });
    
      return deferred.promise;
    });
  });
}

//
Queue.prototype.getNextJob = function(){
  var _this = this;
  return this.moveJob('wait', 'active').then(function(jobId){
    return Job.fromId(_this, jobId);
  });
}

Queue.prototype.moveJob = function(src, dst){
  var deferred = when.defer();
  this.bclient.BRPOPLPUSH(this.toKey(src), this.toKey(dst), 0, function(err, jobId){
    if(err){
      deferred.reject(err);
    }else{
      deferred.resolve(jobId);
    }
  });
  return deferred.promise;
}

Queue.prototype.toKey = function(queueType){
  return 'bull:' + this.name + ':' + queueType;
}

module.exports = Queue;
