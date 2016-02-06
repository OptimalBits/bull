/**
 * Includes all the scripts needed by the queue and jobs.
 * 
 * 
 */
/*eslint-env node */
/*global Promise:true */
'use strict';

var cache = {};

function execScript(client, hash, script){
  var sha = cache[hash];
  var args;
  var cached = Promise.resolved(sha);
  if(!sha){
    cached = cacheScript(client, hash, script); 
  }
  cached.then(function(sha){
    args.shift(sha);
    return client.evalshaAsync.apply(client, args).catch(function(err){
      // if ERR is that script is missing we need to re-cache and test again.
      // delete cache[hash];
      // return execScript(client, hash, script)
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

    return scripts._execScript(client, 'isJobInList', 1, listKey, jobId).then(function(result){
      return result === 1;
    });
  }
}

module.exports.scripts = scripts;
