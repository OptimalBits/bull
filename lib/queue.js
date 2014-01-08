"use strict";
var redis = require('redis');
var events = require('events');
var util = require('util');
var Job = require('./job');
var _ = require('lodash');
var bluebird = require('bluebird');
var uuid = require('node-uuid');
var sequence = require('when/sequence');

/**
  Gets or creates a new Queue with the given name.
  
  The Queue keeps 4 data structures:
    - wait (list)
    - active (list)
    - completed (a set)
    - failed (a set)
                           - >completed
                          /
    job -> wait -> active 
                          \
                           - > failed
*/

var LOCK_RENEW_TIME = 5000; // 5 seconds is the renew time.

var Queue = function Queue(name, redisPort, redisHost, redisOptions){
  if(!this){
    return new Queue(name, redisPort, redisHost, redisOptions);
  }
  
  var redisDB = 0;
  if(_.isObject(redisPort)){
    var opts = redisPort;
    var redisOpts = opts.redis || {};
    redisPort = redisOpts.port || 6379;
    redisHost = redisOpts.host || '127.0.0.1';
    redisOptions = redisOpts.opts || {};
    redisDB = redisOpts.DB;    
  }
  
  this.name = name;
  this.client = redis.createClient(redisPort, redisHost, redisOptions);
  this.bclient = redis.createClient(redisPort, redisHost, redisOptions);
    
  this.paused = false;
  
  this.token = uuid();
  this.LOCK_RENEW_TIME = LOCK_RENEW_TIME;
  
  // Promisify some redis client methods
  var _this = this;
  var methods = 
    ['lrange', 'sismember', 'set', 'eval', 'incr', 'lpush', 'hset', 'hmset', 'smembers'];

  methods.forEach(function(method){
    _this.client[method+'Async'] = bluebird.promisify(_this.client[method]);
  });
  
  this.client.select(redisDB, function(err){
    _this.bclient.select(redisDB, function(err){
      _this.emit('ready');
    });
  });
}

util.inherits(Queue, events.EventEmitter);

Queue.prototype.close = function(){
  this.client.end();
  this.bclient.end();
}

/**
  Processes a job from the queue. The callback is called for every job that
  is dequeued.
  
  @method process
*/
Queue.prototype.process = function(handler){
  if(this.handler) throw Error("Cannot define a handler more than once per Queue instance");

  this.run().catch(function(err){
    console.log(err);
  });
  
  this.handler = handler;
};

/**
interface JobOptions
{
  attempts: number;
}
*/

/**
  Adds a job to the queue.
  @method add
  @param data: {} Custom data to store for this job. Should be JSON serializable.
  @param opts: JobOptions Options for this job.
*/
Queue.prototype.add = function(data, opts){
  var _this = this;
  
  // If we fail after incrementing the job id we may end having an unused
  // id, but this should not be so harmful
  return _this.client.incrAsync(this.toKey('id')).then(function(jobId){
    return Job.create(_this, jobId, data, opts).then(function(job){
      var key = _this.toKey('wait');
      return _this.client.lpushAsync(key, jobId).then(function(){
        return job;
      })
    });
  });
}

/**
  Returns the number of jobs waiting to be processed.
*/
Queue.prototype.count = function(){
  var multi = this.client.multi();
  multi.llen(this.toKey('wait'))
  multi.llen(this.toKey('paused'))
  
  multi.execAsync = bluebird.promisify(multi.exec);
  return multi.execAsync().then(function(res){
    return Math.max.apply(Math, res);
  });
}

/**
  Pauses the processing of this queue.
  TODO: This pause only pauses the current queue instance, it is not
  good enough, we need to pause all instances. It should be great if RENAME can 
  be used for this. So when pausing we just rename the wait queue to paused.
  BRPOPLPUSH still blocks even when a key does not exist, so it will block
  until the paused key is renamed to wait. The problem is when adding
  new jobs while paused, we need a LUA script that checks if the paused key exists
  and push the jobs there, otherwise just put them in wait. since the LUA script
  is atomic, everything should work nicely.
*/
Queue.prototype.pause = function(){
  if(this.paused) return this.paused;
  
  var
    defer = bluebird.defer(),
    _this = this;

  this.paused = defer.promise;

  if(this.processing){
    this.once('completed', function(){
      _this.emit('paused');
      defer.resolve();
    });
  }else{
    this.emit('paused');
    defer.resolve();
  }
  return this.paused;
}

