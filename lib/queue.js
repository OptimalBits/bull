/*eslint-env node */
'use strict';

var redis = require('ioredis');
var EventEmitter = require('events');

var util = require('util');
var url = require('url');
var Job = require('./job');
var scripts = require('./scripts');
var errors = require('./errors');

var TimerManager = require('./timer-manager');
var _ = require('lodash');
var Promise = require('bluebird');
var semver = require('semver');
var debuglog = require('debuglog')('bull');
var uuid = require('uuid');

var commands = require('./commands/');


/**
  Gets or creates a new Queue with the given name.

  The Queue keeps 6 data structures:
    - wait (list)
    - active (list)
    - delayed (zset)
    - priority (zset)
    - completed (zset)
    - failed (zset)

        --> priorities      -- > completed
       /     |            /
    job -> wait -> active
       \     ^            \
        v    |             -- > failed
        delayed
*/

/**
  Delayed jobs are jobs that cannot be executed until a certain time in
  ms has passed since they were added to the queue.
  The mechanism is simple, a delayedTimestamp variable holds the next
  known timestamp that is on the delayed set (or MAX_TIMEOUT_MS if none).

  When the current job has finalized the variable is checked, if
  no delayed job has to be executed yet a setTimeout is set so that a
  delayed job is processed after timing out.
*/
var MINIMUM_REDIS_VERSION = '2.8.11';

var MAX_TIMEOUT_MS = Math.pow(2, 31) - 1; // 32 bit signed

/*
  interface QueueOptions {
    prefix?: string = 'bull',
    redis : RedisOpts, // ioredis defaults
    createClient?: (type: enum('client', 'subscriber'), redisOpts?: RedisOpts) => redisClient,

    // Advanced settings
    settings?: QueueSettings {
      lockDuration?: number = 30000,
      lockRenewTime?: number = lockDuration / 2,
      stalledInterval?: number = 30000,
      maxStalledCount?: number = 1, // The maximum number of times a job can be recovered from the 'stalled' state
      guardInterval?: number = 5000,
      retryProcessDelay?: number = 5000
    }
  }
*/

// Queue(name: string, url?, opts?)
var Queue = function Queue(name, url, opts){
  var _this = this;
  if(!(this instanceof Queue)){
    return new Queue(name, url, opts);
  }

  if(_.isString(url)){
    opts = _.extend({}, {
      redis: redisOptsFromUrl(url)
    }, opts);
  }else{
    opts = url;
  }

  opts = opts || {};

  if(opts && !_.isObject(opts)){
    throw Error('Options must be a valid object');
  }

  var redisOpts = opts.redis || {};

  _.defaults(redisOpts, {
    port: 6379,
    host: '127.0.0.1',
    db: redisOpts.db || redisOpts.DB,
    retryStrategy: function (times) {
      var delay = Math.min(Math.exp(times), 20000);
      return delay;
    }
  });

  function createClient(type, redisOpts) {
    var client;
    if(_.isFunction(opts.createClient)){
      client = opts.createClient(type, redisOpts);
    }else{
      client = new redis(redisOpts);
    }
    return client;
  }

  this.name = name;
  this.keyPrefix = redisOpts.keyPrefix || opts.prefix || 'bull';
  this.token = uuid();

  //
  // We cannot use ioredis keyPrefix feature since we
  // create keys dynamically in lua scripts.
  //
  delete redisOpts.keyPrefix;

  //
  // Create queue client (used to add jobs, pause queues, etc);
  //
  this.client = createClient('client', redisOpts);

  getRedisVersion(this.client).then(function(version){
    if(semver.lt(version, MINIMUM_REDIS_VERSION)){
      throw new Error('Redis version needs to be greater than ' + MINIMUM_REDIS_VERSION + '. Current: ' + version);
    }
  }).catch(function(err){
    _this.emit('error', err);
  });

  //
  // Create event subscriber client (receive messages from other instance of the queue)
  //
  this.eclient = createClient('subscriber', redisOpts);

  this.handlers = {};
  this.delayTimer;
  this.processing = [];
  this.retrieving = 0;

  this.settings = _.defaults(opts.settings, {
    lockDuration: 30000,
    stalledInterval: 30000,
    maxStalledCount: 1,
    guardInterval: 5000,
    retryProcessDelay: 5000
  });

  this.settings.lockRenewTime = this.settings.lockRenewTime || this.settings.lockDuration / 2; 

  // bubble up Redis error events
  [this.client, this.eclient].forEach(function (client) {
    client.on('error', _this.emit.bind(_this, 'error'));
  });

  this.on('error', function(){
    // Dummy handler to avoid process to exit with an unhandled exception.
  });
    
  // keeps track of active timers. used by close() to
  // ensure that disconnect() is deferred until all
  // scheduled redis commands have been executed
  this.timers = new TimerManager();

  //
  // Init
  //
  this._init(name);

  //
  // Only setup listeners if .on/.addEventListener called, or process function defined.
  // 
  this._setupQueueEventListeners();

  this.delayedTimestamp = Number.MAX_VALUE;
  this.isReady().then(function(){
    // TODO: These are only useful if a process function has been defined.

    //
    // Init delay timestamp.
    //
    scripts.updateDelaySet(_this, Date.now()).then(function(timestamp){
      if(timestamp){
        _this.updateDelayTimer(timestamp);
      }
    });

    //
    // Create a guardian timer to revive delayTimer if necessary
    // This is necessary when redis connection is unstable, which can cause the pub/sub to fail
    //
    _this.guardianTimer = setGuardianTimer(_this);
  });

  this.errorRetryTimer = {};

  // Bind these methods to avoid constant rebinding and/or creating closures
  // in processJobs etc.
  this.moveUnlockedJobsToWait = this.moveUnlockedJobsToWait.bind(this);
  this.processJob = this.processJob.bind(this);
  this.getJobFromId = Job.fromId.bind(null, this);
};

