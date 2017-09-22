/*eslint-env node */
'use strict';

var _ = require('lodash');
var parser = require('cron-parser');
var Job = require('./job');
var TEST = process.env.NODE_ENV === 'test';

module.exports = function(Queue){

  function getTime(client){
    if(TEST){
      return Promise.resolve(Date.now() + 1);
    }else{
      return client.time().spread(function(now, micro){
        return parseInt(now) * 1000 + Math.round(parseInt(micro) * 0.001);
      });
    }
  }

  Queue.prototype.nextRepeatableJob = function (name, data, opts, isRepeat){
    var _this = this;
    var client = this.client;
    var repeat = opts.repeat;
    if(!isRepeat && opts.jobId){
      repeat.jobId = opts.jobId;
    }
    var jobId = repeat.jobId ? repeat.jobId + ':' : ':';
    var repeatJobKey = getRepeatKey(name, repeat, jobId);

    return getTime(client).then(function(now){
      var getMillis;
      if(isRepeat){
        getMillis = client.zscore(_this.keys.repeat, repeatJobKey);
      }else {
        getMillis = client.getOrSetRepeatKey(_this.keys.repeat, repeatJobKey, now);
      };
      getMillis = client.getOrSetRepeatKey(_this.keys.repeat, repeatJobKey, now);
      return getMillis.then(function(millis){
        millis = parseInt(millis);
        if(millis > now || !millis){
          // We have already a next repeatable job scheduled.
          // or the job has been removed.
          return;
        }
        var nextMillis = getNextMillis(now, repeat.cron, repeat);
        if(nextMillis){
          nextMillis = nextMillis.getTime();
          var delay = nextMillis - now;
          //
          // Generate unique job id for this iteration.
          //
          var customId = getRepeatJobId(name, jobId, nextMillis);

          //
          // TODO: Set key and add job should be atomic.
          //
          return client.zadd(_this.keys.repeat, nextMillis, repeatJobKey).then(function(){
            return Job.create(_this, name, data, _.extend(_.clone(opts), {
              jobId: customId,
              delay: delay < 0 ? 0 : delay,
              timestamp: now
            }));
          });
        }
      });
    });
  };

  function getRepeatJobId(name, jobId, nextMillis){
    return 'repeat:' + name + ':' + jobId + nextMillis;
  }

  function getRepeatKey(name, repeat, jobId){
    var endDate = repeat.endDate ? repeat.endDate + ':' : ':';
    var tz = repeat.tz ? repeat.tz + ':' : ':';
    return name + ':' + jobId + endDate + tz + repeat.cron;
  }

  Queue.prototype.removeRepeatable = function(name, repeat){
    if(typeof name !== 'string'){
      repeat = name;
      name = Job.DEFAULT_JOB_NAME;
    }
    var jobId = repeat.jobId ? repeat.jobId + ':' : ':';
    var repeatJobId = getRepeatJobId(name, jobId, '');
    var repeatJobKey = getRepeatKey(name, repeat, jobId);
    return this.client.removeRepeatable(this.keys.repeat, this.keys.delayed, repeatJobId, repeatJobKey);
  };

  Queue.prototype.getRepeatableJobs = function (start, end, asc){
    var key = this.keys.repeat;
    start = start || 0;
    end = end || -1;
    return (asc ?
      this.client.zrange(key, start, end, 'WITHSCORES') :
      this.client.zrevrange(key, start, end, 'WITHSCORES')
    ).then(function(result){
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

  function getNextMillis(millis, cron, opts){
    var interval = parser.parseExpression(cron, _.defaults({
      currentDate: new Date(millis)
    }, opts));

    try{
      return interval.next();
    } catch(e){
      // Ignore error
    }
  }
};