Queue.prototype.resume = function(){
  var _this = this;
  if(this.paused){
    return this.paused.then(function(){
      _this.paused = null;
      _this.emit('resumed');
      if(_this.handler){
        _this.run();
      }
    });
  }
  throw Error("Cannot resume a running queue");
}

Queue.prototype.run = function(){
  var _this = this;
  return this.processStalledJobs().then(function(){
    return _this.processJobs();
  });
}

/**
  Process jobs that have been added to the active list but are not being
  processed properly.
*/
Queue.prototype.processStalledJobs = function(){
  var _this = this;

  return this.client.lrangeAsync(this.toKey('active'), 0, -1).then(function(active){
    return bluebird.all(active.map(function(jobId){
      return Job.fromId(_this, jobId);
    })).then(function(jobs){
      var tasks = jobs.map(function(job){
        return _.bind(_this.processStalledJob, _this, job);
      });
      return sequence(tasks);
    });
  });
}

Queue.prototype.processStalledJob = function(job){
  var _this = this;
  return job.takeLock(_this.token).then(function(lock){
    if(lock){
      var key = _this.toKey('completed');
      return _this.client.sismemberAsync(key, job.jobId).then(function(isMember){
        if(!isMember){
          return _this.processJob(job)
        }
      });
    }
  });
}

Queue.prototype.processJobs = function(){
  var _this = this;
  
  return this.getNextJob().then(function(job){
    return _this.processJob(job);
  }).then(function(){
    if(!_this.paused){
      return _this.processJobs();
    }
  });
}

Queue.prototype.processJob = function(job){
  var _this = this;
  var deferred = bluebird.defer();

  var lockRenewTimeout;
  var lockRenewer = function(){
    job.takeLock(_this.token, true);
    lockRenewTimeout = setTimeout(lockRenewer, _this.LOCK_RENEW_TIME/2);
  };

  if(!this.paused){
    this.processing = true;
    try{
      lockRenewer();
      _this.handler(job, function(err, data){
        if(err){
          failed(err);
        }else{
          completed(data);
        }
      });
    } catch(err){
        failed(err)
    }
  }else{
    deferred.resolve();
  }

  function completed(data){
    var promise = job.completed();
    promise.then(function(){
      clearTimeout(lockRenewTimeout);
      _this.processing = false;
      _this.emit('completed', job, data);
    });
    deferred.resolve(promise);
  }

  function failed(err){
    var promise = job.failed(err);
    promise.then(function(){
      job.releaseLock(_this.token).then(function(){
        _this.processing = false;
        _this.emit('failed', job, err);
      });
    });
    deferred.resolve(promise);
  }

  return deferred.promise;
}

/**
  Returns a promise that resolves to the next job in queue.
*/
Queue.prototype.getNextJob = function(){
  var _this = this;
  return this.moveJob('wait', 'active').then(function(jobId){
    return Job.fromId(_this, jobId);
  });
}

/**
  Atomically moves a job from one list to another.
  
  @method moveJob
*/
Queue.prototype.moveJob = function(src, dst){
  var deferred = bluebird.defer();
  this.bclient.BRPOPLPUSH(this.toKey(src), this.toKey(dst), 0, function(err, jobId){
    if(err){
      deferred.reject(err);
    }else{
      deferred.resolve(jobId);
    }
  });
  return deferred.promise;
}

Queue.prototype.getWaiting = function(start, end){
  return this.getJobs('wait');
}

Queue.prototype.getActive = function(start, end){
  return this.getJobs('active');
}

Queue.prototype.getCompleted = function(start, end){
  return this.getJobs('completed');
}

Queue.prototype.getFailed = function(start, end){
  return this.getJobs('failed');
}

Queue.prototype.getJobs = function(queueType, start, end){
  var _this = this;
  
  start = _.isUndefined(start) ? 0 : start;
  end = _.isUndefined(end) ? -1 : end;
  
  var key = this.toKey(queueType);
  //this.client.lrange(key, start, end, function(err, jobIds){

  return this.client.smembersAsync(key).then(function(jobIds){
    if(jobIds.length){
      return bluebird.all(_.map(jobIds, function(jobId){
        return Job.fromId(_this, jobId);
      }));
    }
  });
}

Queue.prototype.toKey = function(queueType){
  return 'bull:' + this.name + ':' + queueType;
}

module.exports = Queue;
