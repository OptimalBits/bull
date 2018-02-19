/**
 * Includes all the scripts needed by the queue and jobs.
 */

/*eslint-env node */
'use strict';

var _ = require('lodash');
var debuglog = require('debuglog')('bull');

// TO Deprecate.
function execScript(client, hash, lua, numberOfKeys) {
  var args = _.drop(arguments, 4);

  if (!client[hash]) {
    debuglog(hash, lua, args);
    client.defineCommand(hash, { numberOfKeys: numberOfKeys, lua: lua });
  }

  return client[hash](args);
}

var scripts = {
  isJobInList: function(client, listKey, jobId) {
    return client.isJobInList([listKey, jobId]).then(function(result) {
      return result === 1;
    });
  },

  addJob: function(client, queue, job, opts) {
    var queueKeys = queue.keys;
    var keys = [
      queueKeys.wait,
      queueKeys.paused,
      queueKeys['meta-paused'],
      queueKeys.id,
      queueKeys.delayed,
      queueKeys.priority
    ];

    var args = [
      queueKeys[''],
      _.isUndefined(opts.customJobId) ? '' : opts.customJobId,
      job.name,
      job.data,
      job.opts,
      job.timestamp,
      job.delay,
      job.delay ? job.timestamp + job.delay : 0,
      opts.priority || 0,
      opts.lifo ? 'RPUSH' : 'LPUSH',
      queue.token
    ];
    keys = keys.concat(args);
    return client.addJob(keys);
  },

  pause: function(queue, pause) {
    var src = 'wait',
      dst = 'paused';
    if (!pause) {
      src = 'paused';
      dst = 'wait';
    }

    var keys = _.map(
      [src, dst, 'meta-paused', pause ? 'paused' : 'resumed'],
      function(name) {
        return queue.toKey(name);
      }
    );

    return queue.client.pause(keys.concat([pause ? 'paused' : 'resumed']));
  },

  moveToActive: function(queue, jobId) {
    var queueKeys = queue.keys;
    var keys = [queueKeys.wait, queueKeys.active, queueKeys.priority];

    keys[3] = keys[1] + '@' + queue.token;
    keys[4] = queueKeys.stalled;
    keys[5] = queueKeys.limiter;
    keys[6] = queueKeys.delayed;
    keys[7] = queueKeys.drained;

    var args = [
      queueKeys[''],
      queue.token,
      queue.settings.lockDuration,
      Date.now(),
      jobId
    ];

    if (queue.limiter) {
      args.push(queue.limiter.max, queue.limiter.duration);
    }
    return queue.client.moveToActive(keys.concat(args)).then(raw2jobData);
  },

  updateProgress: function(job, progress) {
    var queue = job.queue;
    var keys = [job.id, 'progress'].map(function(name) {
      return queue.toKey(name);
    });

    return queue.client
      .updateProgress(keys, [progress, job.id + ',' + progress])
      .then(function() {
        queue.emit('progress', job, progress);
      });
  },

  moveToFinishedArgs: function(
    job,
    val,
    propVal,
    shouldRemove,
    target,
    ignoreLock,
    notFetch
  ) {
    var queue = job.queue;
    var queueKeys = queue.keys;

    var keys = [
      queueKeys.active,
      queueKeys[target],
      queue.toKey(job.id),
      queueKeys.wait,
      queueKeys.priority,
      queueKeys.active + '@' + queue.token
    ];

    var args = [
      job.id,
      Date.now(),
      propVal,
      _.isUndefined(val) ? 'null' : val,
      ignoreLock ? '0' : queue.token,
      shouldRemove ? '1' : '0',
      JSON.stringify({ jobId: job.id, val: val }),
      notFetch || queue.paused || queue.closing || queue.limiter ? 0 : 1,
      queueKeys[''],
      queue.settings.lockDuration,
      queue.token
    ];

    return keys.concat(args);
  },

  moveToFinished: function(
    job,
    val,
    propVal,
    shouldRemove,
    target,
    ignoreLock
  ) {
    var args = scripts.moveToFinishedArgs(
      job,
      val,
      propVal,
      shouldRemove,
      target,
      ignoreLock
    );
    return job.queue.client.moveToFinished(args).then(function(result) {
      if (result < 0) {
        throw scripts.finishedErrors(result, job.id, 'finished');
      } else if (result) {
        return raw2jobData(result);
      }
      return 0;
    });
  },

  finishedErrors: function(code, jobId, command) {
    switch (code) {
      case -1:
        return new Error('Missing key for job ' + jobId + ' ' + command);
      case -2:
        return new Error('Missing lock for job ' + jobId + ' ' + command);
    }
  },

  // TODO: add a retention argument for completed and finished jobs (in time).
  moveToCompleted: function(job, returnvalue, removeOnComplete, ignoreLock) {
    return scripts.moveToFinished(
      job,
      returnvalue,
      'returnvalue',
      removeOnComplete,
      'completed',
      ignoreLock
    );
  },

  moveToFailedArgs: function(job, failedReason, removeOnFailed, ignoreLock) {
    return scripts.moveToFinishedArgs(
      job,
      failedReason,
      'failedReason',
      removeOnFailed,
      'failed',
      ignoreLock,
      true
    );
  },

  moveToFailed: function(job, failedReason, removeOnFailed, ignoreLock) {
    var args = scripts.moveToFailedArgs(
      job,
      failedReason,
      'failedReason',
      removeOnFailed,
      'failed',
      ignoreLock,
      true
    );
    return scripts.moveToFinished(args);
  },

  isFinished: function(job) {
    var keys = _.map(['completed', 'failed'], function(key) {
      return job.queue.toKey(key);
    });

    return job.queue.client.isFinished(keys.concat([job.id]));
  },

  moveToDelayedArgs: function(queue, jobId, timestamp, ignoreLock) {
    //
    // Bake in the job id first 12 bits into the timestamp
    // to guarantee correct execution order of delayed jobs
    // (up to 4096 jobs per given timestamp or 4096 jobs apart per timestamp)
    //
    // WARNING: Jobs that are so far apart that they wrap around will cause FIFO to fail
    //
    timestamp = _.isUndefined(timestamp) ? 0 : timestamp;

    timestamp = +timestamp || 0;
    timestamp = timestamp < 0 ? 0 : timestamp;
    if (timestamp > 0) {
      timestamp = timestamp * 0x1000 + (jobId & 0xfff);
    }

    var keys = _.map(['active', 'delayed', jobId], function(name) {
      return queue.toKey(name);
    });
    return keys.concat([
      JSON.stringify(timestamp),
      jobId,
      ignoreLock ? '0' : queue.token
    ]);
  },

  moveToDelayed: function(queue, jobId, timestamp, ignoreLock) {
    var args = scripts.moveToDelayedArgs(queue, jobId, timestamp, ignoreLock);
    return queue.client.moveToDelayed(args).then(function(result) {
      switch (result) {
        case -1:
          throw new Error(
            'Missing Job ' +
              jobId +
              ' when trying to move from active to delayed'
          );
        case -2:
          throw new Error(
            'Job ' +
              jobId +
              ' was locked when trying to move from active to delayed'
          );
      }
    });
  },

  remove: function(queue, jobId) {
    var keys = _.map(
      ['active', 'wait', 'delayed', 'paused', 'completed', 'failed', jobId],
      function(name) {
        return queue.toKey(name);
      }
    );

    return queue.client.removeJob(keys.concat([jobId, queue.token]));
  },

  extendLock: function(queue, jobId) {
    return queue.client.extendLock([
      queue.toKey(jobId) + ':lock',
      queue.keys.stalled,
      queue.token,
      queue.settings.lockDuration,
      jobId
    ]);
  },

  releaseLock: function(queue, jobId) {
    return queue.client.releaseLock([
      queue.toKey(jobId) + ':lock',
      queue.token
    ]);
  },

  takeLock: function(queue, job) {
    return queue.client.takeLock([
      job.lockKey,
      queue.token,
      queue.settings.lockDuration
    ]);
  },

  /**
    It checks if the job in the top of the delay set should be moved back to the
    top of the  wait queue (so that it will be processed as soon as possible)
  */
  updateDelaySet: function(queue, delayedTimestamp) {
    var keys = [queue.keys.delayed, queue.keys.active, queue.keys.wait];

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
  moveUnlockedJobsToWait: function(queue) {
    var keys = [
      queue.keys.stalled,
      queue.keys.wait,
      queue.keys.active,
      queue.keys.failed,
      queue.keys['stalled-check'],
      queue.keys['meta-paused'],
      queue.keys.paused
    ];
    var args = [
      queue.settings.maxStalledCount,
      queue.toKey(''),
      Date.now(),
      queue.settings.stalledInterval
    ];
    return queue.client.moveStalledJobsToWait(keys.concat(args));
  },

  // TODO: Refactor into lua script
  cleanJobsInSet: function(queue, set, ts, limit) {
    var command;
    var removeCommand;
    var breakEarlyCommand = '';
    var hash;
    limit = limit || 0;

    switch (set) {
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

    if (limit > 0) {
      breakEarlyCommand = [
        'if deletedCount >= limit then',
        '  break',
        'end'
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

  retryJobArgs: function(job, ignoreLock) {
    var queue = job.queue;
    var jobId = job.id;

    var keys = _.map(['active', 'wait', jobId], function(name) {
      return queue.toKey(name);
    });

    var pushCmd = (job.opts.lifo ? 'R' : 'L') + 'PUSH';

    return keys.concat([pushCmd, jobId, ignoreLock ? '0' : job.queue.token]);
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
      queue.toKey('wait')
    ];

    var args = [job.id, (job.opts.lifo ? 'R' : 'L') + 'PUSH', queue.token];

    return queue.client.reprocessJob(keys.concat(args));
  }
};

module.exports = scripts;

function array2obj(arr) {
  var obj = {};
  for (var i = 0; i < arr.length; i += 2) {
    obj[arr[i]] = arr[i + 1];
  }
  return obj;
}

function raw2jobData(raw) {
  if (raw) {
    var jobData = raw[0];
    if (jobData.length) {
      var job = array2obj(jobData);
      return [job, raw[1]];
    }
  }
  return [];
}
