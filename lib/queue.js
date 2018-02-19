/*eslint-env node */
'use strict';

var redis = require('ioredis');
var EventEmitter = require('events');

var _ = require('lodash');

var util = require('util');
var url = require('url');
var Job = require('./job');
var scripts = require('./scripts');
var errors = require('./errors');
var utils = require('./utils');

var TimerManager = require('./timer-manager');
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
var MINIMUM_REDIS_VERSION = '2.8.18';
var MAX_TIMEOUT_MS = Math.pow(2, 31) - 1; // 32 bit signed

/*
  interface QueueOptions {
    prefix?: string = 'bull',
    limiter?: RateLimiter,
    redis : RedisOpts, // ioredis defaults,
    createClient?: (type: enum('client', 'subscriber'), redisOpts?: RedisOpts) => redisClient,
    defaultJobOptions?: JobOptions,

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

  interface RateLimiter {
    max: number,      // Number of jobs
    duration: number, // per duration milliseconds
  }
*/

// Queue(name: string, url?, opts?)
var Queue = function Queue(name, url, opts) {
  var _this = this;
  if (!(this instanceof Queue)) {
    return new Queue(name, url, opts);
  }

  if (_.isString(url)) {
    opts = _.extend(
      {},
      {
        redis: redisOptsFromUrl(url)
      },
      opts
    );
  } else {
    opts = url;
  }

  opts = _.cloneDeep(opts || {});

  if (opts && !_.isObject(opts)) {
    throw Error('Options must be a valid object');
  }

  if (opts.limiter) {
    this.limiter = opts.limiter;
  }

  if (opts.defaultJobOptions) {
    this.defaultJobOptions = opts.defaultJobOptions;
  }

  this.name = name;
  this.token = uuid();

  opts.redis = opts.redis || {};

  _.defaults(opts.redis, {
    port: 6379,
    host: '127.0.0.1',
    db: opts.redis.db || opts.redis.DB,
    retryStrategy: function(times) {
      return Math.min(Math.exp(times), 20000);
    }
  });

  this.keyPrefix = opts.redis.keyPrefix || opts.prefix || 'bull';

  //
  // We cannot use ioredis keyPrefix feature since we
  // create keys dynamically in lua scripts.
  //
  delete opts.redis.keyPrefix;

  this.clients = [];
  var lazyClient = redisClientGetter(this, opts, function(type, client) {
    // bubble up Redis error events
    client.on('error', _this.emit.bind(_this, 'error'));

    if (type === 'client') {
      _this._initializing = commands(client).then(
        function() {
          debuglog(name + ' queue ready');
        },
        function(err) {
          _this.emit('error', new Error('Error initializing Lua scripts'));
          throw err;
        }
      );
    }
  });

  Object.defineProperties(this, {
    //
    // Queue client (used to add jobs, pause queues, etc);
    //
    client: {
      get: lazyClient('client')
    },
    //
    // Event subscriber client (receive messages from other instance of the queue)
    //
    eclient: {
      get: lazyClient('subscriber')
    },
    bclient: {
      get: lazyClient('bclient')
    }
  });

  if (opts.skipVersionCheck !== true) {
    getRedisVersion(this.client)
      .then(function(version) {
        if (semver.lt(version, MINIMUM_REDIS_VERSION)) {
          _this.emit(
            'error',
            new Error(
              'Redis version needs to be greater than ' +
                MINIMUM_REDIS_VERSION +
                '. Current: ' +
                version
            )
          );
        }
      })
      .catch(function(/*err*/) {
        // Ignore this error.
      });
  }

  this.handlers = {};
  this.delayTimer;
  this.processing = [];
  this.retrieving = 0;

  this.settings = _.defaults(opts.settings, {
    lockDuration: 30000,
    stalledInterval: 30000,
    maxStalledCount: 1,
    guardInterval: 5000,
    retryProcessDelay: 5000,
    drainDelay: 5,
    backoffStrategies: {}
  });

  this.settings.lockRenewTime =
    this.settings.lockRenewTime || this.settings.lockDuration / 2;

  this.on('error', function() {
    // Dummy handler to avoid process to exit with an unhandled exception.
  });

  // keeps track of active timers. used by close() to
  // ensure that disconnect() is deferred until all
  // scheduled redis commands have been executed
  this.timers = new TimerManager();

  // Bind these methods to avoid constant rebinding and/or creating closures
  // in processJobs etc.
  this.moveUnlockedJobsToWait = this.moveUnlockedJobsToWait.bind(this);
  this.processJob = this.processJob.bind(this);
  this.getJobFromId = Job.fromId.bind(null, this);

  var keys = {};
  _.each(
    [
      '',
      'active',
      'wait',
      'waiting',
      'paused',
      'resumed',
      'meta-paused',
      'active',
      'id',
      'delayed',
      'priority',
      'stalled-check',
      'completed',
      'failed',
      'stalled',
      'repeat',
      'limiter',
      'drained',
      'progress'
    ],
    function(key) {
      keys[key] = _this.toKey(key);
    }
  );
  this.keys = keys;
};

