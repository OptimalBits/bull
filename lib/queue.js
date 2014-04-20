"use strict";
var redis = require('redis');
var events = require('events');
var util = require('util');
var Job = require('./job');
var _ = require('lodash');
var Promise = require('bluebird');
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

  var _this = this;

  // bubble up Redis error events and attempt to restart queue on
  // error recovery.
  var redisErrorOccurred = false;
  this.client.on('error', function(err){
    _this.emit('error', err);
  });
  this.bclient.on('error', function(err){
    _this.emit('error', err);
    redisErrorOccurred = true;
  });
  this.bclient.on('ready', function(){
    if(redisErrorOccurred){
      redisErrorOccurred = false;
      _this.run();
    }
  });

  // Promisify some redis client methods
  var methods = [
    'lrange',
    'sismember',
    'set',
    'eval',
    'incr',
    'lpush',
    'rpush',
    'hset',
    'hmset',
    'smembers',
    'hgetall'
  ];

  methods.forEach(function(method){
    _this.client[method+'Async'] = Promise.promisify(_this.client[method]);
  });

  this.bclient.brpoplpushAsync = Promise.promisify(this.bclient.BRPOPLPUSH);

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
  opts = opts || {};

  // If we fail after incrementing the job id we may end having an unused
  // id, but this should not be so harmful
  return _this.client.incrAsync(this.toKey('id')).then(function(jobId){
    return Job.create(_this, jobId, data, opts).then(function(job){
      var key = _this.toKey('wait');
      // if queue is LIFO use rpushAsync
      return _this.client[(opts.lifo ? 'r' : 'l') + 'pushAsync'](key, jobId).then(function(){
        return job;
      });
    });
  });
}

/**
  Returns the number of jobs waiting to be processed.
*/
Queue.prototype.count = function(){
  var multi = this.multi();
  multi.llen(this.toKey('wait'))
  multi.llen(this.toKey('paused'))

  return multi.execAsync().then(function(res){
    return Math.max.apply(Math, res);
  });
}


/**
  Empties the queue.

  Returns a promise that is resolved after the operation has been completed.
  Note that if some other process is adding jobs at the same time as emptying,
  the queues may not be really empty after this method has executed completely.
  Also, if the method does error between emptying the lists and removing all the
  jobs, there will be zombie jobs left in redis.

  TODO: Use EVAL to make this operation fully atomic.
*/
Queue.prototype.empty = function(){
  var _this = this;

  // Get all jobids and empty all lists atomically.
  var multi = this.multi();

  multi.lrange(this.toKey('wait'), 0, -1);
  multi.lrange(this.toKey('paused'), 0, -1);
  multi.del(this.toKey('wait'));
  multi.del(this.toKey('paused'));

  return multi.execAsync().then(function(res){
    var waiting = res[0];
    var paused = res[1];

    var jobKeys = _.map(waiting, function(jobId){
      return _this.toKey(jobId);
    });

    jobKeys = jobKeys.concat(_.map(paused, function(jobId){
      return _this.toKey(jobId);
    }));

    if(jobKeys.length){
      var multi = _this.multi();

      multi.del.apply(multi, jobKeys);
      return multi.execAsync();
    }
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

  var _this = this;

  this.paused = new Promise(function(resolve, reject){
    if(_this.processing){
      _this.once('completed', function(){
        _this.emit('paused');
        resolve();
      });
    }else{
      _this.emit('paused');
      resolve();
    }
  });

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
    return Promise.all(active.map(function(jobId){
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
  var deferred = Promise.defer();

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
        clearTimeout(lockRenewTimeout);
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

Queue.prototype.multi = function(){
  var multi = this.client.multi();
  multi.execAsync = Promise.promisify(multi.exec);
  return multi;
}

/**
  Atomically moves a job from one list to another.

  @method moveJob
*/
Queue.prototype.moveJob = function(src, dst){
  return this.bclient.brpoplpushAsync(this.toKey(src), this.toKey(dst), 0);
}

Queue.prototype.getWaiting = function(start, end){
  return this.getJobs('wait', true);
}

Queue.prototype.getActive = function(start, end){
  return this.getJobs('active', true);
}

Queue.prototype.getCompleted = function(){
  return this.getJobs('completed');
}

Queue.prototype.getFailed = function(){
  return this.getJobs('failed');
}

Queue.prototype.getJobs = function(queueType, isList, start, end){
  var _this = this;

  start = _.isUndefined(start) ? 0 : start;
  end = _.isUndefined(end) ? -1 : end;

  var key = this.toKey(queueType);
  var jobs;
  if(isList){
    start = _.isUndefined(start) ? 0 : start;
    end = _.isUndefined(end) ? -1 : end;
    
    jobs = this.client.lrangeAsync(key, start, end);
  }else{
    jobs = this.client.smembersAsync(key);
  }  
  
  return jobs.then(function(jobIds){
    if(jobIds.length){
      return Promise.all(_.map(jobIds, function(jobId){
        return Job.fromId(_this, jobId);
      }));
    }
  });
}

Queue.prototype.toKey = function(queueType){
  return 'bull:' + this.name + ':' + queueType;
}

module.exports = Queue;
