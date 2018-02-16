/*eslint-env node */
'use strict';

var _ = require('lodash');
var parser = require('cron-parser');
var crypto = require('crypto');

var Job = require('./job');

module.exports = function(Queue) {
  Queue.prototype.nextRepeatableJob = function(name, data, opts) {
    var _this = this;
    var client = this.client;
    var repeat = opts.repeat;
    var prevMillis = opts.prevMillis || 0;

    if (!prevMillis && opts.jobId) {
      repeat.jobId = opts.jobId;
    }

    repeat.count = repeat.count ? repeat.count + 1 : 1;

    if (!_.isUndefined(repeat.limit) && repeat.count > repeat.limit) {
      return Promise.resolve();
    }

    var now = Date.now();
    now = prevMillis < now ? now : prevMillis;

    var nextMillis = getNextMillis(now, repeat.cron, repeat);
    if (nextMillis) {
      var jobId = repeat.jobId ? repeat.jobId + ':' : ':';
      var repeatJobKey = getRepeatKey(name, repeat, jobId);

      nextMillis = nextMillis.getTime();

      return client
        .zadd(_this.keys.repeat, nextMillis, repeatJobKey)
        .then(function() {
          //
          // Generate unique job id for this iteration.
          //
          var customId = getRepeatJobId(
            name,
            jobId,
            nextMillis,
            md5(repeatJobKey)
          );
          now = Date.now();
          var delay = nextMillis - now;

          return Job.create(
            _this,
            name,
            data,
            _.extend(_.clone(opts), {
              jobId: customId,
              delay: delay < 0 ? 0 : delay,
              timestamp: now,
              prevMillis: nextMillis
            })
          );
        });
    } else {
      return Promise.resolve();
    }
  };

  Queue.prototype.removeRepeatable = function(name, repeat) {
    var _this = this;

    if (typeof name !== 'string') {
      repeat = name;
      name = Job.DEFAULT_JOB_NAME;
    }

    return this.isReady().then(function() {
      var jobId = repeat.jobId ? repeat.jobId + ':' : ':';
      var repeatJobKey = getRepeatKey(name, repeat, jobId);
      var repeatJobId = getRepeatJobId(name, jobId, '', md5(repeatJobKey));
      var queueKey = _this.keys[''];
      return _this.client.removeRepeatable(
        _this.keys.repeat,
        _this.keys.delayed,
        repeatJobId,
        repeatJobKey,
        queueKey
      );
    });
  };

  Queue.prototype.getRepeatableJobs = function(start, end, asc) {
    var key = this.keys.repeat;
    start = start || 0;
    end = end || -1;
    return (asc
      ? this.client.zrange(key, start, end, 'WITHSCORES')
      : this.client.zrevrange(key, start, end, 'WITHSCORES')
    ).then(function(result) {
      var jobs = [];
      for (var i = 0; i < result.length; i += 2) {
        var data = result[i].split(':');
        jobs.push({
          key: result[i],
          name: data[0],
          id: data[1] || null,
          endDate: parseInt(data[2]) || null,
          tz: data[3] || null,
          cron: data[4],
          next: parseInt(result[i + 1])
        });
      }
      return jobs;
    });
  };

  Queue.prototype.getRepeatableCount = function() {
    return this.client.zcard(this.toKey('repeat'));
  };

  function getRepeatJobId(name, jobId, nextMillis, namespace) {
    return 'repeat:' + md5(name + jobId + namespace) + ':' + nextMillis;
  }

  function getRepeatKey(name, repeat, jobId) {
    var endDate = repeat.endDate
      ? new Date(repeat.endDate).getTime() + ':'
      : ':';
    var tz = repeat.tz ? repeat.tz + ':' : ':';
    return name + ':' + jobId + endDate + tz + repeat.cron;
  }

  function getNextMillis(millis, cron, opts) {
    var currentDate = new Date(millis);
    var interval = parser.parseExpression(
      cron,
      _.defaults(
        {
          currentDate: currentDate
        },
        opts
      )
    );

    try {
      return interval.next();
    } catch (e) {
      // Ignore error
    }
  }

  function md5(str) {
    return crypto
      .createHash('md5')
      .update(str)
      .digest('hex');
  }
};
