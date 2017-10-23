/*eslint-env node */
'use strict';

var _ = require('lodash');
var parser = require('cron-parser');
var crypto = require('crypto');

var Job = require('./job');

var TEST = process.env.NODE_ENV === 'test';

module.exports = function(Queue){

  Queue.prototype.nextRepeatableJob = function (name, data, opts, isRepetition){
    var _this = this;
    var client = this.client;
    var repeat = opts.repeat;
    if(!isRepetition && opts.jobId){
      repeat.jobId = opts.jobId;
    }
    var jobId = repeat.jobId ? repeat.jobId + ':' : ':';
    var repeatJobKey = getRepeatKey(name, repeat, jobId);

    return getTime(client).then(function(now){
      var getMillis;
      if(isRepetition){
        getMillis = client.zscore(_this.keys.repeat, repeatJobKey);
      }else {
        getMillis = client.getOrSetRepeatKey(_this.keys.repeat, repeatJobKey, now);
      };
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
          var customId = getRepeatJobId(name, jobId, nextMillis, md5(repeatJobKey));

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

  Queue.prototype.removeRepeatable = function(name, repeat){
    var _this = this;
    var repeatJobKey;

    if(typeof name !== 'string'){
      repeat = name;
      name = Job.DEFAULT_JOB_NAME;
    } else if ( arguments.length == 1){
      repeatJobKey = name;
    }

    return this.isReady().then(function(){
      if(!repeatJobKey){
        var jobId = repeat.jobId ? repeat.jobId + ':' : ':';
        var repeatJobId = getRepeatJobId(name, jobId, '');
        repeatJobKey = getRepeatKey(name, repeat, jobId);
      }
      return _this.client.removeRepeatable(_this.keys.repeat, _this.keys.delayed, repeatJobId, repeatJobKey);
    });
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
          key: result[i],
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

  function getTime(client){
    if(TEST){
      return Promise.resolve(Date.now() + 1);
    }else{
      return client.time().spread(function(now, micro){
        return parseInt(now) * 1000 + Math.round(parseInt(micro) * 0.001);
      });
    }
  }

  function getRepeatJobId(name, jobId, nextMillis, namespace){
    return 'repeat:' + md5(name + jobId + namespace) + ':' + nextMillis;
  }

  function getRepeatKey(name, repeat, jobId){
    var endDate = repeat.endDate ? (new Date(repeat.endDate)).getTime() + ':' : ':';
    var tz = repeat.tz ? repeat.tz + ':' : ':';
    return name + ':' + jobId + endDate + tz + repeat.cron;
  }

  function getNextMillis(millis, cron, opts){
    var currentDate = new Date(millis);
    var interval = parser.parseExpression(cron, _.defaults({
      currentDate: currentDate
    }, opts));

    try{
      return interval.next();
    } catch(e){
      // Ignore error
    }
  }

  function md5(str){
    return crypto.createHash('md5').update(str).digest('hex');
  }
};
