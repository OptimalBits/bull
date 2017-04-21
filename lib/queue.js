/*eslint-env node */
'use strict';

var redis = require('ioredis');
var Disturbed = require('disturbed');
var util = require('util');
var assert = require('assert');
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
    - completed (set)
    - failed (set)

        --> priorities      -- >completed
       /     |            /
    job -> wait -> active
        |    ^            \
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

var LOCK_DURATION = 5000; // 5 seconds is the duration of the lock.

// The interval for which to check for stalled jobs.
var STALLED_JOB_CHECK_INTERVAL = 5000; // 5 seconds is the renew time.

// The maximum number of times a job can be recovered from the 'stalled' state
// (moved back to 'wait'), before it is failed.
var MAX_STALLED_JOB_COUNT = 1;

var POLLING_INTERVAL = 5000;

var RETRY_PROCESS_DELAY = 5000;

var REDLOCK_DRIFT_FACTOR = 0.01;
var REDLOCK_RETRY_COUNT = 0;
var REDLOCK_RETRY_DELAY = 200;

var MAX_TIMEOUT_MS = Math.pow(2, 31) - 1; // 32 bit signed


var Queue = function Queue(name, redisPort, redisHost, redisOptions){
  if(!(this instanceof Queue)){
    return new Queue(name, redisPort, redisHost, redisOptions);
  }

  if(_.isObject(redisPort)) {
    var opts = redisPort;
    var redisOpts = opts.redis || {};
    redisPort = redisOpts.port;
    redisHost = redisOpts.host;
    redisOptions = redisOpts.opts || {};
    redisOptions.db = redisOpts.DB || redisOpts.DB;
  } else if(parseInt(redisPort) == redisPort) {
    redisPort = parseInt(redisPort);
    redisOptions =  redisOptions || {};
  } else if(_.isString(redisPort)) {
    try {
      var redisUrl = url.parse(redisPort);
      assert(_.isObject(redisHost) || _.isUndefined(redisHost),
          'Expected an object as redis option');
      redisOptions =  redisHost || {};
      redisPort = redisUrl.port;
      redisHost = redisUrl.hostname;
      if (redisUrl.auth) {
        redisOptions.password = redisUrl.auth.split(':')[1];
      }
    } catch (e) {
      throw new Error(e.message);
    }
  }

  redisOptions = redisOptions || {};

  function createClient(type) {
    var client;
    if(_.isFunction(redisOptions.createClient)){
      client = redisOptions.createClient(type);
    }else{
      client = new redis(redisPort, redisHost, redisOptions);
    }
    return client;
  }

  redisPort = redisPort || 6379;
  redisHost = redisHost || '127.0.0.1';

  var _this = this;

  this.name = name;
  this.keyPrefix = redisOptions.keyPrefix || 'bull';
  this.token = uuid();

  //
  // We cannot use ioredis keyPrefix feature until we
  // stop creating keys dynamically in lua scripts.
  //
  delete redisOptions.keyPrefix;

  //
  // Create queue client (used to add jobs, pause queues, etc);
  //
  this.client = createClient('client');

  getRedisVersion(this.client).then(function(version){
    if(semver.lt(version, MINIMUM_REDIS_VERSION)){
      throw new Error('Redis version needs to be greater than ' + MINIMUM_REDIS_VERSION + '. Current: ' + version);
    }
  }).catch(function(err){
    _this.emit('error', err);
  });

  //
  // Keep track of cluster clients for redlock
  // (Redlock is not used ATM.)
  this.clients = [this.client];
  if (redisOptions.clients) {
    this.clients.push.apply(this.clients, redisOptions.clients);
  }
  this.redlock = {
    driftFactor: REDLOCK_DRIFT_FACTOR,
    retryCount: REDLOCK_RETRY_COUNT,
    retryDelay: REDLOCK_RETRY_DELAY
  };
  _.extend(this.redlock, redisOptions.redlock || {});

  //
  // Create event subscriber client (receive messages from other instance of the queue)
  //
  this.eclient = createClient('subscriber');

  this.handlers = {};
  this.delayTimer = null;
  this.processing = [];
  this.retrieving = 0;

  this.LOCK_DURATION = LOCK_DURATION;
  this.LOCK_RENEW_TIME = LOCK_DURATION / 2;
  this.STALLED_JOB_CHECK_INTERVAL = STALLED_JOB_CHECK_INTERVAL;
  this.MAX_STALLED_JOB_COUNT = MAX_STALLED_JOB_COUNT;

  // bubble up Redis error events
  [this.client, this.eclient].forEach(function (client) {
    client.on('error', _this.emit.bind(_this, 'error'));
  });

  // keeps track of active timers. used by close() to
  // ensure that disconnect() is deferred until all
  // scheduled redis commands have been executed
  this.timers = new TimerManager();

  // emit ready when redis connections ready
  var initializers = [this.client, this.eclient].map(function (client) {
    return new Promise(function(resolve, reject) {
      client.once('ready', resolve);
      client.once('error', reject);
    });
  });

  var events = [
    'delayed',
    'paused',
    'resumed',
    'added'
  ]
  this._initializing = Promise.all(initializers).then(function(){
    return Promise.all(events.map(function(event){
      return _this.eclient.subscribe(_this.toKey(event))
    })).then(function(){
      return commands(_this.client);
    });
  }).then(function(){
    debuglog(name + ' queue ready');
    _this.emit('ready');
  }, function(err){
    _this.emit('error', err, 'Error initializing queue');
  });

  //
  // Handle delay, pause and resume messages
  //
  this.eclient.on('message', function(channel, message){
    switch(channel){
      case _this.toKey('delayed'):
        _this.updateDelayTimer(message);
        break;
      case _this.toKey('paused'):
      case _this.toKey('resumed'):
        _this.emit(message);
        break;
      case _this.toKey('added'):
        _this.emit('added', message);
        break;
    }
  });

  Disturbed.call(this, _this.client, _this.eclient);

  //
  // Listen distributed queue events
  //
  listenDistEvent('waiting'); //
  listenDistEvent('active'); //
  listenDistEvent('progress'); //
  listenDistEvent('stalled'); //
  listenDistEvent('completed'); //
  listenDistEvent('failed'); //
  listenDistEvent('cleaned'); 
  listenDistEvent('remove'); //

  function listenDistEvent(eventName){
    var _eventName = eventName + '@' + name;
    _this.on(_eventName, function(){
      var args = Array.prototype.slice.call(arguments);

      if(eventName !== 'cleaned' && eventName !== 'error'){
        args[0] = Job.fromJSON(_this, args[0]);
      }

      args.unshift('global:' + eventName);
      _this.emit.apply(_this, args);
    }, true);
  }

  this.delayedTimestamp = Number.MAX_VALUE;
  this.isReady().then(function(){
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

util.inherits(Queue, Disturbed);

function setGuardianTimer(queue){
  return setInterval(function() {
    if(queue.delayedTimestamp < Date.now() || queue.delayedTimestamp - Date.now() > POLLING_INTERVAL){
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
  }, POLLING_INTERVAL);
}

Queue.ErrorMessages = errors.Messages;

Queue.prototype.isReady = function(){
  var _this = this;
  return this._initializing.then(function(){
    return _this;
  });
}

Queue.prototype.whenCurrentMoveFinished = function(){
  var currentMove = this.client.commandQueue.peekFront()
  return currentMove && currentMove.command.promise || Promise.resolve();
};
/**
 *
 * Emits a distributed event.
 */
Queue.prototype.distEmit = function(){
  var args = Array.prototype.slice.call(arguments);

   // Emit local event
  this.emit.apply(this, args);

  // Emit global event
  args[0] = args[0] + '@' + this.name;
  return Disturbed.prototype.distEmit.apply(this, args);
}

Queue.prototype.on = function(){
  var args = Array.prototype.slice.call(arguments);
  var promise = Disturbed.prototype.on.apply(this, args);
  var _this = this;
  promise.catch(function(err){ _this.emit('error', err); });
  return this;
};

Queue.prototype.once = function(){
  var args = Array.prototype.slice.call(arguments);
  Disturbed.prototype.once.apply(this, args);
  return this;
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

  return this.closing = this._initializing.then(function(){
    _.each(_this.errorRetryTimer, function(timer){
      clearTimeout(timer);
    });
    clearTimeout(_this.delayTimer);
    clearInterval(_this.guardianTimer);
    clearInterval(_this.moveUnlockedJobsToWaitInterval);
    _this.timers.clearAll();
    return _this.timers.whenIdle().then(function(){
      return _this.pause(true, doNotWaitJobs);
    }).then(function(){
      return _this.disconnect();
    }).then(function(){
      _this.closed = true;
    });
  });
};

/**
  Processes a job from the queue. The callback is called for every job that
  is dequeued.

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

Queue.prototype.start = function(concurrency){
  var _this = this;
  return this.run(concurrency).catch(function(err){
    _this.emit('error', err, 'error running queue');
    throw err;
  });
}

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
}
*/

/**
  Adds a job to the queue.
  @method add
  @param data: {} Custom data to store for this job. Should be JSON serializable.
  @param opts: JobOptions Options for this job.
*/
Queue.prototype.add = function(name, data, opts){
  return Job.create(this, name, data, opts);
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
  if(isLocal){
    var _this = this;

    if(!this.paused){
      this.paused = new Promise(function(resolve) {
        _this.resumeLocal = function() {
          resolve();
          _this.paused = null; // Allow pause to be checked externally for paused state.
        };
      });
    }
    return !doNotWaitActive && this.whenCurrentJobsFinished();
  }else{
    return pauseResumeGlobal(this, true);
  }
};

Queue.prototype.resume = function(isLocal /* Optional */){
  if(isLocal){
    if(this.resumeLocal){
      this.resumeLocal();
    }
    return Promise.resolve();
  }else{
    return pauseResumeGlobal(this, false);
  }
};

//
// TODO: move to scripts module.
//
function pauseResumeGlobal(queue, pause){
  var src = 'wait', dst = 'paused';
  if(!pause){
    src = 'paused';
    dst = 'wait';
  }

  var script = [
    'if redis.call("EXISTS", KEYS[1]) == 1 then',
    ' redis.call("RENAME", KEYS[1], KEYS[2])',
    'end',
    'if ARGV[1] == "paused" then',
    ' redis.call("SET", KEYS[3], 1)',
    'else',
    ' redis.call("DEL", KEYS[3])',
    'end',
    'redis.call("PUBLISH", KEYS[4], ARGV[1])'
  ].join('\n');

  var keys = _.map([src, dst, 'meta-paused', 'paused'], function(name){
    return queue.toKey(name);
  });

  return queue.client.eval(script, keys.length, keys[0], keys[1], keys[2], keys[3], pause ? 'paused' : 'resumed');
}

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
  if(newDelayedTimestamp < _this.delayedTimestamp && newDelayedTimestamp < (MAX_TIMEOUT_MS + Date.now())){
    clearTimeout(this.delayTimer);
    this.delayedTimestamp = newDelayedTimestamp;

    var nextDelayedJob = newDelayedTimestamp - Date.now();
    nextDelayedJob = nextDelayedJob < 0 ? 0 : nextDelayedJob;

    this.delayTimer = setTimeout(function(){
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
    }, nextDelayedJob);
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
        _this.distEmit('failed', job, new Error('job stalled more than allowable limit'), 'active' );
        return null;
      });
    });
    var handleStalledJobs = responses[1].map(function(jobId){
      return _this.getJobFromId(jobId).then(function(job){
        _this.distEmit('stalled', job);
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
  if (this.STALLED_JOB_CHECK_INTERVAL > 0){
    this.moveUnlockedJobsToWaitInterval =
      setInterval(this.moveUnlockedJobsToWait, this.STALLED_JOB_CHECK_INTERVAL);
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
            //
            // Wait before trying to process again.
            //
            clearTimeout(_this.errorRetryTimer[index]);
            _this.errorRetryTimer[index] = setTimeout(function(){
              processJobs();
            }, RETRY_PROCESS_DELAY)
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
    _this.timers.set('lockExtender', _this.LOCK_RENEW_TIME, function(){
      if(!timerStopped){
        scripts.extendLock(_this, job.id).then(function(lock){
          if(lock){
            lockExtender();
          }
        }).catch(function(err){
          // Somehow tell the worker this job should stop processing...
        });
      }
    });
  }

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
      return _this.distEmit('completed', job, result, 'active');
    }).finally(function(){
      stopTimer();
    })
  }

  function handleFailed(err){
    var error = err.cause || err; //Handle explicit rejection

    // See https://github.com/OptimalBits/bull/pull/415#issuecomment-269744735
    return job.moveToFailed(err).then(function(){
      return _this.distEmit('failed', job, error, 'active');
    }).finally(function(){
      stopTimer();
    })
  }

  lockExtender()
  var handler = _this.handlers[job.name];
  if(!handler){
    return handleFailed(Error('Missing process handler for job type ' + job.name));
  }else{
    var jobPromise = handler(job);

    if(timeoutMs){
      jobPromise = jobPromise.timeout(timeoutMs);
    }

    _this.distEmit('active', job, jobPromise, 'waiting');

    return jobPromise.then(handleCompleted, handleFailed);
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
    }
    _this.on('added', resolve);
    _this.on('resumed', resolve);
    _this.on('wait-finished', resolve);
  });

  var removeListeners = function(){
    _this.removeListener('added', resolve);
    _this.removeListener('resumed', resolve);
    _this.removeListener('wait-finished', resolve);
  }

  return scripts.moveToActive(this).spread(function(jobData, jobId){
    if(jobData){
      return Job.fromData(_this, jobData, jobId);
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
      return v[1]
    }).reduce(function(a, b) {
      return a + b
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
    this.getJobs('wait', 'LIST', start, end),
    this.getJobs('paused', 'LIST', start, end)).spread(function(waiting, paused){
      return _.concat(waiting, paused);
    });
};

Queue.prototype.getActive = function(start, end){
  return this.getJobs('active', 'LIST', start, end);
};

Queue.prototype.getDelayed = function(start, end){
  return this.getJobs('delayed', 'ZSET', start, end);
};

Queue.prototype.getCompleted = function(start, end){
  return this.getJobs('completed', 'ZSET', start, end);
};

Queue.prototype.getFailed = function(start, end){
  return this.getJobs('failed', 'ZSET', start, end);
};

Queue.prototype.getJobs = function(queueType, type, start, end){
  var _this = this;
  var key = this.toKey(queueType);
  var jobs;

  start = _.isUndefined(start) ? 0 : start;
  end = _.isUndefined(end) ? -1 : end;

  switch(type){
    case 'LIST':
      jobs = this.client.lrange(key, start, end);
      break;
    case 'ZSET':
      jobs = this.client.zrange(key, start, end);
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
    _this.distEmit('cleaned', jobs, type);
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
