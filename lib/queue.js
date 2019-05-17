'use strict';

//TODO remove for node >= 10
require('promise.prototype.finally').shim();

const redis = require('ioredis');
const EventEmitter = require('events');

const _ = require('lodash');

const fs = require('fs');
const path = require('path');
const util = require('util');
const url = require('url');
const Job = require('./job');
const scripts = require('./scripts');
const errors = require('./errors');
const utils = require('./utils');

const TimerManager = require('./timer-manager');
const promisify = require('util.promisify');
const pTimeout = require('p-timeout');
const semver = require('semver');
const debuglog = require('debuglog')('bull');
const uuid = require('uuid');

const commands = require('./commands/');

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
const MINIMUM_REDIS_VERSION = '2.8.18';

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
      retryProcessDelay?: number = 5000,
      drainDelay?: number = 5
    }
  }

  interface RateLimiter {
    max: number,      // Number of jobs
    duration: number, // per duration milliseconds
  }
*/

// Queue(name: string, url?, opts?)
const Queue = function Queue(name, url, opts) {
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
    if (opts.limiter.max && opts.limiter.duration) {
      this.limiter = opts.limiter;
    } else {
      throw new Error('Limiter requires `max` and `duration` options');
    }
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
  const lazyClient = redisClientGetter(this, opts, (type, client) => {
    // bubble up Redis error events
    client.on('error', this.emit.bind(this, 'error'));

    if (type === 'client') {
      this._initializing = commands(client).then(
        () => {
          debuglog(name + ' queue ready');
        },
        err => {
          this.emit('error', new Error('Error initializing Lua scripts'));
          throw err;
        }
      );

      this._initializing.catch((/*err*/) => {});
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
      .then(version => {
        if (semver.lt(version, MINIMUM_REDIS_VERSION)) {
          this.emit(
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
      .catch((/*err*/) => {
        // Ignore this error.
      });
  }

  this.handlers = {};
  this.delayTimer;
  this.processing = [];
  this.retrieving = 0;
  this.drained = true;

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

  this.on('error', () => {
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

  const keys = {};
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
    key => {
      keys[key] = this.toKey(key);
    }
  );
  this.keys = keys;
};

function redisClientGetter(queue, options, initCallback) {
  const createClient = _.isFunction(options.createClient)
    ? options.createClient
    : function(type, config) {
        return new redis(config);
      };

  const connections = {};

  return function(type) {
    return function() {
      // getter function
      if (connections[type] != null) {
        return connections[type];
      }
      const client = (connections[type] = createClient(type, options.redis));
      if (!options.createClient) {
        queue.clients.push(client);
      }
      return initCallback(type, client), client;
    };
  };
}

function redisOptsFromUrl(urlString) {
  const redisOpts = {};
  try {
    const redisUrl = url.parse(urlString);
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

util.inherits(Queue, EventEmitter);

//
// Extend Queue with "aspects"
//
require('./getters')(Queue);
require('./worker')(Queue);
require('./repeatable')(Queue);

// --
Queue.prototype.off = Queue.prototype.removeListener;

const _on = Queue.prototype.on;

Queue.prototype.on = function(eventName) {
  this._registerEvent(eventName);
  return _on.apply(this, arguments);
};

const _once = Queue.prototype.once;

Queue.prototype.once = function(eventName) {
  this._registerEvent(eventName);
  return _once.apply(this, arguments);
};

Queue.prototype._initProcess = function() {
  if (!this._initializingProcess) {
    //
    // Only setup listeners if .on/.addEventListener called, or process function defined.
    //
    this.delayedTimestamp = Number.MAX_VALUE;
    this._initializingProcess = this.isReady()
      .then(() => {
        return this._registerEvent('delayed');
      })
      .then(() => {
        return this.updateDelayTimer();
      });

    this.errorRetryTimer = {};
  }

  return this._initializingProcess;
};

Queue.prototype._setupQueueEventListeners = function() {
  /*
    if(eventName !== 'cleaned' && eventName !== 'error'){
      args[0] = Job.fromJSON(this, args[0]);
    }
  */

  const activeKey = this.keys.active;
  const stalledKey = this.keys.stalled;
  const progressKey = this.keys.progress;
  const delayedKey = this.keys.delayed;
  const pausedKey = this.keys.paused;
  const resumedKey = this.keys.resumed;
  const waitingKey = this.keys.waiting;
  const completedKey = this.keys.completed;
  const failedKey = this.keys.failed;
  const drainedKey = this.keys.drained;

  this.eclient.on('pmessage', (pattern, channel, message) => {
    const keyAndToken = channel.split('@');
    const key = keyAndToken[0];
    const token = keyAndToken[1];
    switch (key) {
      case activeKey:
        this.emit('global:active', message, 'waiting');
        break;
      case waitingKey:
        if (this.token === token) {
          this.emit('waiting', message, null);
        }
        token && this.emit('global:waiting', message, null);
        break;
      case stalledKey:
        if (this.token === token) {
          this.emit('stalled', message);
        }
        this.emit('global:stalled', message);
        break;
    }
  });

  this.eclient.on('message', (channel, message) => {
    const key = channel.split('@')[0];
    switch (key) {
      case progressKey: {
        const commaPos = message.indexOf(',');
        const jobId = message.substring(0, commaPos);
        const progress = message.substring(commaPos + 1);
        this.emit('global:progress', jobId, JSON.parse(progress));
        break;
      }
      case delayedKey: {
        const newDelayedTimestamp = _.ceil(message);
        if (newDelayedTimestamp < this.delayedTimestamp) {
          // The new delayed timestamp is before the currently newest known delayed timestamp
          // Assume this is the new delayed timestamp and call `updateDelayTimer()` to process any delayed jobs
          // This will also update the `delayedTimestamp`
          this.delayedTimestamp = newDelayedTimestamp;

          this.updateDelayTimer();
        }
        break;
      }
      case pausedKey:
      case resumedKey:
        this.emit('global:' + message);
        break;
      case completedKey: {
        const data = JSON.parse(message);
        this.emit('global:completed', data.jobId, data.val, 'active');
        break;
      }
      case failedKey: {
        const data = JSON.parse(message);
        this.emit('global:failed', data.jobId, data.val, 'active');
        break;
      }
      case drainedKey:
        this.emit('global:drained');
        break;
    }
  });
};

Queue.prototype._registerEvent = function(eventName) {
  const internalEvents = ['waiting', 'delayed'];

  if (
    eventName.startsWith('global:') ||
    internalEvents.indexOf(eventName) !== -1
  ) {
    if (!this.registeredEvents) {
      this._setupQueueEventListeners();
      this.registeredEvents = this.registeredEvents || {};
    }

    const _eventName = eventName.replace('global:', '');

    if (!this.registeredEvents[_eventName]) {
      return utils
        .isRedisReady(this.eclient)
        .then(() => {
          const channel = this.toKey(_eventName);
          if (['active', 'waiting', 'stalled'].indexOf(_eventName) !== -1) {
            return (this.registeredEvents[_eventName] = this.eclient.psubscribe(
              channel + '*'
            ));
          } else {
            return (this.registeredEvents[_eventName] = this.eclient.subscribe(
              channel
            ));
          }
        })
        .then(() => {
          this.emit('registered:' + eventName);
        });
    } else {
      return this.registeredEvents[_eventName];
    }
  }
  return Promise.resolve();
};

Queue.ErrorMessages = errors.Messages;

Queue.prototype.isReady = function() {
  return this._initializing.then(() => {
    return this;
  });
};

function redisClientDisconnect(client) {
  if (client.status === 'end') {
    return Promise.resolve();
  }
  let _resolve, _reject;
  return new Promise((resolve, reject) => {
    _resolve = resolve;
    _reject = reject;
    client.once('end', resolve);
    client.once('error', reject);

    pTimeout(
      client.quit().catch(err => {
        if (err.message !== 'Connection is closed.') {
          throw err;
        }
      }),
      500
    ).catch(() => {
      client.disconnect();
    });
  }).finally(() => {
    client.removeListener('end', _resolve);
    client.removeListener('error', _reject);
  });
}

Queue.prototype.disconnect = function() {
  //
  // TODO: Only quit clients that we "own".
  //
  const clients = this.clients.filter(client => {
    return client.status !== 'end';
  });

  return Promise.all(clients.map(redisClientDisconnect))
    .catch(err => {
      return console.error(err);
    })
    .then(() => {
      return null;
    });
};

Queue.prototype.close = function(doNotWaitJobs) {
  if (this.closing) {
    return this.closing;
  }

  return (this.closing = this.isReady()
    .then(
      () => {
        return this._initializingProcess;
      },
      (/*err*/) => {
        // Ignore this error and try to close anyway.
      }
    )
    .finally(() => {
      return this._clearTimers();
    })
    .then(() => {
      return this.pause(true, doNotWaitJobs);
    })
    .then(
      () => {
        return this.disconnect();
      },
      (/*err*/) => {
        // Ignore this error and try to close anyway.
      }
    )
    .finally(() => {
      this.childPool && this.childPool.clean();
      this.closed = true;
    }));
};

Queue.prototype._clearTimers = function() {
  _.each(this.errorRetryTimer, timer => {
    clearTimeout(timer);
  });
  clearTimeout(this.delayTimer);
  clearInterval(this.guardianTimer);
  clearInterval(this.moveUnlockedJobsToWaitInterval);
  this.timers.clearAll();
  return this.timers.whenIdle();
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

  return this._initProcess().then(() => {
    return this.start(concurrency);
  });
};

Queue.prototype.start = function(concurrency) {
  return this.run(concurrency).catch(err => {
    this.emit('error', err, 'error running queue');
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
    const supportedFileTypes = ['.js', '.ts', '.flow'];
    const processorFile =
      handler +
      (supportedFileTypes.includes(path.extname(handler)) ? '' : '.js');

    if (!fs.existsSync(processorFile)) {
      throw new Error('File ' + processorFile + ' does not exist');
    }

    this.childPool = this.childPool || require('./process/child-pool')();

    const sandbox = require('./process/sandbox');
    this.handlers[name] = sandbox(handler, this.childPool).bind(this);
  } else {
    handler = handler.bind(this);

    if (handler.length > 1) {
      this.handlers[name] = promisify(handler);
    } else {
      this.handlers[name] = function() {
        try {
          return Promise.resolve(handler.apply(null, arguments));
        } catch (err) {
          return Promise.reject(err);
        }
      };
    }
  }
};

/**
interface JobOptions
{
  attempts: number;

  repeat: {
    tz?: string,
    endDate?: Date | string | number
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
    return this.isReady().then(() => {
      return this.nextRepeatableJob(name, data, opts, true);
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
  // Get all jobids and empty all lists atomically.
  let multi = this.multi();

  multi.lrange(this.toKey('wait'), 0, -1);
  multi.lrange(this.toKey('paused'), 0, -1);
  multi.del(this.toKey('wait'));
  multi.del(this.toKey('paused'));
  multi.del(this.toKey('meta-paused'));
  multi.del(this.toKey('delayed'));
  multi.del(this.toKey('priority'));

  return multi.exec().then(res => {
    let waiting = res[0],
      paused = res[1];

    waiting = waiting[1];
    paused = paused[1];
    const jobKeys = paused.concat(waiting).map(this.toKey, this);

    if (jobKeys.length) {
      multi = this.multi();

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
  return this.isReady()
    .then(() => {
      if (isLocal) {
        if (!this.paused) {
          this.paused = new Promise(resolve => {
            this.resumeLocal = function() {
              resolve();
              this.paused = null; // Allow pause to be checked externally for paused state.
            };
          });
        }
        return !doNotWaitActive && this.whenCurrentJobsFinished();
      } else {
        return scripts.pause(this, true);
      }
    })
    .then(() => {
      return this.emit('paused');
    });
};

Queue.prototype.resume = function(isLocal /* Optional */) {
  return this.isReady()
    .then(() => {
      if (isLocal) {
        if (this.resumeLocal) {
          this.resumeLocal();
        }
      } else {
        return scripts.pause(this, false);
      }
    })
    .then(() => {
      this.emit('resumed');
    });
};

Queue.prototype.run = function(concurrency) {
  const promises = [];

  return this.isReady()
    .then(() => {
      return this.moveUnlockedJobsToWait();
    })
    .then(() => {
      return utils.isRedisReady(this.bclient);
    })
    .then(() => {
      while (concurrency--) {
        promises.push(
          new Promise(resolve => {
            this.processJobs(concurrency, resolve);
          })
        );
      }

      this.startMoveUnlockedJobsToWait();

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
Queue.prototype.updateDelayTimer = function() {
  return scripts
    .updateDelaySet(this, Date.now())
    .then(nextTimestamp => {
      this.delayedTimestamp = nextTimestamp
        ? nextTimestamp / 4096
        : Number.MAX_VALUE;

      // Clear any existing update delay timer
      if (this.delayTimer) {
        clearTimeout(this.delayTimer);
      }

      // Delay for the next update of delay set
      const delay = _.min([
        this.delayedTimestamp - Date.now(),
        this.settings.guardInterval
      ]);

      // Schedule next processing of the delayed jobs
      if (delay <= 0) {
        // Next set of jobs are due right now, process them also
        this.updateDelayTimer();
      } else {
        // Update the delay set when the next job is due
        // or the next guard time
        this.delayTimer = setTimeout(() => this.updateDelayTimer(), delay);
      }
    })
    .catch(err => {
      this.emit('error', err, 'Error updating the delay timer');
    });
};

/**
 * Process jobs that have been added to the active list but are not being
 * processed properly. This can happen due to a process crash in the middle
 * of processing a job, leaving it in 'active' but without a job lock.
 */
Queue.prototype.moveUnlockedJobsToWait = function() {
  if (this.closing) {
    return Promise.resolve();
  }

  return scripts
    .moveUnlockedJobsToWait(this)
    .then(([failed, stalled]) => {
      const handleFailedJobs = failed.map(jobId => {
        return this.getJobFromId(jobId).then(job => {
          this.emit(
            'failed',
            job,
            new Error('job stalled more than allowable limit'),
            'active'
          );
          return null;
        });
      });
      const handleStalledJobs = stalled.map(jobId => {
        return this.getJobFromId(jobId).then(job => {
          this.emit('stalled', job);
          return null;
        });
      });
      return Promise.all(handleFailedJobs.concat(handleStalledJobs));
    })
    .catch(err => {
      this.emit('error', err, 'Failed to handle unlocked job in active');
    });
};

Queue.prototype.startMoveUnlockedJobsToWait = function() {
  clearInterval(this.moveUnlockedJobsToWaitInterval);
  if (this.settings.stalledInterval > 0 && !this.closing) {
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
  const processJobs = this.processJobs.bind(this, index, resolve);
  process.nextTick(() => {
    this._processJobOnNextTick(processJobs, index, resolve, job);
  });
};

Queue.prototype._processJobOnNextTick = function(
  processJobs,
  index,
  resolve,
  job
) {
  if (!this.closing) {
    (this.paused || Promise.resolve())
      .then(() => {
        const gettingNextJob = job ? Promise.resolve(job) : this.getNextJob();

        return (this.processing[index] = gettingNextJob
          .then(this.processJob)
          .then(processJobs, err => {
            this.emit('error', err, 'Error processing job');

            //
            // Wait before trying to process again.
            //
            clearTimeout(this.errorRetryTimer[index]);
            this.errorRetryTimer[index] = setTimeout(() => {
              processJobs();
            }, this.settings.retryProcessDelay);

            return null;
          }));
      })
      .catch(err => {
        this.emit('error', err, 'Error processing job');
      });
  } else {
    resolve(this.closing);
  }
};

Queue.prototype.processJob = function(job, notFetch = false) {
  let lockRenewId;
  let timerStopped = false;

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
  const lockExtender = () => {
    lockRenewId = this.timers.set(
      'lockExtender',
      this.settings.lockRenewTime,
      () => {
        scripts
          .extendLock(this, job.id)
          .then(lock => {
            if (lock && !timerStopped) {
              lockExtender();
            }
          })
          .catch((/*err*/) => {
            // Somehow tell the worker this job should stop processing...
          });
      }
    );
  };

  const timeoutMs = job.opts.timeout;

  const stopTimer = () => {
    timerStopped = true;
    this.timers.clear(lockRenewId);
  };

  const handleCompleted = result => {
    return job.moveToCompleted(result, undefined, notFetch).then(jobData => {
      this.emit('completed', job, result, 'active');
      return jobData ? this.nextJobFromJobData(jobData[0], jobData[1]) : null;
    });
  };

  const handleFailed = err => {
    const error = err;

    return job.moveToFailed(err).then(jobData => {
      this.emit('failed', job, error, 'active');
      return jobData ? this.nextJobFromJobData(jobData[0], jobData[1]) : null;
    });
  };

  lockExtender();
  const handler = this.handlers[job.name] || this.handlers['*'];

  if (!handler) {
    return handleFailed(
      new Error('Missing process handler for job type ' + job.name)
    );
  } else {
    let jobPromise = handler(job);

    if (timeoutMs) {
      jobPromise = pTimeout(jobPromise, timeoutMs);
    }

    // Local event with jobPromise so that we can cancel job.
    this.emit('active', job, jobPromise, 'waiting');

    return jobPromise
      .then(handleCompleted)
      .catch(handleFailed)
      .finally(() => {
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
  if (this.closing) {
    return Promise.resolve();
  }

  if (this.drained) {
    //
    // Waiting for new jobs to arrive
    //
    return this.bclient
      .brpoplpush(this.keys.wait, this.keys.active, this.settings.drainDelay)
      .then(
        jobId => {
          if (jobId) {
            return this.moveToActive(jobId);
          }
        },
        err => {
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
  return scripts.moveToActive(this, jobId).then(([jobData, jobId]) => {
    return this.nextJobFromJobData(jobData, jobId);
  });
};

Queue.prototype.nextJobFromJobData = function(jobData, jobId) {
  if (jobData) {
    this.drained = false;
    const job = Job.fromJSON(this, jobData, jobId);
    if (job.opts.repeat) {
      return this.nextRepeatableJob(job.name, job.data, job.opts).then(() => {
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
 * @param {string} [type=completed] - The type of job to clean. Possible values are completed, wait, active, paused, delayed, failed. Defaults to completed.
 * @param {int} The max number of jobs to clean
 */
Queue.prototype.clean = function(grace, type, limit) {
  return this.isReady().then(() => {
    if (grace === undefined || grace === null) {
      throw new Error('You must define a grace period.');
    }

    if (!type) {
      type = 'completed';
    }

    if (
      _.indexOf(
        ['completed', 'wait', 'active', 'paused', 'delayed', 'failed'],
        type
      ) === -1
    ) {
      throw new Error('Cannot clean unknown queue type ' + type);
    }

    return scripts
      .cleanJobsInSet(this, type, Date.now() - grace, limit)
      .then(jobs => {
        this.emit('cleaned', jobs, type);
        return jobs;
      })
      .catch(err => {
        this.emit('error', err);
        throw err;
      });
  });
};

/**
 * Returns a promise that resolves when active jobs are finished
 *
 * @returns {Promise}
 */
Queue.prototype.whenCurrentJobsFinished = function() {
  return new Promise((resolve, reject) => {
    //
    // Force reconnection of blocking connection to abort blocking redis call immediately.
    //
    const forcedReconnection = redisClientDisconnect(this.bclient).then(() => {
      return this.bclient.connect();
    });

    Promise.all(this.processing)
      .then(() => {
        return forcedReconnection;
      })
      .then(resolve, reject);

    /*
    this.bclient.disconnect();
    this.bclient.once('end', function(){
      console.error('ENDED!');
      setTimeout(function(){
        this.bclient.connect();
      }, 0);
    });

    /*
    var stream = this.bclient.connector.stream;
    if(stream){
      stream.on('finish', function(){
        console.error('FINISHED!');
        this.bclient.connect();
      });
      stream.on('error', function(err){
        console.error('errir', err);
        this.bclient.connect();
      });
      this.bclient.connect();
    }
    */
    //this.bclient.connect();
  });
};

//
// Private local functions
//

function getRedisVersion(client) {
  return client.info().then(doc => {
    const prefix = 'redis_version:';
    const lines = doc.split('\r\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].indexOf(prefix) === 0) {
        return lines[i].substr(prefix.length);
      }
    }
  });
}

module.exports = Queue;
