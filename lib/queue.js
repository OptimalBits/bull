/*eslint-env node */
/*global Promise:true */
'use strict';

var redis = require('redis');
var events = require('events');
var util = require('util');
var Job = require('./job');
var TimerManager = require('./timer-manager');
var _ = require('lodash');
var Promise = require('bluebird');
var uuid = require('node-uuid');
var semver = require('semver');

/**
  Gets or creates a new Queue with the given name.

  The Queue keeps 5 data structures:
    - wait (list)
    - active (list)
    - delayed (zset)
    - completed (set)
    - failed (set)
                           -- >completed
                          /
    job -> wait -> active
        |    ^            \
        v    |             -- > failed
        delayed
*/

/**
  Delayed jobs are jobs that cannot be executed until a certain time in
  ms has passed since they were added to the queue.
  The mechanism is simple, a delayedTimestamp variable holds the next
  known timestamp that is on the delayed set (or MAX_INT if none).

  When the current job has finalized the variable is checked, if
  no delayed job has to be executed yet a setTimeout is set so that a
  delayed job is processed after timing out.
*/
var MINIMUM_REDIS_VERSION = '2.8.11';
var LOCK_RENEW_TIME = 5000; // 5 seconds is the renew time.
var CLIENT_CLOSE_TIMEOUT_MS = 5000;
var POLLING_INTERVAL = 5000;

var Queue = function Queue(name, redisPort, redisHost, redisOptions){
  if(!(this instanceof Queue)){
    return new Queue(name, redisPort, redisHost, redisOptions);
  }

  var redisDB = 0;
  if(_.isObject(redisPort)){
    var opts = redisPort;
    var redisOpts = opts.redis || {};
    redisPort = redisOpts.port;
    redisHost = redisOpts.host;
    redisOptions = redisOpts.opts || {};
    redisDB = redisOpts.DB || redisDB;
  }

  function createClient() {
    var client;
    if(redisOptions !== undefined && redisOptions.createClient !== undefined){
      client = redisOptions.createClient();
    }else{
      client = redis.createClient(redisPort, redisHost, redisOptions);
    }
    return Promise.promisifyAll(client);
  }

  redisPort = redisPort || 6379;
  redisHost = redisHost || '127.0.0.1';

  var _this = this;

  this.name = name;

  //
  // Create queue client (used to add jobs, pause queues, etc);
  //
  this.client = createClient();

  getRedisVersion(this.client).then(function(version){
    if(semver.lt(version, MINIMUM_REDIS_VERSION)){
      throw new Error('Redis version needs to be greater than ' + MINIMUM_REDIS_VERSION + '. Current: ' + version);
    }
  }).catch(function(err){
    _this.emit('error', err);
  });

  //
  // Create blocking client (used to wait for jobs)
  //
  this.bclient = createClient();

  //
  // Create event subscriber client (receive messages from other instance of the queue)
  //
  this.eclient = createClient();

  this.delayTimer = null;
  this.processing = 0;

  this.token = uuid();
  this.LOCK_RENEW_TIME = LOCK_RENEW_TIME;

  // bubble up Redis error events
  [this.client, this.bclient, this.eclient].forEach(function (client) {
    client.on('error', _this.emit.bind(_this, 'error'));
  });

  // keeps track of active timers. used by close() to
  // ensure that disconnect() is deferred until all
  // scheduled redis commands have been executed
  this.timers = new TimerManager();

  // emit ready when redis connections
  this.client.selectAsync(redisDB).then(function(){
    return _this.bclient.selectAsync(redisDB);
  }).then(function(){
    return _this.eclient.selectAsync(redisDB);
  }).then(function(){
    return _this.eclient.subscribeAsync(_this.toKey('delayed'));
  }).then(function(){
    return _this.eclient.subscribeAsync(_this.toKey('paused'));
  }).then(function(){
    _this.emit('ready');
  });

  //
  // Handle delay, pause and resume messages
  //
  this.eclient.on('message', function(channel, message){
    if(channel === _this.toKey('delayed')){
      _this.updateDelayTimer(message);
    }else if(channel === _this.toKey('paused')){
      if(message === 'paused'){
        _this.emit('paused');
      }else if(message === 'resumed'){
        _this.emit('resumed');
      }
    }
  });

  //
  // Init delay timestamp.
  //
  this.delayedTimestamp = Number.MAX_VALUE;
  updateDelaySet(this, Date.now()).then(function(timestamp){
    if(timestamp){
      _this.updateDelayTimer(timestamp);
    }
  });

  //
  // Create a guardian timer to revive delayTimer if necessary
  // This is necessary when redis connection is unstable, which can cause the pub/sub to fail
  //
  this.guardianTimer = setInterval(function() {
    if(_this.delayedTimestamp < Date.now() || _this.delayedTimestamp - Date.now() > POLLING_INTERVAL){
      updateDelaySet(_this, Date.now()).then(function(timestamp){
        if(timestamp){
          _this.updateDelayTimer(timestamp);
        }
      });
    }
  }, POLLING_INTERVAL);

};