function redisOptsFromUrl(urlString){
  var redisOpts = {};
  try {
    var redisUrl = url.parse(urlString);
    redisOpts.port = redisUrl.port || 6379;
    redisOpts.host = redisUrl.hostname;
    if (redisUrl.auth) {
      redisOpts.password = redisUrl.auth.split(':')[1];
    }
  } catch (e) {
    throw new Error(e.message);
  }
  return redisOpts;
}

function setGuardianTimer(queue){
  return setInterval(function() {
    if(queue.delayedTimestamp < Date.now() || queue.delayedTimestamp - Date.now() > queue.settings.guardInterval){
      scripts.updateDelaySet(queue, Date.now()).then(function(timestamp){
        if(timestamp){
          queue.updateDelayTimer(timestamp);
        }
      }).catch(function(err){
        queue.emit('error', err);
      });
    }
    //
    // Trigger a getNextJob (if worker is idling)
    //
    queue.emit('added');
  }, queue.settings.guardInterval);
}

util.inherits(Queue, EventEmitter);

Queue.prototype.off = Queue.prototype.removeListener;

Queue.prototype._init = function(name){
  var _this = this;

  this._initializing = Promise.all([
    _this.eclient.subscribe(_this.toKey('added')),
    _this.eclient.subscribe(_this.toKey('delayed'))
  ]).then(function(){
      return _this.eclient.subscribe(_this.toKey('delayed'));
    }).then(function(){
      return commands(_this.client);
    }).then(function(){
      debuglog(name + ' queue ready');
    }, function(err){
      _this.emit('error', err, 'Error initializing queue');
      throw err;
    });
};

Queue.prototype._setupQueueEventListeners = function(){
  /*
    if(eventName !== 'cleaned' && eventName !== 'error'){
      args[0] = Job.fromJSON(_this, args[0]);
    }
  */
  var _this = this;
  var activeKey = _this.toKey('active');
  var progressKey = _this.toKey('progress');
  var delayedKey = _this.toKey('delayed');
  var pausedKey = _this.toKey('paused');
  var resumedKey = _this.toKey('resumed');
  var addedKey = _this.toKey('added');
  var completedKey = _this.toKey('completed');
  var failedKey = _this.toKey('failed');

  this.eclient.on('message', function(key, message) {
    switch(key){
      case addedKey:
        _this.emit('added', message);
        break;
      case delayedKey:
        _this.updateDelayTimer(message);
        break;
      }
  });

  /*this.eclient.on('pmessage', function(channel, pattern, message){
    console.log('pmessage',channel, pattern, message)
    var keyAndToken = pattern.split('@');
    var key = keyAndToken[0];
    var token = keyAndToken[1]; 

    switch(key){
      case activeKey:
        _this.emit('global:active', message, 'waiting');
        break;
      case progressKey:
        var jobAndProgress = message.split(':');
        _this.emit('global:progress', jobAndProgress[0], jobAndProgress[1]);
        break;
      case delayedKey:
        _this.updateDelayTimer(message);
        break;
      case pausedKey:
      case resumedKey:
        _this.emit('global:' + message);
        break;
      case addedKey:
        _this.emit('added', message);
        if(_this.token === token){
          _this.emit('waiting', message, null);
        }
        token && _this.emit('global:waiting', message, null);
        break;
      case completedKey:
        var data = JSON.parse(message);
        var job = Job.fromJSON(_this, data.job);
        _this.emit('global:completed', job, data.val, 'active');
        break;
      case failedKey:
        var data = JSON.parse(message);
        var job = Job.fromJSON(_this, data.job);
        _this.emit('global:failed', job, data.val, 'active');
        break;
    }
  });*/
};