function redisClientGetter(queue, options, initCallback) {
  var createClient = _.isFunction(options.createClient)
    ? options.createClient
    : function(type, config) {
        return new redis(config);
      };

  var connections = {};

  return function(type) {
    return function() {
      // getter function
      if (connections[type] != null) return connections[type];
      var client = (connections[type] = createClient(type, options.redis));
      if (!options.createClient) {
        queue.clients.push(client);
      }
      return initCallback(type, client), client;
    };
  };
}

function redisOptsFromUrl(urlString) {
  var redisOpts = {};
  try {
    var redisUrl = url.parse(urlString);
    redisOpts.port = redisUrl.port || 6379;
    redisOpts.host = redisUrl.hostname;
    redisOpts.db = redisUrl.pathname ? redisUrl.pathname.split('/')[1] : 0;
    if (redisUrl.auth) {
      redisOpts.password = redisUrl.auth.split(':')[1];
    }
  } catch (e) {
    throw new Error(e.message);
  }
  return redisOpts;
}

function setGuardianTimer(queue) {
  return setInterval(function() {
    var now = Date.now();
    if (
      queue.delayedTimestamp < now ||
      queue.delayedTimestamp - now > queue.settings.guardInterval
    ) {
      scripts
        .updateDelaySet(queue, now)
        .then(function(timestamp) {
          if (timestamp) {
            queue.updateDelayTimer(timestamp);
          }
          return null;
        })
        .catch(function(err) {
          queue.emit('error', err);
        })
        .return(null);
    }
  }, queue.settings.guardInterval);
}

util.inherits(Queue, EventEmitter);

//
// Extend Queue with "aspects"
//
require('./getters')(Queue);
require('./worker')(Queue);
require('./repeatable')(Queue);

// --
Queue.prototype.off = Queue.prototype.removeListener;

var _on = Queue.prototype.on;

Queue.prototype.on = function(eventName) {
  this._registerEvent(eventName);
  return _on.apply(this, arguments);
};

var _once = Queue.prototype.once;

Queue.prototype.once = function(eventName) {
  this._registerEvent(eventName);
  return _once.apply(this, arguments);
};

Queue.prototype._initProcess = function() {
  var _this = this;
  if (!this._initializingProcess) {
    //
    // Only setup listeners if .on/.addEventListener called, or process function defined.
    //
    this.delayedTimestamp = Number.MAX_VALUE;
    this._initializingProcess = this.isReady()
      .then(function() {
        return _this._registerEvent('delayed');
      })
      .then(function() {
        //
        // Init delay timestamp.
        //
        return scripts
          .updateDelaySet(_this, Date.now())
          .then(function(timestamp) {
            if (timestamp) {
              _this.updateDelayTimer(timestamp);
            }
            return null;
          })
          .return(null);
      })
      .then(function() {
        //
        // Create a guardian timer to revive delayTimer if necessary
        // This is necessary when redis connection is unstable, which can cause the pub/sub to fail
        //
        _this.guardianTimer = setGuardianTimer(_this);
      });

    this.errorRetryTimer = {};
  }

  return this._initializingProcess;
};

