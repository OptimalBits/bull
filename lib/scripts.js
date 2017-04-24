/**
 * Includes all the scripts needed by the queue and jobs.
 *
 *
 */
/*eslint-env node */
/*global Promise:true */
'use strict';

var Promise = require('bluebird');
var _ = require('lodash');
var debuglog = require('debuglog')('bull');
var Redlock = require('bull-redlock');

function execScript(client, hash, lua, numberOfKeys){
  var args = _.drop(arguments, 4);

  debuglog(lua, args);

  if(!client[hash]){
    client.defineCommand(hash, { numberOfKeys: numberOfKeys, lua: lua });
  }

  return client[hash](args);
}

function isCommandDefined(client, hash){
  return !!client[hash];
}

var scripts = {
  _isJobInList: function(keyVar, argVar, operator) {
    keyVar = keyVar || 'KEYS[1]';
    argVar = argVar || 'ARGV[1]';
    operator = operator || 'return';
    return [
      'local function item_in_list (list, item)',
      '  for _, v in pairs(list) do',
      '    if v == item then',
      '      return 1',
      '    end',
      '  end',
      '  return nil',
      'end',
      ['local items = redis.call("LRANGE",', keyVar, ' , 0, -1)'].join(''),
      [operator, ' item_in_list(items, ', argVar, ')'].join('')
    ].join('\n');
  },
  isJobInList: function(client, listKey, jobId){
    return execScript(client, 'isJobInList', this._isJobInList(), 1, listKey, jobId).then(function(result){
      return result === 1;
    });
  },
  addJob: function(client, toKey, job, opts){
    var delayed;
    var scriptName;

    opts = opts || {};
    opts.lifo = !!(opts.lifo);

    var delayTimestamp = job.timestamp + job.delay;
    if(job.delay && delayTimestamp > Date.now()){
      delayed = true;
      scriptName = 'addJob:delayed';
    } else {
      scriptName = 'addJob'+(opts.lifo?':lifo':'') + (opts.priority?':priority':'');
    }

    /*
    if(isCommandDefined(client, scriptName)){
      return client[scriptName].apply(client, args);
    };
    */

    var jobArgs = _.flatten(_.toPairs(job));

    var keys = _.map(['wait', 'paused', 'meta-paused', 'jobs', 'id', 'delayed', 'priority'], function(name){
      return toKey(name);
    });
    var baseKey = toKey('');

    var argvs = _.map(jobArgs, function(arg, index){
      return ', ARGV['+(index+4)+']';
    });

    var script = [
      'local jobCounter = redis.call("INCR", KEYS[5])',
      'local jobId',
      'if ARGV[2] == "" then jobId = jobCounter else jobId = ARGV[2] end',
      'local jobIdKey = ARGV[1] .. jobId',
      'if redis.call("EXISTS", jobIdKey) == 1 then return jobId end',
      'redis.call("HMSET", jobIdKey' + argvs.join('') + ')',
    ];

    var delayTimestamp = job.timestamp + job.delay;
    if(delayed){
      script.push.apply(script, [
        ' local timestamp = tonumber(ARGV[' + (argvs.length + 4) + ']) * 0x1000 + bit.band(jobCounter, 0xfff)',
        ' redis.call("ZADD", KEYS[6], timestamp, jobId)',
        ' redis.call("PUBLISH", KEYS[6], (timestamp / 0x1000))',
        ' return jobId',
      ]);
    }else{
      var push, pushPaused;
      var add = _.template('redis.call("<%= direction %>", <%= waitQueue %>, jobId)');

      if(opts.lifo){
        push = add({direction: 'RPUSH', waitQueue: 'KEYS[1]'});
        pushPaused = add({direction: 'RPUSH', waitQueue: 'KEYS[2]'});
      }else if(opts.priority){
        script.push.apply(script, [
          ' redis.call("ZADD", KEYS[7], ARGV[3], jobId)',
          ' local count = redis.call("ZCOUNT", KEYS[7], 0, ARGV[3])',
        ]);

        var priorityAdd = _.template([
          ' local len = redis.call("LLEN", <%= waitQueue %>)',
          ' local id = redis.call("LINDEX", <%= waitQueue %>, len - (count-1))',
          ' if id then',
          '   redis.call("LINSERT", <%= waitQueue %>, "BEFORE", id, jobId)',
          ' else',
          '   redis.call("RPUSH", <%= waitQueue %>, jobId)',
          ' end',
        ].join('\n'));

        push = priorityAdd({waitQueue: 'KEYS[1]'});
        pushPaused = priorityAdd({waitQueue: 'KEYS[2]'});
      }else{
        push = add({direction: 'LPUSH', waitQueue: 'KEYS[1]'});
        pushPaused = add({direction: 'LPUSH', waitQueue: 'KEYS[2]'});
      }

      //
      // Whe check for the meta-paused key to decide if we are paused or not
      // (since an empty list and !EXISTS are not really the same)
      script.push.apply(script, [
        'if redis.call("EXISTS", KEYS[3]) ~= 1 then',
        push,
        'else',
        pushPaused,
        'end',
        'redis.call("PUBLISH", KEYS[4], jobId)',
        'return jobId .. ""'
      ]);
    }

    var args = [
      client,
      scriptName,
      script.join('\n'),
      keys.length
    ];

    args.push.apply(args, keys);
    args.push(baseKey);
    args.push(opts.customJobId || '');
    args.push(opts.priority);
    args.push.apply(args, jobArgs);
    args.push(delayTimestamp);

    return execScript.apply(scripts, args);
  },

  // TODO: perfect this function so that it can be used instead
  // of all the specialized functions moveToComplete, etc.
  move: function(job, src, target){
    // TODO: Depending on the source we should use LREM, SREM or ZREM.
    // TODO: Depending on the target we should use LPUSH, SADD, etc.
    var keys = _.map([
      src,
      target,
      job.jobId
    ], function(name){
      return job.queue.toKey(name);
    }
    );

    var deleteJob = 'redis.call("DEL", KEYS[3])';

    var moveJob = [
      'redis.call("SADD", KEYS[2], ARGV[1])',
      'redis.call("HSET", KEYS[3], "returnvalue", ARGV[2])',
    ].join('\n');

    var script = [
      'if redis.call("EXISTS", KEYS[3]) == 1 then', // Make sure job exists
      ' redis.call("LREM", KEYS[1], -1, ARGV[1])',
      target ? moveJob : deleteJob,
      ' return 0',
      'else',
      ' return -1',
      'end'
    ].join('\n');

    var args = [
      job.queue.client,
      'move' + src + (target ? target : ''),
      script,
      keys.length,
      keys[0],
      keys[1],
      keys[2],
      job.jobId,
      job.returnvalue ? JSON.stringify(job.returnvalue) : ''
    ];

    var returnLockOrErrorCode = function(lock) {
      return lock ? execScript.apply(scripts, args) : -2;
    };
    var throwUnexpectedErrors = function(err) {
      if (!(err instanceof Redlock.LockError)) {
        throw err;
      }
    };

    return job.takeLock(!!job.lock)
      .then(returnLockOrErrorCode, throwUnexpectedErrors)
      .then(function(result){
        switch (result){
          case -1:
            if(src){
              throw new Error('Missing Job ' + job.jobId + ' when trying to move from ' + src + ' to ' + target);
            } else {
              throw new Error('Missing Job ' + job.jobId + ' when trying to remove it from ' + src);
            }
          case -2:
            throw new Error('Cannot get lock for job ' + job.jobId + ' when trying to move from ' + src);
          default:
            return job.releaseLock();
        }
      });
  },
  moveToCompleted: function(job, removeOnComplete){
    return scripts.move(job, 'active', removeOnComplete ? void 0 : 'completed');
  },

  moveToSet: function(queue, set, jobId, context){
    //
    // Bake in the job id first 12 bits into the timestamp
    // to guarantee correct execution order of delayed jobs
    // (up to 4096 jobs per given timestamp or 4096 jobs apart per timestamp)
    //
    // WARNING: Jobs that are so far apart that they wrap around will cause FIFO to fail
    //
    context = _.isUndefined(context) ? 0 : context;

    if(set === 'delayed') {
      context = +context || 0;
      context = context < 0 ? 0 : context;
      if(context > 0){
        context = context * 0x1000 + (jobId & 0xfff);
      }
    }

    var keys = _.map([
      'active',
      set,
      jobId
    ], function(name){
      return queue.toKey(name);
    }
    );

    var args = [
      queue.client,
      'moveToSet',
      moveToSetScript,
      keys.length,
      keys[0],
      keys[1],
      keys[2],
      JSON.stringify(context),
      jobId
    ];

    return execScript.apply(scripts, args).then(function(result){
      if(result === -1){
        throw new Error('Missing Job ' + jobId + ' when trying to move from active to ' + set);
      }
    });
  },
  remove: function(queue, jobId){
    var script = [
      'redis.call("LREM", KEYS[1], 0, ARGV[1])',
      'redis.call("LREM", KEYS[2], 0, ARGV[1])',
      'redis.call("ZREM", KEYS[3], ARGV[1])',
      'redis.call("LREM", KEYS[4], 0, ARGV[1])',
      'redis.call("SREM", KEYS[5], ARGV[1])',
      'redis.call("SREM", KEYS[6], ARGV[1])',
      'redis.call("DEL", KEYS[7])'].join('\n');

    var keys = _.map([
      'active',
      'wait',
      'delayed',
      'paused',
      'completed',
      'failed',
      jobId], function(name){
      return queue.toKey(name);
    }
    );

    var args = [
      queue.client,
      'remove',
      script,
      keys.length,
      keys[0],
      keys[1],
      keys[2],
      keys[3],
      keys[4],
      keys[5],
      keys[6],
      jobId
    ];

    return execScript.apply(scripts, args);
  },

  /**
   * Gets a lock for a job.
   *
   * @param {Queue} queue The queue for the job
   * @param {Job} job The job
   * @param {Boolean=false} renew Whether to renew to lock, meaning it will assume the job
   *    is already locked and just reset the lock expiration.
   * @param {Boolean=false} ensureActive Ensures that the job is in the 'active' state.
   */
  takeLock: function(queue, job, renew, ensureActive){
    var lock = job.lock;
    if (renew && !lock) {
      throw new Error('Unable to renew nonexisting lock');
    }
    if (renew) {
      return lock.extend(queue.LOCK_DURATION);
    }
    if (lock) {
      return Promise.resolve(lock);
    }
    var redlock;
    if (ensureActive) {
      var isJobInList = this._isJobInList('KEYS[2]', 'ARGV[3]', 'if');
      var lockAcquired = ['and redis.call("HSET", KEYS[3], "lockAcquired", "1")'].join('');
      var success = 'then return 1 else return 0 end';
      var opts = {
        lockScript: function(lockScript) {
          return [
            isJobInList,
            lockScript.replace('return', 'and'),
            lockAcquired,
            success
          ].join('\n');
        },
        extraLockKeys: [job.queue.toKey('active'), queue.toKey(job.jobId)],
        extraLockArgs: [job.jobId]
      };
      redlock = new Redlock(queue.clients, _.extend(opts, queue.redlock));
    } else {
      redlock = new Redlock(queue.clients, queue.redlock);
    }
    return redlock.lock(job.lockKey(), queue.LOCK_DURATION).catch(function(err){
      //
      // Failing to lock due to already locked is not an error.
      //
      if(err.name != 'LockError'){
        throw err;
      }else{
        queue.emit('error', err, 'Could not get the lock');
      }
    });
  },

  releaseLock: function(job){
    var lock = job.lock;
    if (!lock) {
      throw new Error('Unable to release nonexisting lock');
    }
    return lock.unlock();
  },
  /**
    It checks if the job in the top of the delay set should be moved back to the
    top of the  wait queue (so that it will be processed as soon as possible)
  */
  updateDelaySet: function(queue, delayedTimestamp){
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
    });

    var args = [
      queue.client,
      'updateDelaySet',
      script,
      keys.length,
      keys[0],
      keys[1],
      keys[2],
      keys[3],
      queue.toKey(''),
      delayedTimestamp
    ];

    return execScript.apply(scripts, args);
  },

  /**
   * Looks for unlocked jobs in the active queue. There are two circumstances in which a job
   * would be in 'active' but NOT have a job lock:
   *
   *  Case A) The job was being worked on, but the worker process died and it failed to renew the lock.
   *    We call these jobs 'stalled'. This is the most common case. We resolve these by moving them
   *    back to wait to be re-processed. To prevent jobs from cycling endlessly between active and wait,
   *    (e.g. if the job handler keeps crashing), we limit the number stalled job recoveries to MAX_STALLED_JOB_COUNT.

   *  Case B) The job was just moved to 'active' from 'wait' and the worker that moved it hasn't gotten
   *    a lock yet, or died immediately before getting the lock (note that due to Redis limitations, the
   *    worker can't move the job and get the lock atomically - https://github.com/OptimalBits/bull/issues/258).
   *    For this case we also move the job back to 'wait' for reprocessing, but don't consider it 'stalled'
   *    since the job had never been started. This case is much rarer than Case A due to the very small
   *    timing window in which it must occur.
   */
  moveUnlockedJobsToWait: function(queue){
    var script = [
      'local MAX_STALLED_JOB_COUNT = tonumber(ARGV[1])',
      'local activeJobs = redis.call("LRANGE", KEYS[1], 0, -1)',
      'local stalled = {}',
      'local failed = {}',
      'for _, job in ipairs(activeJobs) do',
      ' local jobKey = ARGV[2] .. job',
      ' if(redis.call("EXISTS", jobKey .. ":lock") == 0) then',
      //  Remove from the active queue.
      '   redis.call("LREM", KEYS[1], 1, job)',
      '   local lockAcquired = redis.call("HGET", jobKey, "lockAcquired")',
      '   if(lockAcquired) then',
      //    If it was previously locked then we consider it 'stalled' (Case A above). If this job
      //    has been stalled too many times, such as if it crashes the worker, then fail it.
      '     local stalledCount = redis.call("HINCRBY", jobKey, "stalledCounter", 1)',
      '     if(stalledCount > MAX_STALLED_JOB_COUNT) then',
      '       redis.call("SADD", KEYS[3], job)',
      '       redis.call("HSET", jobKey, "failedReason", "job stalled more than allowable limit")',
      '       table.insert(failed, job)',
      '     else',
      //      Move the job back to the wait queue, to immediately be picked up by a waiting worker.
      '       redis.call("RPUSH", KEYS[2], job)',
      '       table.insert(stalled, job)',
      '     end',
      '   else',
      //    Move the job back to the wait queue, to immediately be picked up by a waiting worker.
      '     redis.call("RPUSH", KEYS[2], job)',
      '   end',
      ' end',
      'end',
      'return {failed, stalled}'
    ].join('\n');

    var args = [
      queue.client,
      'moveUnlockedJobsToWait',
      script,
      3,
      queue.toKey('active'),
      queue.toKey('wait'),
      queue.toKey('failed'),
      queue.MAX_STALLED_JOB_COUNT,
      queue.toKey('')
    ];

    return execScript.apply(scripts, args);
  },

  cleanJobsInSet: function(queue, set, ts, limit) {
    var command;
    var removeCommand;
    var breakEarlyCommand = '';
    var hash;
    limit = limit || 0;

    switch(set) {
      case 'completed':
      case 'failed':
        command = 'local jobs = redis.call("SMEMBERS", KEYS[1])';
        removeCommand = 'redis.call("SREM", KEYS[1], job)';
        hash = 'cleanSet';
        break;
      case 'wait':
      case 'active':
      case 'paused':
        command = 'local jobs = redis.call("LRANGE", KEYS[1], 0, -1)';
        removeCommand = 'redis.call("LREM", KEYS[1], 0, job)';
        hash = 'cleanList';
        break;
      case 'delayed':
        command = 'local jobs = redis.call("ZRANGE", KEYS[1], 0, -1)';
        removeCommand = 'redis.call("ZREM", KEYS[1], job)';
        hash = 'cleanOSet';
        break;
    }

    if(limit > 0) {
      breakEarlyCommand = [
        'if deletedCount >= limit then',
        '  break',
        'end',
      ].join('\n');

      hash = hash + 'WithLimit';
    }

    var script = [
      command,
      'local deleted = {}',
      'local deletedCount = 0',
      'local limit = tonumber(ARGV[3])',
      'local jobTS',
      'for _, job in ipairs(jobs) do',
      breakEarlyCommand,
      '  local jobKey = ARGV[1] .. job',
      '  if (redis.call("EXISTS", jobKey ..  ":lock") == 0) then',
      '    jobTS = redis.call("HGET", jobKey, "timestamp")',
      '    if(not jobTS or jobTS < ARGV[2]) then',
      removeCommand,
      '      redis.call("DEL", jobKey)',
      '      deletedCount = deletedCount + 1',
      '      table.insert(deleted, job)',
      '    end',
      '  end',
      'end',
      'return deleted'
    ].join('\n');

    var args = [
      queue.client,
      hash,
      script,
      1,
      queue.toKey(set),
      queue.toKey(''),
      ts,
      limit
    ];

    return execScript.apply(scripts, args);
  },

  /**
   * Attempts to reprocess a job
   *
   * @param {Job} job
   * @param {Object} options
   * @param {String} options.state The expected job state. If the job is not found
   * on the provided state, then it's not reprocessed. Supported states: 'failed', 'completed'
   *
   * @return {Promise<Number>} Returns a promise that evaluates to a return code:
   * 1 means the operation was a success
   * 0 means the job does not exist
   * -1 means the job is currently locked and can't be retried.
   * -2 means the job was not found in the expected set
   */
  reprocessJob: function(job, options) {
    var push = (job.opts.lifo ? 'R' : 'L') + 'PUSH';

    var script = [
      'if (redis.call("EXISTS", KEYS[1]) == 1) then',
      '  if (redis.call("EXISTS", KEYS[2]) == 0) then',
      '    if (redis.call("SREM", KEYS[3], ARGV[1]) == 1) then',
      '      redis.call("' + push + '", KEYS[4], ARGV[1])',
      '      redis.call("PUBLISH", KEYS[5], ARGV[1])',
      '      return 1',
      '    else',
      '      return -2',
      '    end',
      '  else',
      '    return -1',
      '  end',
      'else',
      '  return 0',
      'end'
    ].join('\n');

    var queue = job.queue;

    var keys = [
      queue.toKey(job.jobId),
      queue.toKey(job.jobId) + ':lock',
      queue.toKey(options.state),
      queue.toKey('wait'),
      queue.toKey('jobs')
    ];

    var args = [
      queue.client,
      'retryJob',
      script,
      5,
      keys[0],
      keys[1],
      keys[2],
      keys[3],
      keys[4],
      job.jobId
    ];

    return execScript.apply(scripts, args);
  }
};

