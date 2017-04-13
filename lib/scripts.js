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

    if(!client[hash]){
      debuglog(hash, lua, args);
      client.defineCommand(hash, { numberOfKeys: numberOfKeys, lua: lua });
    }

    return client[hash](args);
}

function runScript(client, hash, lua, keys, args){
  if(!client[hash]){
    debuglog(hash, lua, keys, args);
    client.defineCommand(hash, { numberOfKeys: keys.length, lua: lua });
  }

  var params = keys.concat(args);
  return client[hash](params);
}

function isCommandDefined(client, hash){
  return !!client[hash];
}

var path = require('path');
var fs = require('fs');
function loadScriptIfNeeded(client, name){
  if(!client[name]){
    return fs.readFileSync(path.join(__dirname, 'scripts/' + name + '.lua')).toString();
  }
}

var scripts = {
  isJobInList: function(client, listKey, jobId){
    var lua = loadScriptIfNeeded(client, 'isJobInList');

    return runScript(client, 'isJobInList', lua, [listKey], [jobId]).then(function(result){
      return result === 1;
    });
  },

  addJob: function(client, toKey, job, opts){
    var queue = job.queue;
    var lua = loadScriptIfNeeded(client, 'addJob');

    var keys = _.map(['wait', 'paused', 'meta-paused', 'added', 'id', 'delayed', 'priority'], function(name){
      return toKey(name);
    });

    var args = [
      toKey(''),
      _.isUndefined(opts.customJobId) ? "" : opts.customJobId,
      job.name,
      job.data,
      job.opts,
      job.timestamp,
      job.delay,
      job.delay ? job.timestamp + job.delay : "0",
      opts.priority || 0,
      opts.lifo ? "LIFO" : "FIFO"
    ];

    return runScript(client, 'addJob', lua, keys, args);
  },

  pause: function(queue, pause) {
    var lua = loadScriptIfNeeded(client, 'pause');

    var src, dst;
    if(pause){
      src = 'wait';
      dst = 'paused';
    }else{
      src = 'paused';
      dst = 'wait';
    }

    var keys = _.map([src, dst, 'meta-paused', 'paused'], function(name){
      return queue.toKey(name);
    });

    return runScript(queue.client, 'pause', lua, keys, [pause ? 'paused' : 'resumed'])
  },

  moveToActive: function(queue){
    var lua = loadScriptIfNeeded(queue.client, 'moveToActive');

     var keys = _.map([
      'wait',
      'active',
      'priority'], function(name){
        return queue.toKey(name);
      }
    );

    var args = [
      queue.toKey(''),
      queue.token,
      queue.LOCK_DURATION
    ];

    return runScript(queue.client, 'moveToActive', lua, keys, args).then(function(jobData){
      if(jobData && jobData.length){
        return array2hash(jobData);
      }
    });
  },

  moveToFinished: function(job, val, propVal, shouldRemove, target, ignoreLock){
    var queue = job.queue;
    var lua = loadScriptIfNeeded(queue.client, 'moveToFinished');

     var keys = _.map([
      'active',
      target,
      job.id], function(name){
        return queue.toKey(name);
      }
    );

    var args = [
      job.id,
      Date.now(),
      propVal,
      val,
      ignoreLock ? "0" : job.queue.token,
      shouldRemove ? "1" : "0"
    ];

    return runScript(queue.client, 'moveToFinished', lua, keys, args);
  },
 
  moveToCompleted: function(job, returnvalue, removeOnComplete, ignoreLock){
    return scripts.moveToFinished(job, returnvalue, 'returnvalue', removeOnComplete, 'completed', ignoreLock);
  },

  moveToFailed: function(job, failedReason, removeOnFailed, ignoreLock){
    return scripts.moveToFinished(job, failedReason, 'failedReason', removeOnFailed, 'failed', ignoreLock);
  },

  isFinished: function(job){
    var lua = loadScriptIfNeeded(job.queue.client, 'isFinished');
    var keys = _.map(['completed', 'failed'], function(key){
      return job.queue.toKey(key);
    });

    return runScript(job.queue.client, 'isFinished', lua, keys, [job.id]);
  },

  moveToSet: function(queue, set, jobId, context){
    var lua = loadScriptIfNeeded(queue.client, 'moveToSet');

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

    return runScript(queue.client, 'moveToSet', lua, keys, [JSON.stringify(context), jobId]).then(function(result){
      if(result === -1){
        throw new Error('Missing Job ' + jobId + ' when trying to move from active to ' + set);
      }
    });
  },

  remove: function(queue, jobId){
    var lua = loadScriptIfNeeded(queue.client, 'removeJob');

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

    return runScript(queue.client, 'removeJob', lua, keys, [jobId, queue.token]);
  },

  extendLock: function(queue, jobId){
    var lua = loadScriptIfNeeded(queue.client, 'extendLock');

    return runScript(queue.client, 'extendLock', lua, [queue.toKey(jobId) + ':lock'], [queue.token, queue.LOCK_DURATION]);
  },

  releaseLock: function(queue, jobId){
    var lua = loadScriptIfNeeded(queue.client, 'releaseLock');

    return runScript(queue.client, 'releaseLock', lua, [queue.toKey(jobId) + ':lock'], [queue.token]);
  },

  takeLock: function(queue, job){
    var lua = loadScriptIfNeeded(queue.client, 'takeLock');

    return runScript(queue.client, 'takeLock', lua, [job.lockKey()], [queue.token, queue.LOCK_DURATION]);
  },

  /**
    It checks if the job in the top of the delay set should be moved back to the
    top of the  wait queue (so that it will be processed as soon as possible)
  */
  updateDelaySet: function(queue, delayedTimestamp){
    var lua = loadScriptIfNeeded(queue.client, 'updateDelaySet');

    var keys = _.map([
      'delayed',
      'active',
      'wait',
      'added'], function(name){
        return queue.toKey(name);
    });

    var args = [queue.toKey(''), delayedTimestamp]; 

    return runScript(queue.client, 'updateDelaySet', lua, keys, args);
  },

  /**
   * Looks for unlocked jobs in the active queue. 
   *
   *    The job was being worked on, but the worker process died and it failed to renew the lock.
   *    We call these jobs 'stalled'. This is the most common case. We resolve these by moving them
   *    back to wait to be re-processed. To prevent jobs from cycling endlessly between active and wait,
   *    (e.g. if the job handler keeps crashing), we limit the number stalled job recoveries to MAX_STALLED_JOB_COUNT.
   */
  moveUnlockedJobsToWait: function(queue){
    var lua = loadScriptIfNeeded(queue.client, 'moveUnlockedJobsToWait');
    
    var keys = _.map(['active', 'wait', 'failed', 'added'], function(key){
      return queue.toKey(key);
    });
    var args = [queue.MAX_STALLED_JOB_COUNT, queue.toKey(''), Date.now()];
    return runScript(queue.client, 'moveUnlockedJobsToWait', lua, keys, args);
  },

  // TODO: Refactor into lua script
  cleanJobsInSet: function(queue, set, ts, limit) {
    var command;
    var removeCommand;
    var breakEarlyCommand = '';
    var hash;
    limit = limit || 0;

    switch(set) {
      case 'wait':
      case 'active':
      case 'paused':
        command = 'local jobs = redis.call("LRANGE", KEYS[1], 0, -1)';
        removeCommand = 'redis.call("LREM", KEYS[1], 0, job)';
        hash = 'cleanList';
        break;
      case 'delayed':
      case 'completed':
      case 'failed':
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

  retryJob: function(job){
    var queue = job.queue;
    var jobId = job.id;

    var lua = loadScriptIfNeeded(queue.client, 'retryJob');

    var keys = _.map(['active', 'wait', jobId, 'added'], function(name){
      return queue.toKey(name);
    });

    var pushCmd = (job.opts.lifo ? 'R' : 'L') + 'PUSH';
    
    return runScript(queue.client, 'retryJob', lua, keys, [pushCmd, jobId]).then(function(result){
      if(result === -1){
        throw new Error('Missing Job ' + jobId + ' during retry');
      }
    });
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
    var lua = loadScriptIfNeeded(job.queue.client, 'reprocessJob');
    var queue = job.queue;

    var keys = [
      queue.toKey(job.id),
      queue.toKey(job.id) + ':lock',
      queue.toKey(options.state),
      queue.toKey('wait'),
      queue.toKey('added')
    ];

    var args = [
      job.id,
      (job.opts.lifo ? 'R' : 'L') + 'PUSH'
    ];

    return runScript(queue.client, 'reprocessJob', lua, keys, args);
  },

  //
  // TODO: DEPRECATE.
  //
  move: function(job, src, target){
    // TODO: Depending on the source we should use LREM or ZREM.
    // TODO: Depending on the target we should use LPUSH, SADD, etc.
    var keys = _.map([
      src,
      target,
      job.id
      ], function(name){
        return job.queue.toKey(name);
      }
    );

    var deleteJob = 'redis.call("DEL", KEYS[3])';

    var moveJob = [
      'redis.call("ZADD", KEYS[2], ARGV[3], ARGV[1])',
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
      job.id,
      job.returnvalue ? JSON.stringify(job.returnvalue) : '',
      parseInt(job.timestamp)
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
              throw new Error('Missing Job ' + job.id + ' when trying to move from ' + src + ' to ' + target);
            } else {
              throw new Error('Missing Job ' + job.id + ' when trying to remove it from ' + src);
            }
          case -2:
            throw new Error('Cannot get lock for job ' + job.id + ' when trying to move from ' + src);
          default:
            return job.releaseLock();
        }
      });
  }
};

module.exports = scripts;

function array2hash(arr){
  var obj = {};
  for(var i=0; i < arr.length; i+=2){
    obj[arr[i]] = arr[i+1]
  }
  return obj;
}