Queue.prototype._setupQueueEventListeners = function() {
  /*
    if(eventName !== 'cleaned' && eventName !== 'error'){
      args[0] = Job.fromJSON(_this, args[0]);
    }
  */
  var _this = this;
  var activeKey = _this.keys.active;
  var stalledKey = _this.keys.stalled;
  var progressKey = _this.keys.progress;
  var delayedKey = _this.keys.delayed;
  var pausedKey = _this.keys.paused;
  var resumedKey = _this.keys.resumed;
  var waitingKey = _this.keys.waiting;
  var completedKey = _this.keys.completed;
  var failedKey = _this.keys.failed;
  var drainedKey = _this.keys.drained;

  this.eclient.on('pmessage', function(pattern, channel, message) {
    var keyAndToken = channel.split('@');
    var key = keyAndToken[0];
    var token = keyAndToken[1];
    switch (key) {
      case activeKey:
        _this.emit('global:active', message, 'waiting');
        break;
      case waitingKey:
        if (_this.token === token) {
          _this.emit('waiting', message, null);
        }
        token && _this.emit('global:waiting', message, null);
        break;
      case stalledKey:
        if (_this.token === token) {
          _this.emit('stalled', message);
        }
        _this.emit('global:stalled', message);
        break;
    }
  });

  this.eclient.on('message', function(channel, message) {
    var key = channel.split('@')[0];
    switch (key) {
      case progressKey:
        var jobAndProgress = message.split(',');
        _this.emit('global:progress', jobAndProgress[0], jobAndProgress[1]);
        break;
      case delayedKey:
        _this.updateDelayTimer(message);
        break;
      case pausedKey:
      case resumedKey:
        _this.emit('global:' + message);
        break;
      case completedKey:
        var data = JSON.parse(message);
        _this.emit('global:completed', data.jobId, data.val, 'active');
        break;
      case failedKey:
        var data = JSON.parse(message);
        _this.emit('global:failed', data.jobId, data.val, 'active');
        break;
      case drainedKey:
        _this.emit('global:drained');
        break;
    }
  });
};

Queue.prototype._registerEvent = function(eventName) {
  var internalEvents = ['waiting', 'delayed'];

  if (
    eventName.startsWith('global:') ||
    internalEvents.indexOf(eventName) !== -1
  ) {
    if (!this.registeredEvents) {
      this._setupQueueEventListeners();
      this.registeredEvents = this.registeredEvents || {};
    }

    var _eventName = eventName.replace('global:', '');

    if (!this.registeredEvents[_eventName]) {
      var _this = this;

      return utils
        .isRedisReady(this.eclient)
        .then(function() {
          var channel = _this.toKey(_eventName);
          if (['active', 'waiting', 'stalled'].indexOf(_eventName) !== -1) {
            return (_this.registeredEvents[
              _eventName
            ] = _this.eclient.psubscribe(channel + '*'));
          } else {
            return (_this.registeredEvents[
              _eventName
            ] = _this.eclient.subscribe(channel));
          }
        })
        .then(function() {
          _this.emit('registered:' + eventName);
        });
    } else {
      return this.registeredEvents[_eventName];
    }
  }
  return Promise.resolve();
};

Queue.ErrorMessages = errors.Messages;

Queue.prototype.isReady = function() {
  var _this = this;
  return this._initializing.then(function() {
    return _this;
  });
};