Queue.ErrorMessages = errors.Messages;

Queue.prototype.isReady = function(){
  var _this = this;
  return this._initializing.then(function(){
    return _this;
  });
};

Queue.prototype.whenCurrentMoveFinished = function(){
  var currentMove = this.client.commandQueue.peekFront();
  return currentMove && currentMove.command.promise || Promise.resolve();
};

Queue.prototype.disconnect = function(){
  var clients = [this.client, this.eclient].filter(function(client){
    return client.status === 'ready';
  });

  var ended = new Promise(function(resolve){
    var resolver = _.after(clients.length, resolve);
    clients.forEach(function(client){
      client.once('end', resolver);
    });
  });
  return Promise.all(clients.map(function(client){
    return client.quit();
  })).then(function(){
    return ended;
  });
};

Queue.prototype.close = function( doNotWaitJobs ){
  var _this = this;

  if(this.closing){
    return this.closing;
  }

  return this.closing = this.isReady().then(function(){
    return _this._clearTimers();
  }).then(function(){
    return _this.pause(true, doNotWaitJobs);
  }).then(function(){
    return _this.disconnect();
  }).then(function(){
    _this.closed = true;
  });
};

Queue.prototype._clearTimers = function(){
  var _this = this;
  _.each(_this.errorRetryTimer, function(timer){
    clearTimeout(timer);
  });
  clearTimeout(this.delayTimer);
  clearInterval(_this.guardianTimer);
  clearInterval(_this.moveUnlockedJobsToWaitInterval);
  _this.timers.clearAll();
  return _this.timers.whenIdle();
};

/**
  Processes a job from the queue. The callback is called for every job that
  is dequeued.

  Deprecate in favor of:

  /*
  queue.work('export', opts, function(job, input){

    return output;
  }, 'adrapid-export-results');

  @method process
*/
Queue.prototype.process = function(name, concurrency, handler){
  if(typeof name !== 'string'){
    handler = concurrency;
    concurrency = name;
    name = Job.DEFAULT_JOB_NAME;
  }

  if(typeof concurrency === 'function'){
    handler = concurrency;
    concurrency = 1;
  }

  this.setHandler(name, handler);

  var _this = this;
  return this.isReady().then(function(){
    return _this.start(concurrency);
  });
};

//
// This code will be called everytime a job is going to be processed if the job has a repeat option. (from delay -> active).
//
var parser = require('cron-parser');

function nextRepeatableJob(queue, name, data, opts, isRepeat){
  var repeat = opts.repeat;
  var repeatKey = queue.toKey('repeat') + ':' + name + ':' + repeat.cron;

  //
  // Get millis for this repeatable job.
  // Only use `millis` from the `repeatKey` when the job is a repeat, otherwise, we want
  // `Date.now()` to ensure we try to add the next iteration only
  //
  return (isRepeat ? queue.client.get(repeatKey) : Promise.resolve(Date.now())).then(function(millis){
    if(millis){
      return parseInt(millis);
    }else{
      return Date.now();
    }
  }).then(function(millis){
    var interval = parser.parseExpression(repeat.cron, _.defaults({
      currentDate: new Date(millis)
    }, repeat));
    var nextMillis;
    try{
      nextMillis = interval.next();
    } catch(e){
      // Ignore error
    }

    if(nextMillis){
      nextMillis = nextMillis.getTime();
      var delay = nextMillis - Date.now();

      //
      // Generate unique job id for this iteration.
      //
      var customId = 'repeat:' + name + ':' + nextMillis;

      //
      // Set key and add job should be atomic.
      //
      return queue.client.set(repeatKey, nextMillis).then(function(){
        return Job.create(queue, name, data, _.extend(_.clone(opts), {
          jobId: customId,
          delay: delay < 0 ? 0 : delay,
          timestamp: Date.now()
        }));
      });
    }
  });
};

