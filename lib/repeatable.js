/*eslint-env node */
'use strict';

var _ = require('lodash');
var parser = require('cron-parser');
var Job = require('./job');

function nextJob(queue, name, data, opts, isRepeat){
  var repeat = opts.repeat;
  if(!isRepeat && opts.jobId){
    opts.repeat.jobId = opts.jobId;
  }
  var repeatJobId = opts.repeat.jobId ? opts.repeat.jobId + ':' : '';
  var repeatJobKey = name + ':' + repeatJobId + repeat.cron;

  var millis = Date.now();
  return queue.client.getOrSetRepeatKey(queue.toKey('repeat'), repeatJobKey, millis).then(function(millis){
    millis = parseInt(millis);

    var interval = parser.parseExpression(repeat.cron, _.defaults({
      currentDate: new Date(millis)
    }, repeat));
    var nextMillis;
    try{
      nextMillis = interval.next();
    } catch(e){
      // Ignore error
    }

    if(nextMillis){
      nextMillis = nextMillis.getTime();
      var delay = nextMillis - Date.now();

      //
      // Generate unique job id for this iteration.
      //
      var customId = 'repeat:' + name + ':' + repeatJobId + nextMillis;

      //
      // Set key and add job should be atomic.
      //
      return queue.client.zadd(queue.toKey('repeat'), nextMillis, repeatJobKey).then(function(){
        return Job.create(queue, name, data, _.extend(_.clone(opts), {
          jobId: customId,
          delay: delay < 0 ? 0 : delay,
          timestamp: Date.now()
        }));
      });
    }
  });
};

module.exports.nextJob = nextJob;