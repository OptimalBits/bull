/**
 * Includes all the scripts needed by the queue and jobs.
 */

/*eslint-env node */
'use strict';

var _ = require('lodash');
var debuglog = require('debuglog')('bull');

// TO Deprecate.
function execScript(client, hash, lua, numberOfKeys){
  var args = _.drop(arguments, 4);

  if(!client[hash]){
    debuglog(hash, lua, args);
    client.defineCommand(hash, { numberOfKeys: numberOfKeys, lua: lua });
  }

  return client[hash](args);
}

var scripts = {
  isJobInList: function(client, listKey, jobId){
    return client.isJobInList([listKey, jobId]).then(function(result){
      return result === 1;
    });
  },

  addJob: function(client, toKey, job, opts){
    var keys = _.map(['wait', 'paused', 'meta-paused', 'added', 'id', 'delayed', 'priority'], function(name){
      return toKey(name);
    });

    var args = [
      toKey(''),
      _.isUndefined(opts.customJobId) ? '' : opts.customJobId,
      job.name,
      job.data,
      job.opts,
      job.timestamp,
      job.delay,
      job.delay ? job.timestamp + job.delay : '0',
      opts.priority || 0,
      opts.lifo ? 'LIFO' : 'FIFO'
    ];

    return client.addJob(keys.concat(args));
  },

  pause: function(queue, pause) {
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

    return queue.client.pause(keys.concat([pause ? 'paused' : 'resumed']));
  },

  moveToActive: function(queue){
    var keys = _.map(['wait','active','priority'], function(name){
      return queue.toKey(name);
    });

    var args = [
      queue.toKey(''),
      queue.token,
      queue.settings.lockDuration
    ];

    return queue.client.moveToActive(keys.concat(args)).then(function(result){
      if(result){
        var jobData = result[0];
        if(jobData.length){
          var job = array2obj(jobData);
          return [job, result[1]];
        }
      }
      return [];
    });
  },

  moveToFinishedArgs: function(job, val, propVal, shouldRemove, target, ignoreLock){
    var queue = job.queue;

    var keys = _.map(['active', target, job.id], function(name){
      return queue.toKey(name);
    });

    var args = [
      job.id,
      Date.now(),
      propVal,
      val,
      ignoreLock ? '0' : job.queue.token,
      shouldRemove ? '1' : '0'
    ];

    return keys.concat(args);
  },

  moveToFinished: function(job, val, propVal, shouldRemove, target, ignoreLock){
    var args = scripts.moveToFinishedArgs(job, val, propVal, shouldRemove, target, ignoreLock);
    return job.queue.client.moveToFinished(args);
  },
 
  // TODO: add a retention argument for completed and finished jobs (in time).
  moveToCompleted: function(job, returnvalue, removeOnComplete, ignoreLock){
    return scripts.moveToFinished(job, returnvalue, 'returnvalue', removeOnComplete, 'completed', ignoreLock);
  },

  moveToFailedArgs: function(job, failedReason, removeOnFailed, ignoreLock){
    return scripts.moveToFinishedArgs(job, failedReason, 'failedReason', removeOnFailed, 'failed', ignoreLock);
  },

  moveToFailed: function(job, failedReason, removeOnFailed, ignoreLock){
    var args = scripts.moveToFailedArgs(job, failedReason, 'failedReason', removeOnFailed, 'failed', ignoreLock); 
    return scripts.moveToFinished(args);
  },

  isFinished: function(job){
    var keys = _.map(['completed', 'failed'], function(key){
      return job.queue.toKey(key);
    });

    return job.queue.client.isFinished(keys.concat([job.id]));
  },

  moveToDelayedArgs: function(queue, jobId, context){
    //
    // Bake in the job id first 12 bits into the timestamp
    // to guarantee correct execution order of delayed jobs
    // (up to 4096 jobs per given timestamp or 4096 jobs apart per timestamp)
    //
    // WARNING: Jobs that are so far apart that they wrap around will cause FIFO to fail
    //
    context = _.isUndefined(context) ? 0 : context;

    context = +context || 0;
    context = context < 0 ? 0 : context;
    if(context > 0){
      context = context * 0x1000 + (jobId & 0xfff);
    }

    var keys = _.map(['active', 'delayed', jobId], function(name){
      return queue.toKey(name);
    });
    return keys.concat([JSON.stringify(context), jobId]);
  },

  moveToDelayed: function(queue, jobId, context){
    var args = scripts.moveToDelayedArgs(queue, jobId, context);
    return queue.client.moveToDelayed(args).then(function(result){
      if(result === -1){
        throw new Error('Missing Job ' + jobId + ' when trying to move from active to delayed');
      }
    });
  },

  remove: function(queue, jobId){
    var keys = _.map([
      'active',
      'wait',
      'delayed',
      'paused',
      'completed',
      'failed',
      jobId],
    function(name){
      return queue.toKey(name);
    });

    return queue.client.removeJob(keys.concat([jobId, queue.token]));
  },

  extendLock: function(queue, jobId){
    return queue.client.extendLock([queue.toKey(jobId) + ':lock', queue.token, queue.settings.lockDuration]);
  },

  releaseLock: function(queue, jobId){
    return queue.client.releaseLock([queue.toKey(jobId) + ':lock', queue.token]);
  },

  takeLock: function(queue, job){
    return queue.client.takeLock([job.lockKey(), queue.token, queue.settings.lockDuration]);
  },

  /**
    It checks if the job in the top of the delay set should be moved back to the
    top of the  wait queue (so that it will be processed as soon as possible)
  */
  updateDelaySet: function(queue, delayedTimestamp){
    var keys = _.map([
      'delayed',
      'active',
      'wait',
      'added'],
    function(name){
      return queue.toKey(name);
    });

    var args = [queue.toKey(''), delayedTimestamp]; 

    return queue.client.updateDelaySet(keys.concat(args));
  },

  /**
   * Looks for unlocked jobs in the active queue. 
   *
   *    The job was being worked on, but the worker process died and it failed to renew the lock.
   *    We call these jobs 'stalled'. This is the most common case. We resolve these by moving them
   *    back to wait to be re-processed. To prevent jobs from cycling endlessly between active and wait,
   *    (e.g. if the job handler keeps crashing), we limit the number stalled job recoveries to settings.maxStalledCount.
   */
  moveUnlockedJobsToWait: function(queue){
    var keys = _.map(['active', 'wait', 'failed', 'added'], function(key){
      return queue.toKey(key);
    });
    var args = [queue.settings.maxStalledCount, queue.toKey(''), Date.now()];
    return queue.client.moveUnlockedJobsToWait(keys.concat(args));
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

  retryJobArgs: function(job){
    var queue = job.queue;
    var jobId = job.id;

    var keys = _.map(['active', 'wait', jobId, 'added'], function(name){
      return queue.toKey(name);
    });

    var pushCmd = (job.opts.lifo ? 'R' : 'L') + 'PUSH';
    
    return keys.concat([pushCmd, jobId]);
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

    return queue.client.reprocessJob(keys.concat(args));
  }
};

module.exports = scripts;

function array2obj(arr){
  var obj = {};
  for(var i=0; i < arr.length; i+=2){
    obj[arr[i]] = arr[i+1];
  }
  return obj;
}