Queue.prototype.start = function(concurrency){
  var _this = this;
  return this.run(concurrency).catch(function(err){
    _this.emit('error', err, 'error running queue');
    throw err;
  });
};

Queue.prototype.setHandler = function(name, handler){
  if(this.handlers[name]) {
    throw new Error('Cannot define the same handler twice ' + name);
  }
  
  handler = handler.bind(this);

  if(handler.length > 1){
    this.handlers[name] = Promise.promisify(handler);
  }else{
    this.handlers[name] = Promise.method(handler);
  }
};

/**
interface JobOptions
{
  attempts: number;

  repeat: {
    tz?: string,
    endDate?: Date | string | number
  }
}
*/

/**
  Adds a job to the queue.
  @method add
  @param data: {} Custom data to store for this job. Should be JSON serializable.
  @param opts: JobOptions Options for this job.
*/
Queue.prototype.add = function(name, data, opts){
  if(opts && opts.repeat){
    return nextRepeatableJob(this, name || DEFAULT_JOB_NAME, data, opts);
  }else{
    return Job.create(this, name, data, opts);
  }
};

/**
  Returns the number of jobs waiting to be processed.
*/
Queue.prototype.count = function(){
  var multi = this.multi();
  multi.llen(this.toKey('wait'));
  multi.llen(this.toKey('paused'));
  multi.zcard(this.toKey('delayed'));

  return multi.exec().then(function(res){
    return Math.max(res[0][1], res[1][1]) + res[2][1];
  });
};

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
  multi.del(this.toKey('meta-paused'));
  multi.del(this.toKey('delayed'));

  return multi.exec().spread(function(waiting, paused){
    waiting = waiting[1];
    paused = paused[1];
    var jobKeys = (paused.concat(waiting)).map(_this.toKey, _this);

    if(jobKeys.length){
      multi = _this.multi();

      multi.del.apply(multi, jobKeys);
      return multi.exec();
    }
  });
};

/**
  Pauses the processing of this queue, locally if true passed, otherwise globally.

  For global pause, we use an atomic RENAME operation on the wait queue. Since
  we have blocking calls with BRPOPLPUSH on the wait queue, as long as the queue
  is renamed to 'paused', no new jobs will be processed (the current ones
  will run until finalized).

  Adding jobs requires a LUA script to check first if the paused list exist
  and in that case it will add it there instead of the wait list.
*/
Queue.prototype.pause = function(isLocal, doNotWaitActive){
  var _this = this;
  return _this.isReady().then(function(){
    if(isLocal){
      if(!_this.paused){
        _this.paused = new Promise(function(resolve) {
          _this.resumeLocal = function() {
            resolve();
            _this.paused = null; // Allow pause to be checked externally for paused state.
          };
        });
      }
      return !doNotWaitActive && _this.whenCurrentJobsFinished();
    }else{
      return scripts.pause(_this, true);
    }
  }).then(function(){
    _this.emit('paused');
  });
};

Queue.prototype.resume = function(isLocal /* Optional */){
  var _this = this;
  return this.isReady().then(function(){
    if(isLocal){
      if(_this.resumeLocal){
        _this.resumeLocal();
      }
    }else{
      return scripts.pause(_this, false); 
    }
  }).then(function(){
    _this.emit('resumed');
  });
};

Queue.prototype.run = function(concurrency){
  var promises = [];
  var _this = this;

  return this.moveUnlockedJobsToWait().then(function(){
    while(concurrency--){
      promises.push(new Promise(function(resolve){
        _this.processJobs(concurrency, resolve);
      }));
    }

    _this.startMoveUnlockedJobsToWait();

    return Promise.all(promises);
  });
};

// ---------------------------------------------------------------------
// Private methods
// ---------------------------------------------------------------------

