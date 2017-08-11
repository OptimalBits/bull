/*eslint-env node */
'use strict';

var _ = require('lodash');
var parser = require('cron-parser');
var Job = require('./job');

module.exports = function(Queue){

  Queue.prototype.nextRepeatableJob = function (name, data, opts, isRepeat){
    var _this = this;
    var repeat = opts.repeat;
    if(!isRepeat && opts.jobId){
      opts.repeat.jobId = opts.jobId;
    }
    var repeatJobId = opts.repeat.jobId ? opts.repeat.jobId + ':' : ':';
    var endDate = opts.repeat.endDate ? opts.repeat.endDate + ':' : ':';
    var tz = opts.repeat.tz ? opts.repeat.tz + ':' : ':';
    var repeatJobKey = name + ':' + repeatJobId + endDate + tz + repeat.cron;

    var millis = Date.now();
    return this.client.getOrSetRepeatKey(this.toKey('repeat'), repeatJobKey, millis).then(function(millis){
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
        return _this.client.zadd(_this.toKey('repeat'), nextMillis, repeatJobKey).then(function(){
          return Job.create(_this, name, data, _.extend(_.clone(opts), {
            jobId: customId,
            delay: delay < 0 ? 0 : delay,
            timestamp: Date.now()
          }));
        });
      }
    });
  };

  Queue.prototype.getRepeatableJobs = function (start, end, asc){
    var key = this.toKey('repeat');
    start = start || 0;
    end = end || -1;
    return (asc ?
      this.client.zrange(key, start, end, 'WITHSCORES') :
      this.client.zrevrange(key, start, end, 'WITHSCORES'))
      .then(function(result){
        var jobs = [];
        for(var i=0; i<result.length; i+=2){
          var data = result[i].split(':');
          jobs.push({
            name: data[0],
            id: data[1] || null,
            endDate: parseInt(data[2]) || null,
            tz: data[3] || null,
            cron: data[4],
            next: parseInt(result[i+1])
          });
        }
        return jobs;
      });
  };

  Queue.prototype.getRepeatableCount = function(){
    return this.client.zcard(this.toKey('repeat'));
  };
};
