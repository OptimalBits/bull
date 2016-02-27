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

var cache = {};

function execScript(client, hash, script){
  var sha = cache[hash];
  var args = _.drop(arguments, 3);
  var cached = Promise.resolve(sha);
  if(!sha){
    cached = cacheScript(client, hash, script);
  }

  return cached.then(function(sha){
    args.unshift(sha);
    return client.evalshaAsync.apply(client, args).catch(function(err){
      console.error(err);
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
  return client.scriptAsync('LOAD', script).then(function(sha){
    cache[hash] = sha;
    return sha;
  })
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
  moveToSet: function(queue, set, jobId, context){
    //
    // Bake in the job id first 12 bits into the timestamp
    // to guarantee correct execution order of delayed jobs
    // (up to 4096 jobs per given timestamp or 4096 jobs apart per timestamp)
    //
    // WARNING: Jobs that are so far apart that they wrap around will cause FIFO to fail
    //
    if(set === 'delayed') {
      context = +context || 0;
      context = context < 0 ? 0 : context;
      if(context > 0){
        context = context * 0x1000 + (jobId & 0xfff);
      }
    }

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
    var script = [
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
      script,
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
  }
}

module.exports = scripts;