/**
  This function updates the delay timer, which is a timer that timeouts
  at the next known delayed job.
*/
Queue.prototype.updateDelayTimer = function(newDelayedTimestamp){
  var _this = this;
  newDelayedTimestamp = Math.round(newDelayedTimestamp);
  if(newDelayedTimestamp < _this.delayedTimestamp && newDelayedTimestamp < (MAX_TIMEOUT_MS + Date.now())){
    clearTimeout(this.delayTimer);
    this.delayedTimestamp = newDelayedTimestamp;

    var nextDelayedJob = newDelayedTimestamp - Date.now();
    var delay = nextDelayedJob <= 0 ? 0 : nextDelayedJob;

    var delayUpdate = function(){
      scripts.updateDelaySet(_this, _this.delayedTimestamp).then(function(nextTimestamp){
        if(nextTimestamp){
          nextTimestamp = nextTimestamp < Date.now() ? Date.now() : nextTimestamp;
        }else{
          nextTimestamp = Number.MAX_VALUE;
        }
        _this.updateDelayTimer(nextTimestamp);
      }).catch(function(err){ 
        _this.emit('error', err, 'Error updating the delay timer');
      });
      _this.delayedTimestamp = Number.MAX_VALUE;
    };

    if(delay){
      this.delayTimer = setTimeout(delayUpdate, delay);
    } else {
      this.delayTimer = delayUpdate();
    }
  }
};

/**
 * Process jobs that have been added to the active list but are not being
 * processed properly. This can happen due to a process crash in the middle
 * of processing a job, leaving it in 'active' but without a job lock.
*/
Queue.prototype.moveUnlockedJobsToWait = function(){
  var _this = this;

  if(this.closed){
    return Promise.resolve();
  }

  return scripts.moveUnlockedJobsToWait(this).then(function(responses){
    var handleFailedJobs = responses[0].map(function(jobId){
      return _this.getJobFromId(jobId).then(function(job){
        _this.emit('failed', job, new Error('job stalled more than allowable limit'), 'active' );
        return null;
      });
    });
    var handleStalledJobs = responses[1].map(function(jobId){
      return _this.getJobFromId(jobId).then(function(job){
        _this.emit('stalled', job);
        return null;
      });
    });
    return Promise.all(handleFailedJobs.concat(handleStalledJobs));
  }).catch(function(err){
    _this.emit('error', err, 'Failed to handle unlocked job in active');
  });
};

Queue.prototype.startMoveUnlockedJobsToWait = function() {
  clearInterval(this.moveUnlockedJobsToWaitInterval);
  if (this.settings.stalledInterval > 0){
    this.moveUnlockedJobsToWaitInterval =
      setInterval(this.moveUnlockedJobsToWait, this.settings.stalledInterval);
  }
};

Queue.prototype.processJobs = function(index, resolve){
  var _this = this;
  var processJobs = this.processJobs.bind(this, index, resolve);
  process.nextTick(function(){
    if(!_this.closing){
      (_this.paused || Promise.resolve()).then(function(){
        return _this.processing[index] = _this.getNextJob()
          .then(_this.processJob)
          .then(processJobs, function(err){

            _this.emit('error', err, 'Error processing job');

            //
            // Wait before trying to process again.
            //
            clearTimeout(_this.errorRetryTimer[index]);
            _this.errorRetryTimer[index] = setTimeout(function(){
              processJobs();
            }, _this.settings.retryProcessDelay);
          });
      }).catch(function(err){
        _this.emit('error', err, 'Error processing job');
      });
    }else{
      resolve(_this.closing);
    }
  });
};