function redisClientDisconnect(client) {
  if (client.status === 'end') {
    return Promise.resolve();
  }
  var _resolve, _reject;
  return new Promise(function(resolve, reject) {
    _resolve = resolve;
    _reject = reject;
    client.once('end', resolve);
    client.once('error', reject);

    client
      .quit()
      .catch(function(err) {
        if (err.message !== 'Connection is closed.') {
          throw err;
        }
      })
      .timeout(500)
      .catch(function() {
        client.disconnect();
      });
  }).finally(function() {
    client.removeListener('end', _resolve);
    client.removeListener('error', _reject);
  });
}

Queue.prototype.disconnect = function() {
  //
  // TODO: Only quit clients that we "own".
  //
  var clients = this.clients.filter(function(client) {
    return client.status !== 'end';
  });

  return Promise.all(clients.map(redisClientDisconnect))
    .catch(function(err) {
      return console.error(err);
    })
    .then(function() {
      return null;
    });
};

Queue.prototype.close = function(doNotWaitJobs) {
  var _this = this;

  if (this.closing) {
    return this.closing;
  }

  return (this.closing = this.isReady()
    .then(
      function() {
        return _this._initializingProcess;
      },
      function(/*err*/) {
        // Ignore this error and try to close anyway.
      }
    )
    .finally(function() {
      return _this._clearTimers();
    })
    .then(function() {
      return _this.pause(true, doNotWaitJobs);
    })
    .then(
      function() {
        return _this.disconnect();
      },
      function(/*err*/) {
        // Ignore this error and try to close anyway.
      }
    )
    .finally(function() {
      _this.childPool && _this.childPool.clean();
      _this.closed = true;
    }));
};