util.inherits(Queue, events.EventEmitter);

Queue.prototype.disconnect = function(){
  var _this = this;
  var timeoutMsg = 'Timed out while waiting for redis clients to close';

  return new Promise(function(resolve) {
    var triggerEvent = _.after(3, resolve);
    _this.client.end();
    _this.bclient.end();
    _this.eclient.end();
    _this.client.stream.once('close', triggerEvent);
    _this.bclient.stream.once('close', triggerEvent);
    _this.eclient.stream.once('close', triggerEvent);
  }).timeout(CLIENT_CLOSE_TIMEOUT_MS, timeoutMsg);
};

Queue.prototype.close = function(){
  var _this = this;
  clearTimeout(this.delayTimer);
  clearInterval(this.guardianTimer);
  return new Promise(function(resolve) {
    _this.timers.whenIdle(function(){
      resolve(_this.disconnect());
    });
  });
};

/**
  Processes a job from the queue. The callback is called for every job that
  is dequeued.

  @method process
*/
Queue.prototype.process = function(concurrency, handler){
  var _this = this;

  this.setHandler(concurrency, handler);

  var runQueueWhenReady = function(){
    _this.bclient.once('ready', _this.run.bind(_this));
  };

  // attempt to restart the queue when the client throws
  // an error or the connection is dropped by redis
  this.bclient.on('error', runQueueWhenReady);
  this.bclient.on('end', runQueueWhenReady);

  return this.run().catch(function(err){
    console.log(err);
    throw err;
  });
};