Queue.prototype.processJob = function(job){
  var _this = this;
  var lockRenewId;
  var timerStopped = false;

  if(!job){
    return Promise.resolve();
  }

  //
  // There are two cases to take into consideration regarding locks.
  // 1) The lock renewer fails to renew a lock, this should make this job
  // unable to complete, since some other worker is also working on it.
  // 2) The lock renewer is called more seldom than the check for stalled
  // jobs, so we can assume the job has been stalled and is already being processed
  // by another worker. See #308
  //
  var lockExtender = function(){
    lockRenewId = _this.timers.set('lockExtender', _this.settings.lockRenewTime, function(){
      scripts.extendLock(_this, job.id).then(function(lock){
        if(lock && !timerStopped){
          lockExtender();
        }
      }).catch(function(/*err*/){
        // Somehow tell the worker this job should stop processing...
      });
    });
  };

  var timeoutMs = job.opts.timeout;

  function stopTimer(){
    timerStopped = true;
    _this.timers.clear(lockRenewId);
  }

  function handleCompleted(result){
    try{
      JSON.stringify(result);
    }catch(err){
      return handleFailed(err);
    }

    return job.moveToCompleted(result).then(function(){
      _this.emit('completed', job, result, 'active');
      return null;
    });
  }

  function handleFailed(err){
    var error = err.cause || err; //Handle explicit rejection

    return job.moveToFailed(err).then(function(){
      _this.emit('failed', job, error, 'active');
      return null;
    });
  }

  lockExtender();
  var handler = _this.handlers[job.name];
  if(!handler){
    return handleFailed(Error('Missing process handler for job type ' + job.name));
  }else{
    var jobPromise = handler(job);

    if(timeoutMs){
      jobPromise = jobPromise.timeout(timeoutMs);
    }

    // Local event with jobPromise so that we can cancel job.
    // Probably we could have better ways to do this...
    // For example, listen to a global event 'cancel'
    _this.emit('active', job, jobPromise, 'waiting');

    return jobPromise.then(handleCompleted, handleFailed).finally(function(){
      stopTimer();
    });
  }
};

Queue.prototype.multi = function(){
  return this.client.multi();
};

/**
  Returns a promise that resolves to the next job in queue.
*/
Queue.prototype.getNextJob = function() {
  var _this = this;

  if(this.closing){
    return Promise.resolve();
  }

  //
  // Listen for new jobs, during moveToActive or after.
  //
  var resolve;
  var newJobs = new Promise(function(_resolve){
    // Needs to wrap to ignore the emitted value, or the promise will not resolve.
    resolve = function(){
      _resolve();
    };
    _this.on('added', resolve);
    _this.on('global:resumed', resolve);
    _this.on('wait-finished', resolve);
  });

  var removeListeners = function(){
    _this.removeListener('added', resolve);
    _this.removeListener('global:resumed', resolve);
    _this.removeListener('wait-finished', resolve);
  };

  return scripts.moveToActive(this).spread(function(jobData, jobId){
    if(jobData){
      var job = Job.fromData(_this, jobData, jobId);
      if(job.opts.repeat){
        return nextRepeatableJob(_this, job.name, job.data, job.opts, true).then(function(){
          return job;
        });
      }
      return job;
    }else{
      return newJobs;
    }
  }).finally(function(){
    removeListeners();
  });
};

Queue.prototype.getJob = function(jobId){
  return Job.fromId(this, jobId);
};

// Job counts by type
// Queue#getJobCountByTypes('completed') => completed count
// Queue#getJobCountByTypes('completed,failed') => completed + failed count
// Queue#getJobCountByTypes('completed', 'failed') => completed + failed count
// Queue#getJobCountByTypes('completed,waiting', 'failed') => completed + waiting + failed count
Queue.prototype.getJobCountByTypes = function() {
  var _this = this;
  var args = _.compact(Array.prototype.slice.call(arguments));
  var types = _.compact(args.join(',').replace(/ /g, '').split(','));

  var multi = this.multi();

  _.each(types, function(type) {
    var key = _this.toKey(type);
    switch(type) {
      case 'completed':
      case 'failed':
      case 'delayed':
        multi.zcard(key);
        break;
      case 'active':
      case 'wait':
      case 'paused':
        multi.llen(key);
        break;
    }
  });

  return multi.exec().then(function(res){
    return res.map(function(v) {
      return v[1];
    }).reduce(function(a, b) {
      return a + b;
    });	     
  }) || 0;
};

/**
 * Returns all the job counts for every list/set in the queue.
 * 
 */
Queue.prototype.getJobCounts = function(){
  var types = ['waiting', 'active', 'completed', 'failed', 'delayed'];
  var counts = {};
  return this.client.multi()
    .llen(this.toKey('wait'))
    .llen(this.toKey('active'))
    .zcard(this.toKey('completed'))
    .zcard(this.toKey('failed'))
    .zcard(this.toKey('delayed'))
    .exec().then(function(result){
      result.forEach(function(res, index){
        counts[types[index]] = res[1] || 0;
      });
      return counts;
    });
};

