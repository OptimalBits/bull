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

var cache = {};

function execScript(client, hash, script){
  var cached = cache[hash];
  var args = _.drop(arguments, 3);

  debuglog(script, args);

  if(!cached){
    cached = cacheScript(client, hash, script);
  }

  return cached.then(function(sha){
    args.unshift(sha);
    return client.evalshaAsync.apply(client, args).catch(function(err){
      debuglog(err, script, err.stack);
      if(err.code === 'NOSCRIPT'){
        delete cache[hash];
        args = [
          client, hash, script
        ];
        args.push.apply(args, arguments);
        return execScript.apply(null, args);
      }else{
        throw err;
      }
    })
  });
}

function cacheScript(client, hash, script){
  cache[hash] = client.scriptAsync('LOAD', script);
  return cache[hash];
}

var scripts = {
  isJobInList: function(client, listKey, jobId){
    var script = [
      'local function item_in_list (list, item)',
      '  for _, v in pairs(list) do',
      '    if v == item then',
      '      return 1',
      '    end',
      '  end',
      '  return nil',
      'end',
      'local items = redis.call("LRANGE", KEYS[1], 0, -1)',
      'return item_in_list(items, ARGV[1])'
    ].join('\n');

    return execScript(client, 'isJobInList', script, 1, listKey, jobId).then(function(result){
      return result === 1;
    });
  },
  addJob: function(client, toKey, lifo, job){
    var jobArgs = _.flatten(_.toPairs(job));

    var keys = _.map(['wait', 'paused', 'meta-paused', 'jobs', 'id', 'delayed'], function(name){
      return toKey(name);
    });
    var baseKey = toKey('');

    var argvs = _.map(jobArgs, function(arg, index){
      return ', ARGV['+(index+2)+']';
    })

    var script = [
      'local jobId = redis.call("INCR", KEYS[5])',
      'redis.call("HMSET", ARGV[1] .. jobId' + argvs.join('') + ')',
    ];

    var scriptName;

    var delayTimestamp = job.timestamp + job.delay;
    if(job.delay && delayTimestamp > Date.now()){
      script.push.apply(script, [
        ' local timestamp = tonumber(ARGV[' + (argvs.length + 2) + ']) * 0x1000 + bit.band(jobId, 0xfff)',
        ' redis.call("ZADD", KEYS[6], timestamp, jobId)',
        ' redis.call("PUBLISH", KEYS[6], (timestamp / 0x1000))',
        ' return jobId',
      ]);

      scriptName = 'addJob:delayed';
    }else{
      var push = (lifo ? 'R' : 'L') + 'PUSH';
      //
      // Whe check for the meta-paused key to decide if we are paused or not
      // (since an empty list and !EXISTS are not really the same)
      script.push.apply(script, [
        'if redis.call("EXISTS", KEYS[3]) ~= 1 then',
        ' redis.call("' + push + '", KEYS[1], jobId)',
        'else',
        ' redis.call("' + push + '", KEYS[2], jobId)',
        'end',
        'redis.call("PUBLISH", KEYS[4], jobId)',
        'return jobId'
      ]);

      scriptName = 'addJob'+push;
    }

    var args = [
      client,
      scriptName,
      script.join('\n'),
      keys.length
    ];

    args.push.apply(args, keys);
    args.push(baseKey);
    args.push.apply(args, jobArgs);
    args.push(delayTimestamp);

    return execScript.apply(scripts, args);
  },
  moveToCompleted: function(job){
    var keys = _.map([
      'active',
      'completed',
      job.jobId
      ], function(name){
        return job.queue.toKey(name);
      }
    );

    var script = [
      'if redis.call("EXISTS", KEYS[3]) == 1 then',
      ' redis.call("SADD", KEYS[2], ARGV[1])',
      ' redis.call("HSET", KEYS[3], "returnvalue", ARGV[2])',
      ' redis.call("LREM", KEYS[1], 0, ARGV[1])',
      'else',
      ' return -1',
      'end'
    ].join('\n');

    var args = [
      job.queue.client,
      'moveToCompletedSet',
      script,
      keys.length,
      keys[0],
      keys[1],
      keys[2],
      job.jobId,
    ];

    if(!_.isUndefined(job.returnvalue)){
      args.push(JSON.stringify(job.returnvalue));
    }

    return execScript.apply(scripts, args).then(function(result){
      if(result === -1){
        throw new Error('Missing Job ' + job.jobId + ' when trying to move from active to completed');
      }
    });

    /*
    var params = {};
    if(isNaN(job.attemptsMade)){
      params.attemptsMade = 1;
    }else{
      params.attemptsMade = job.attemptsMade++;
    }

    if(job.stacktrace){
      params.stacktrace = JSON.stringify(job.stacktrace);
    }
    return this.queue.client.hmsetAsync(this.queue.toKey(this.jobId), params);
    */
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
      'if (redis.call("SISMEMBER", KEYS[5], ARGV[1]) == 0) and (redis.call("SISMEMBER", KEYS[6], ARGV[1]) == 0) then',
      '  redis.call("LREM", KEYS[1], 0, ARGV[1])',
      '  redis.call("LREM", KEYS[2], 0, ARGV[1])',
      '  redis.call("ZREM", KEYS[3], ARGV[1])',
      '  redis.call("LREM", KEYS[4], 0, ARGV[1])',
      'end',
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
  releaseLock: function(job, token){
    var script = [
      'if redis.call("get", KEYS[1]) == ARGV[1]',
      'then',
      'return redis.call("del", KEYS[1])',
      'else',
      'return 0',
      'end'].join('\n');

    var args = [
      job.queue.client,
      'releaseLock',
      script,
      1,
      job.lockKey(),
      token
    ];

    return execScript.apply(scripts, args).then(function(result){
      return result === 1;
    });
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

  return multi.execAsync().spread(function(waiting, paused){
    var jobKeys = (paused.concat(waiting)).map(_this.toKey, _this);

    if(jobKeys.length){
      multi = _this.multi();

      multi.del.apply(multi, jobKeys);
      return multi.execAsync();
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

]

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