Queue.prototype.setHandler = function(concurrency, handler){
  if(typeof concurrency === 'function'){
    handler = concurrency;
    concurrency = 1;
  }

  if(this.handler) {
    throw new Error('Cannot define a handler more than once per Queue instance');
  }

  this.concurrency = concurrency;

  handler = handler.bind(this);

  if(handler.length > 1){
    this.handler = Promise.promisify(handler);
  }else{
    this.handler = Promise.method(handler);
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
Queue.prototype.add = function(data, opts){
  var _this = this;
  opts = opts || {};

  //
  // If we fail after incrementing the job id we may end having an unused
  // id, but this should not be so harmful (NOTE: we could create and add the job
  // atomically if we wanted using a proper LUA script)
  //
  return _this.client.incrAsync(this.toKey('id')).then(function(jobId){
    return Job.create(_this, jobId, data, opts);
  }).then(function(job){
    if(job.delay){
      var jobDelayedTimestamp = job.timestamp + job.delay;
      if(jobDelayedTimestamp > Date.now()){
        return job._addToDelayed(jobDelayedTimestamp).then(function(){
          _this.emit('delayed', job);
          return job;
        });
      }
    }
    return addJob(_this, job.jobId, opts).then(function(){
      _this.emit('waiting', job);
      return job;
    });
  });
};

//
// An empty lists does not exist in redis, therefore we need another mechanism
// to tell the queue that it is paused, the 'meta-paused' key.
//
function addJob(queue, jobId, opts){
  var push = (opts.lifo ? 'R' : 'L') + 'PUSH';
  var script = [
    'if redis.call("EXISTS", KEYS[3]) ~= 1 then',
    ' redis.call("' + push + '", KEYS[1], ARGV[1])',
    'else',
    ' redis.call("' + push + '", KEYS[2], ARGV[1])',
    'end',
    'redis.call("PUBLISH", KEYS[4], ARGV[1])'
    ].join('\n');

  var keys = _.map(['wait', 'paused', 'meta-paused', 'jobs'], function(name){
    return queue.toKey(name);
  });

  return queue.client.evalAsync(script, keys.length, keys[0], keys[1], keys[2], keys[3], jobId);
}

/**
  Returns the number of jobs waiting to be processed.
*/
Queue.prototype.count = function(){
  var multi = this.multi();
  multi.llen(this.toKey('wait'));
  multi.llen(this.toKey('paused'));
  multi.zcard(this.toKey('delayed'));

  return multi.execAsync().then(function(res){
    return Math.max(res[0], res[1]) + res[2];
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

  return multi.execAsync().spread(function(waiting, paused){
    var jobKeys = (paused.concat(waiting)).map(_this.toKey, _this);

    if(jobKeys.length){
      multi = _this.multi();

      multi.del.apply(multi, jobKeys);
      return multi.execAsync();
    }
  });
};

/**
  Pauses the processing of this queue.

  We use an atomic RENAME operation on the wait queue. Since we have
  blocking calls with BRPOPLPUSH on the wait queue, as long as the queue
  is renamed to 'paused', no new jobs will be processed (the current ones
  will run until finalized).

  Adding jobs requires a LUA script to check first if the paused list exist
  and in that case it will add it there instead of the wait list.
*/
Queue.prototype.pause = function(){
  return pauseResume(this, true);
};

Queue.prototype.resume = function(){
  return pauseResume(this, false);
};

function pauseResume(queue, pause){
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

  return queue.client.evalAsync(script, keys.length, keys[0], keys[1], keys[2], keys[3], pause ? 'paused' : 'resumed');
}

Queue.prototype.run = function(){
  var promises = [];
  var i = this.concurrency;

  while(i--){
    promises.push(this.processJobs());
  }

  return Promise.all(promises);
};

// ---------------------------------------------------------------------
// Private methods
// ---------------------------------------------------------------------

/**
  This function updates the delay timer, which is a timer that timeout
  at the next known delayed job.
*/
Queue.prototype.updateDelayTimer = function(newDelayedTimestamp){
  var _this = this;

  if(newDelayedTimestamp < _this.delayedTimestamp){
    clearTimeout(this.delayTimer);
    this.delayedTimestamp = newDelayedTimestamp;

    var nextDelayedJob = newDelayedTimestamp - Date.now();
    nextDelayedJob = nextDelayedJob < 0 ? 0 : nextDelayedJob;

    this.delayTimer = setTimeout(function(){
      updateDelaySet(_this, _this.delayedTimestamp).then(function(nextTimestamp){
        if(nextTimestamp){
          nextTimestamp = nextTimestamp < Date.now() ? Date.now() : nextTimestamp;
        }else{
          nextTimestamp = Number.MAX_VALUE;
        }
        _this.updateDelayTimer(nextTimestamp);
      }).catch(function(err){
        console.log('Error updating the delay timer', err);
      });
      _this.delayedTimestamp = Number.MAX_VALUE;
    }, nextDelayedJob);
  }
};

/**
  This atomic redis function updates the delay set.
  It checks if the job in the top of the delay set should be moved back to the
  top of the  wait queue (so that it will be processed as soon as possible)
*/
var updateDelaySet = function(queue, delayedTimestamp){
  var script = [
    'local RESULT = redis.call("ZRANGE", KEYS[1], 0, 0, "WITHSCORES")',
    'local jobId = RESULT[1]',
    'local score = RESULT[2]',
    'if (score ~= nil) then',
    ' score = score / 0x1000 ',
    ' if (score <= tonumber(ARGV[2])) then',
    '  redis.call("ZREM", KEYS[1], jobId)',
    '  redis.call("LREM", KEYS[2], 0, jobId)',
    '  redis.call("LPUSH", KEYS[3], jobId)',
    '  redis.call("PUBLISH", KEYS[4], jobId)',
    '  redis.call("HSET", ARGV[1] .. jobId, "delay", 0)',
    '  local nextTimestamp = redis.call("ZRANGE", KEYS[1], 0, 0, "WITHSCORES")[2]',
    '  if(nextTimestamp ~= nil) then',
    '   nextTimestamp = nextTimestamp / 0x1000',
    '   redis.call("PUBLISH", KEYS[1], nextTimestamp)',
    '  end',
    '  return nextTimestamp',
    ' end',
    ' return score',
    'end'].join('\n');

  var keys = _.map([
    'delayed',
    'active',
    'wait',
    'jobs'], function(name){
      return queue.toKey(name);
    }
  );

  return queue.client.evalAsync(
    script,
    keys.length,
    keys[0],
    keys[1],
    keys[2],
    keys[3],
    queue.toKey(''),
    delayedTimestamp);
};

/**
  Process jobs that have been added to the active list but are not being
  processed properly.
*/
Queue.prototype.processStalledJobs = function(){
  var _this = this;
  return this.client.lrangeAsync(this.toKey('active'), 0, -1).then(function(jobs){
    return Promise.each(jobs, function(jobId) {
      return Job.fromId(_this, jobId).then(_this.processStalledJob.bind(_this));
    });
  });
};

Queue.prototype.processStalledJob = function(job){
  var _this = this;
  if(!job){
    return Promise.resolve();
  }else{
    return job.takeLock(_this.token).then(function(lock){
      if(lock){
        var key = _this.toKey('completed');
        return _this.client.sismemberAsync(key, job.jobId).then(function(isMember){
          if(!isMember){
            return _this.processJob(job);
          }
        });
      }
    });
  }
};

Queue.prototype.processJobs = function(){
  var _this = this;

  return this.processStalledJobs().then(function() {
    return _this.getNextJob();
  }).then(function(job) {
    return job.takeLock(_this.token).then(function(locked) {
      if(locked){
        return _this.processJob(job);
      }
    });
  }).finally(function(){
    return _this.processJobs();
  });
};

Queue.prototype.processJob = function(job){
  var _this = this;
  var lockRenewId;

  var lockRenewer = function(){
    job.renewLock(_this.token);
    lockRenewId = _this.timers.set('lockRenewer', _this.LOCK_RENEW_TIME / 2, lockRenewer);
  };

  var timeoutMs = job.opts.timeout;

  function handleCompleted(data){
    //This substraction is duplicate in handleCompleted and handleFailed because it have to be made before throwing any
    //event completed or failed in order to allow pause() to work correctly without getting stuck.
    _this.processing--;
    return job.moveToCompleted(data).then(function(){
      _this.emit('completed', job, data);
    });
  }

  function handleFailed(err){
    _this.processing--;
    var error = err.cause || err; //Handle explicit rejection
    return job.moveToFailed(err)
        .then(job.releaseLock.bind(job, _this.token))
        .then(function(){
          _this.emit('failed', job, error);
        });
  }

  this.processing++;

  lockRenewer();

  var jobPromise = Promise.resolve(this.handler(job));

  if(timeoutMs){
    jobPromise = jobPromise.timeout(timeoutMs);
  }

  this.emit('active', job, jobPromise);

  return jobPromise
    .then(handleCompleted, handleFailed)
    .finally(function(){
      _this.timers.clear(lockRenewId);
    });
};

/**
  Returns a promise that resolves to the next job in queue.
*/
Queue.prototype.getNextJob = function(opts){
  var getJobFromId = Job.fromId.bind(null, this); //should this be a queue method?

  return this.moveJob('wait', 'active', opts).then(getJobFromId);
};

Queue.prototype.multi = function(){
  var multi = this.client.multi();
  multi.execAsync = Promise.promisify(multi.exec);
  return multi;
};

/**
  Atomically moves a job from one list to another.

  @method moveJob
*/
Queue.prototype.moveJob = function(src, dst, opts) {
  if(opts && opts.block === false){
    return this.bclient.rpoplpushAsync(this.toKey(src), this.toKey(dst));
  }else{
    return this.bclient.brpoplpushAsync(this.toKey(src), this.toKey(dst),
                Math.floor(this.LOCK_RENEW_TIME / 1000)).then(function(jobId) {
      if(jobId){
        return jobId;
      }else{
        return Promise.reject();
      }
    });
  }
};

Queue.prototype.getJob = function(jobId){
  return Job.fromId(this, jobId);
};

Queue.prototype.getWaiting = function(/*start, end*/){
  return this.getJobs('wait', 'LIST');
};

Queue.prototype.getActive = function(/*start, end*/){
  return this.getJobs('active', 'LIST');
};

Queue.prototype.getDelayed = function(/*start, end*/){
  return this.getJobs('delayed', 'ZSET');
};

Queue.prototype.getCompleted = function(){
  return this.getJobs('completed', 'SET');
};

Queue.prototype.getFailed = function(){
  return this.getJobs('failed', 'SET');
};

Queue.prototype.getJobs = function(queueType, type, start, end){
  var _this = this;
  var key = this.toKey(queueType);
  var jobs;

  start = _.isUndefined(start) ? 0 : start;
  end = _.isUndefined(end) ? -1 : end;

  switch(type){
    case 'LIST':
      jobs = this.client.lrangeAsync(key, start, end);
      break;
    case 'SET':
      jobs = this.client.smembersAsync(key);
      break;
    case 'ZSET':
      jobs = this.client.zrangeAsync(key, start, end);
      break;
  }

  return jobs.then(function(jobIds){
    var jobsFromId = jobIds.map(Job.fromId.bind(null, _this));
    return Promise.all(jobsFromId);
  });
};

Queue.prototype.retryJob = function(job) {
  return job.retry();
};

Queue.prototype.toKey = function(queueType){
  return 'bull:' + this.name + ':' + queueType;
};

/*@function startCleaner
 *
 * Cleans jobs from a queue. Similar to remove but keeps jobs within a certian
 * grace period.
 *
 * @param {int} grace - The grace period
 * @param {string} [type=completed] - The type of job to clean. Possible values
 * are completed, waiting, active, delayed, failed. Defaults to completed.
 */
Queue.prototype.clean = function (grace, type) {
  var _this = this;

  return new Promise(function (resolve, reject) {
    var getter;

    if(grace === undefined || grace === null) {
      return reject(new Error('You must define a grace period.'));
    }

    if(!type) {
      type = 'completed';
    }

    //a super hack to deal with different job types
    getter = 'get' + type.charAt(0).toUpperCase() + type.slice(1);
    if(getter !== 'getCompleted' &&
      getter !== 'getWaiting' &&
      getter !== 'getActive' &&
      getter !== 'getDelayed' &&
      getter !== 'getFailed') {
      return reject(new Error('Cannot clean unkown queue type'));
    }

    _this[getter]().then(function (jobs) {
      //take all jobs outside of the grace period
      return Promise.filter(jobs, function (job) {
        return (!job.timestamp) || (job.timestamp < Date.now() - grace);
      });
    }).then(function (jobs) {
      //remove those old jobs
      return Promise.each(jobs, function (job) {
        return job.remove();
      });
    }).then(function (jobs) {
      //let everyone know we cleaned up
      _this.emit('cleaned', jobs, type);
      resolve(jobs);
    }).catch(function (err) {
      _this.emit('error', err);
      reject(err);
    });
  });
};

//
// Private local functions
//
var getRedisVersion = function getRedisVersion(client){
  return client.infoAsync().then(function(doc){
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