Queue.prototype.getCompletedCount = function() {
  return this.client.zcard(this.toKey('completed'));
};

Queue.prototype.getFailedCount = function() {
  return this.client.zcard(this.toKey('failed'));
};

Queue.prototype.getDelayedCount = function() {
  return this.client.zcard(this.toKey('delayed'));
};

Queue.prototype.getActiveCount = function() {
  return this.client.llen(this.toKey('active'));
};

Queue.prototype.getWaitingCount = function() {
  return this.client.llen(this.toKey('wait'));
};

Queue.prototype.getPausedCount = function() {
  return this.client.llen(this.toKey('paused'));
};

Queue.prototype.getWaiting = function(start, end){
  return Promise.join(
    this.getJobs('wait', 'LIST', true, start, end),
    this.getJobs('paused', 'LIST', true, start, end)).spread(function(waiting, paused){
      return _.concat(waiting, paused);
    });
};

Queue.prototype.getActive = function(start, end){
  return this.getJobs('active', 'LIST', true, start, end);
};

Queue.prototype.getDelayed = function(start, end){
  return this.getJobs('delayed', 'ZSET', true, start, end);
};

Queue.prototype.getCompleted = function(start, end){
  return this.getJobs('completed', 'ZSET', false, start, end);
};

Queue.prototype.getFailed = function(start, end){
  return this.getJobs('failed', 'ZSET', false, start, end);
};

Queue.prototype.getJobs = function(queueType, type, asc, start, end){
  var _this = this;
  var key = this.toKey(queueType);
  var jobs;

  start = _.isUndefined(start) ? 0 : start;
  end = _.isUndefined(end) ? -1 : end;

  switch(type){
    case 'LIST':
      if(asc){
        jobs = this.client.lrange(key, -(end + 1), -(start + 1)).then(function(result){
          return result.reverse();
        });
      }else{
        jobs = this.client.lrange(key, start, end);
      }

      break;
    case 'ZSET':
      jobs = asc ? this.client.zrange(key, start, end) : this.client.zrevrange(key, start, end);
      break;
  }

  return jobs.then(function(jobIds){
    var jobsFromId = jobIds.map(_this.getJobFromId);
    return Promise.all(jobsFromId);
  });
};

Queue.prototype.retryJob = function(job) {
  return job.retry();
};

Queue.prototype.toKey = function(queueType){
  return [this.keyPrefix, this.name, queueType].join(':');
};

/*@function clean
 *
 * Cleans jobs from a queue. Similar to remove but keeps jobs within a certian
 * grace period.
 *
 * @param {int} grace - The grace period
 * @param {string} [type=completed] - The type of job to clean. Possible values
 * @param {int} The max number of jobs to clean
 * are completed, waiting, active, delayed, failed. Defaults to completed.
 */
Queue.prototype.clean = function (grace, type, limit) {
  var _this = this;

  if(grace === undefined || grace === null) {
    return Promise.reject(new Error('You must define a grace period.'));
  }

  if(!type) {
    type = 'completed';
  }

  if(_.indexOf([
    'completed',
    'wait',
    'active',
    'delayed',
    'failed'], type) === -1){
    return Promise.reject(new Error('Cannot clean unkown queue type'));
  }

  return scripts.cleanJobsInSet(_this, type, Date.now() - grace, limit).then(function (jobs) {
    _this.emit('cleaned', jobs, type);
    return jobs;
  }).catch(function (err) {
    _this.emit('error', err);
    throw err;
  });
};

/**
 * Returns a promise that resolves when active jobs are cleared
 *
 * @returns {Promise}
 */
Queue.prototype.whenCurrentJobsFinished = function(){
  var _this = this;

  _this.emit('wait-finished');
  return new Promise(function(resolve){
    Promise.all(_this.processing).finally(function(){
      resolve();
    });
  });
};

//
// Private local functions
//
var getRedisVersion = function getRedisVersion(client){
  return client.info().then(function(doc){
    var prefix = 'redis_version:';
    var lines = doc.split('\r\n');
    for(var i = 0; i < lines.length; i++){
      if(lines[i].indexOf(prefix) === 0){
        return lines[i].substr(prefix.length);
      }
    }
  });
};

module.exports = Queue;