Queue.prototype._clearTimers = function() {
  var _this = this;
  _.each(_this.errorRetryTimer, function(timer) {
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
Queue.prototype.process = function(name, concurrency, handler) {
  switch (arguments.length) {
    case 1:
      handler = name;
      concurrency = 1;
      name = Job.DEFAULT_JOB_NAME;
      break;
    case 2: // (string, function) or (string, string) or (number, function) or (number, string)
      handler = concurrency;
      if (typeof name === 'string') {
        concurrency = 1;
      } else {
        concurrency = name;
        name = Job.DEFAULT_JOB_NAME;
      }
      break;
  }

  this.setHandler(name, handler);

  var _this = this;
  return this._initProcess().then(function() {
    return _this.start(concurrency);
  });
};

Queue.prototype.start = function(concurrency) {
  var _this = this;

  return this.run(concurrency).catch(function(err) {
    _this.emit('error', err, 'error running queue');
    throw err;
  });
};

Queue.prototype.setHandler = function(name, handler) {
  if (!handler) {
    throw new Error('Cannot set an undefined handler');
  }
  if (this.handlers[name]) {
    throw new Error('Cannot define the same handler twice ' + name);
  }

  this.setWorkerName();

  if (typeof handler === 'string') {
    this.childPool = this.childPool || require('./process/child-pool')();
    var sandbox = require('./process/sandbox');
    this.handlers[name] = sandbox(handler, this.childPool).bind(this);
  } else {
    handler = handler.bind(this);

    if (handler.length > 1) {
      this.handlers[name] = Promise.promisify(handler);
    } else {
      this.handlers[name] = Promise.method(handler);
    }
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
Queue.prototype.add = function(name, data, opts) {
  if (typeof name !== 'string') {
    opts = data;
    data = name;
    name = Job.DEFAULT_JOB_NAME;
  }
  opts = _.cloneDeep(opts || {});
  _.defaults(opts, this.defaultJobOptions);

  if (opts.repeat) {
    var _this = this;
    return this.isReady().then(function() {
      return _this.nextRepeatableJob(name, data, opts);
    });
  } else {
    return Job.create(this, name, data, opts);
  }
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
Queue.prototype.empty = function() {
  var _this = this;

  // Get all jobids and empty all lists atomically.
  var multi = this.multi();

  multi.lrange(this.toKey('wait'), 0, -1);
  multi.lrange(this.toKey('paused'), 0, -1);
  multi.del(this.toKey('wait'));
  multi.del(this.toKey('paused'));
  multi.del(this.toKey('meta-paused'));
  multi.del(this.toKey('delayed'));

  return multi.exec().spread(function(waiting, paused) {
    waiting = waiting[1];
    paused = paused[1];
    var jobKeys = paused.concat(waiting).map(_this.toKey, _this);

    if (jobKeys.length) {
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
Queue.prototype.pause = function(isLocal, doNotWaitActive) {
  var _this = this;
  return _this
    .isReady()
    .then(function() {
      if (isLocal) {
        if (!_this.paused) {
          _this.paused = new Promise(function(resolve) {
            _this.resumeLocal = function() {
              resolve();
              _this.paused = null; // Allow pause to be checked externally for paused state.
            };
          });
        }
        return !doNotWaitActive && _this.whenCurrentJobsFinished();
      } else {
        return scripts.pause(_this, true);
      }
    })
    .then(function() {
      return _this.emit('paused');
    });
};

Queue.prototype.resume = function(isLocal /* Optional */) {
  var _this = this;
  return this.isReady()
    .then(function() {
      if (isLocal) {
        if (_this.resumeLocal) {
          _this.resumeLocal();
        }
      } else {
        return scripts.pause(_this, false);
      }
    })
    .then(function() {
      _this.emit('resumed');
    });
};

Queue.prototype.run = function(concurrency) {
  var promises = [];
  var _this = this;

  return this.isReady()
    .then(function() {
      return _this.moveUnlockedJobsToWait();
    })
    .then(function() {
      return utils.isRedisReady(_this.bclient);
    })
    .then(function() {
      while (concurrency--) {
        promises.push(
          new Promise(function(resolve) {
            _this.processJobs(concurrency, resolve);
          })
        );
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
Queue.prototype.updateDelayTimer = function(newDelayedTimestamp) {
  var _this = this;
  var now = Date.now();
  newDelayedTimestamp = Math.round(newDelayedTimestamp);
  if (
    newDelayedTimestamp < _this.delayedTimestamp &&
    newDelayedTimestamp < MAX_TIMEOUT_MS + now
  ) {
    clearTimeout(this.delayTimer);
    this.delayedTimestamp = newDelayedTimestamp;

    var nextDelayedJob = newDelayedTimestamp - now;
    var delay = nextDelayedJob <= 0 ? 0 : nextDelayedJob;

    var delayUpdate = function() {
      scripts
        .updateDelaySet(_this, _this.delayedTimestamp)
        .then(function(nextTimestamp) {
          if (nextTimestamp) {
            nextTimestamp = nextTimestamp < now ? now : nextTimestamp;
          } else {
            nextTimestamp = Number.MAX_VALUE;
          }
          return _this.updateDelayTimer(nextTimestamp);
        })
        .catch(function(err) {
          _this.emit('error', err, 'Error updating the delay timer');
        })
        .return(null);
      _this.delayedTimestamp = Number.MAX_VALUE;
    };

    if (delay) {
      this.delayTimer = setTimeout(delayUpdate, delay);
    } else {
      delayUpdate();
    }
  }
  return null;
};

/**
 * Process jobs that have been added to the active list but are not being
 * processed properly. This can happen due to a process crash in the middle
 * of processing a job, leaving it in 'active' but without a job lock.
 */
Queue.prototype.moveUnlockedJobsToWait = function() {
  var _this = this;

  if (this.closed) {
    return Promise.resolve();
  }

  return scripts
    .moveUnlockedJobsToWait(this)
    .spread(function(failed, stalled) {
      var handleFailedJobs = failed.map(function(jobId) {
        return _this.getJobFromId(jobId).then(function(job) {
          _this.emit(
            'failed',
            job,
            new Error('job stalled more than allowable limit'),
            'active'
          );
          return null;
        });
      });
      var handleStalledJobs = stalled.map(function(jobId) {
        return _this.getJobFromId(jobId).then(function(job) {
          _this.emit('stalled', job);
          return null;
        });
      });
      return Promise.all(handleFailedJobs.concat(handleStalledJobs));
    })
    .catch(function(err) {
      _this.emit('error', err, 'Failed to handle unlocked job in active');
    });
};

Queue.prototype.startMoveUnlockedJobsToWait = function() {
  clearInterval(this.moveUnlockedJobsToWaitInterval);
  if (this.settings.stalledInterval > 0) {
    this.moveUnlockedJobsToWaitInterval = setInterval(
      this.moveUnlockedJobsToWait,
      this.settings.stalledInterval
    );
  }
};

/*
  Process jobs. Note last argument 'job' is optional.
*/
Queue.prototype.processJobs = function(index, resolve, job) {
  var _this = this;
  var processJobs = this.processJobs.bind(this, index, resolve);
  process.nextTick(function() {
    if (!_this.closing) {
      (_this.paused || Promise.resolve())
        .then(function() {
          var gettingNextJob = job ? Promise.resolve(job) : _this.getNextJob();

          return (_this.processing[index] = gettingNextJob
            .then(_this.processJob)
            .then(processJobs, function(err) {
              _this.emit('error', err, 'Error processing job');

              //
              // Wait before trying to process again.
              //
              clearTimeout(_this.errorRetryTimer[index]);
              _this.errorRetryTimer[index] = setTimeout(function() {
                processJobs();
              }, _this.settings.retryProcessDelay);

              return null;
            }));
        })
        .catch(function(err) {
          _this.emit('error', err, 'Error processing job');
        });
    } else {
      resolve(_this.closing);
    }
  });
};

Queue.prototype.processJob = function(job) {
  var _this = this;
  var lockRenewId;
  var timerStopped = false;

  if (!job) {
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
  var lockExtender = function() {
    lockRenewId = _this.timers.set(
      'lockExtender',
      _this.settings.lockRenewTime,
      function() {
        scripts
          .extendLock(_this, job.id)
          .then(function(lock) {
            if (lock && !timerStopped) {
              lockExtender();
            }
          })
          .catch(function(/*err*/) {
            // Somehow tell the worker this job should stop processing...
          });
      }
    );
  };

  var timeoutMs = job.opts.timeout;

  function stopTimer() {
    timerStopped = true;
    _this.timers.clear(lockRenewId);
  }

  function handleCompleted(result) {
    return job.moveToCompleted(result).then(function(jobData) {
      _this.emit('completed', job, result, 'active');
      return jobData ? _this.nextJobFromJobData(jobData[0], jobData[1]) : null;
    });
  }

  function handleFailed(err) {
    var error = err.cause || err; //Handle explicit rejection

    return job.moveToFailed(err).then(function(jobData) {
      _this.emit('failed', job, error, 'active');
      return jobData ? _this.nextJobFromJobData(jobData[0], jobData[1]) : null;
    });
  }

  lockExtender();
  var handler = _this.handlers[job.name];

  if (!handler) {
    return handleFailed(
      Error('Missing process handler for job type ' + job.name)
    );
  } else {
    var jobPromise = handler(job);

    if (timeoutMs) {
      jobPromise = jobPromise.timeout(timeoutMs);
    }

    // Local event with jobPromise so that we can cancel job.
    _this.emit('active', job, jobPromise, 'waiting');

    return jobPromise
      .then(handleCompleted)
      .catch(handleFailed)
      .finally(function() {
        stopTimer();
      });
  }
};

Queue.prototype.multi = function() {
  return this.client.multi();
};

/**
  Returns a promise that resolves to the next job in queue.
*/
Queue.prototype.getNextJob = function() {
  var _this = this;

  if (this.closing) {
    return Promise.resolve();
  }
  if (this.drained) {
    //
    // Waiting for new jobs to arrive
    //
    return this.bclient
      .brpoplpush(this.keys.wait, this.keys.active, _this.settings.drainDelay)
      .then(
        function(jobId) {
          if (jobId) {
            return _this.moveToActive(jobId);
          }
        },
        function(err) {
          // Swallow error
          if (err.message !== 'Connection is closed.') {
            console.error('BRPOPLPUSH', err);
          }
        }
      );
  } else {
    return this.moveToActive();
  }
};

Queue.prototype.moveToActive = function(jobId) {
  var _this = this;
  return scripts.moveToActive(_this, jobId).spread(function(jobData, jobId) {
    return _this.nextJobFromJobData(jobData, jobId);
  });
};

Queue.prototype.nextJobFromJobData = function(jobData, jobId) {
  if (jobData) {
    this.drained = false;
    var job = Job.fromJSON(this, jobData, jobId);
    if (job.opts.repeat) {
      return this.nextRepeatableJob(
        job.name,
        job.data,
        job.opts,
        job.opts.prevMillis
      ).then(function() {
        return job;
      });
    }
    return job;
  } else {
    this.drained = true;
    this.emit('drained');
    return null;
  }
};

Queue.prototype.retryJob = function(job) {
  return job.retry();
};

Queue.prototype.toKey = function(queueType) {
  return [this.keyPrefix, this.name, queueType].join(':');
};

/*@function clean
 *
 * Cleans jobs from a queue. Similar to remove but keeps jobs within a certain
 * grace period.
 *
 * @param {int} grace - The grace period
 * @param {string} [type=completed] - The type of job to clean. Possible values
 * @param {int} The max number of jobs to clean
 * are completed, waiting, active, delayed, failed. Defaults to completed.
 */
Queue.prototype.clean = function(grace, type, limit) {
  var _this = this;

  if (grace === undefined || grace === null) {
    return Promise.reject(new Error('You must define a grace period.'));
  }

  if (!type) {
    type = 'completed';
  }

  if (
    _.indexOf(['completed', 'wait', 'active', 'delayed', 'failed'], type) === -1
  ) {
    return Promise.reject(new Error('Cannot clean unknown queue type ' + type));
  }

  return scripts
    .cleanJobsInSet(_this, type, Date.now() - grace, limit)
    .then(function(jobs) {
      _this.emit('cleaned', jobs, type);
      return jobs;
    })
    .catch(function(err) {
      _this.emit('error', err);
      throw err;
    });
};

/**
 * Returns a promise that resolves when active jobs are cleared
 *
 * @returns {Promise}
 */
Queue.prototype.whenCurrentJobsFinished = function() {
  var _this = this;
  return new Promise(function(resolve, reject) {
    //
    // Force reconnection of blocking connection to abort blocking redis call immediately.
    //
    var forcedReconnetion = redisClientDisconnect(_this.bclient).then(
      function() {
        return _this.bclient.connect();
      }
    );

    Promise.all(_this.processing)
      .then(function() {
        return forcedReconnetion;
      })
      .then(resolve, reject);

    /*
    _this.bclient.disconnect();
    _this.bclient.once('end', function(){
      console.error('ENDED!');
      setTimeout(function(){
        _this.bclient.connect();
      }, 0);
    });
    
    /*
    var stream = _this.bclient.connector.stream;
    if(stream){
      stream.on('finish', function(){
        console.error('FINISHED!');
        _this.bclient.connect();
      });  
      stream.on('error', function(err){
        console.error('errir', err);
        _this.bclient.connect();
      });
      _this.bclient.connect();
    }
    */
    //_this.bclient.connect();
  });
};

//
// Private local functions
//

function getRedisVersion(client) {
  return client.info().then(function(doc) {
    var prefix = 'redis_version:';
    var lines = doc.split('\r\n');
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf(prefix) === 0) {
        return lines[i].substr(prefix.length);
      }
    }
  });
}

module.exports = Queue;