/*
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
    var jobKeys = (paused.concat(waiting)).map(_this.toKey, _this);

    if(jobKeys.length){
      multi = _this.multi();

      multi.del.apply(multi, jobKeys);
      return multi.exec();
    }
  });
};
*/
/**
 * KEYS:
 * 0 - wait
 * 1 - paused
 * 2 - meta-paused
 * 3 - delayed
 */
var emptyScript = [

];

  // this lua script takes three keys and two arguments
  // keys:
  //  - the expanded key for the active set
  //  - the expanded key for the destination set
  //  - the expanded key for the job
  //
  // arguments:
  //  - json serialized context which is:
  //     - delayedTimestamp when the destination set is 'delayed'
  //     - stacktrace when the destination set is 'failed'
  //     - returnvalue of the handler when the destination set is 'completed'
  //  - the id of the job
  //
  // it checks whether KEYS[2] the destination set ends with 'delayed', 'completed'
  // or 'failed'. And then adds the context to the jobhash and adds the job to
  // the destination set. Finally it removes the job from the active list.
  //
  // it returns either 0 for success or -1 for failure.
var moveToSetScript = [
  'if redis.call("EXISTS", KEYS[3]) == 1 then',
  ' if string.find(KEYS[2], "delayed$") ~= nil then',
  ' local score = tonumber(ARGV[1])',
  '  if score ~= 0 then',
  '   redis.call("ZADD", KEYS[2], score, ARGV[2])',
  '   redis.call("PUBLISH", KEYS[2], (score / 0x1000))',
  '  else',
  '   redis.call("SADD", KEYS[2], ARGV[2])',
  '  end',
  ' elseif string.find(KEYS[2], "completed$") ~= nil then',
  '  redis.call("HSET", KEYS[3], "returnvalue", ARGV[1])',
  '  redis.call("SADD", KEYS[2], ARGV[2])',
  ' elseif string.find(KEYS[2], "failed$") ~= nil then',
  '  redis.call("SADD", KEYS[2], ARGV[2])',
  ' else',
  '  return -1',
  ' end',
  ' redis.call("LREM", KEYS[1], 0, ARGV[2])',
  ' return 0',
  'else',
  ' return -1',
  'end'
].join('\n');

module.exports = scripts;
