/*eslint-env node */
'use strict';

var _ = require('lodash');
var Job = require('./job');

module.exports = function(Queue) {
  Queue.prototype.getJob = function(jobId) {
    return Job.fromId(this, jobId);
  };

  Queue.prototype._commandByType = function(types, count, callback) {
    var _this = this;

    return _.map(types, function(type) {
      type = type === 'waiting' ? 'wait' : type; // alias

      var key = _this.toKey(type);

      switch (type) {
        case 'completed':
        case 'failed':
        case 'delayed':
        case 'repeat':
          return callback(key, count ? 'zcard' : 'zrange');
        case 'active':
        case 'wait':
        case 'paused':
          return callback(key, count ? 'llen' : 'lrange');
      }
    });
  };

  /**
    Returns the number of jobs waiting to be processed.
  */
  Queue.prototype.count = function() {
    return this.getJobCountByTypes('wait', 'paused', 'delayed');
  };

  // Job counts by type
  // Queue#getJobCountByTypes('completed') => completed count
  // Queue#getJobCountByTypes('completed,failed') => completed + failed count
  // Queue#getJobCountByTypes('completed', 'failed') => completed + failed count
  // Queue#getJobCountByTypes('completed,waiting', 'failed') => completed + waiting + failed count
  Queue.prototype.getJobCountByTypes = function() {
    return this.getJobCounts.apply(this, arguments).then(function(result) {
      return _.chain(result)
        .values()
        .sum()
        .value();
    });
  };

  /**
   * Returns the job counts for each type specified or every list/set in the queue by default.
   *
   */
  Queue.prototype.getJobCounts = function() {
    var types = parseTypeArg(arguments);
    var multi = this.multi();

    this._commandByType(types, true, function(key, command) {
      multi[command](key);
    });

    return multi.exec().then(function(res) {
      var counts = {};
      res.forEach(function(res, index) {
        counts[types[index]] = res[1] || 0;
      });
      return counts;
    });
  };

  Queue.prototype.getCompletedCount = function() {
    return this.getJobCountByTypes('completed');
  };

  Queue.prototype.getFailedCount = function() {
    return this.getJobCountByTypes('failed');
  };

  Queue.prototype.getDelayedCount = function() {
    return this.getJobCountByTypes('delayed');
  };

  Queue.prototype.getActiveCount = function() {
    return this.getJobCountByTypes('active');
  };

  Queue.prototype.getWaitingCount = function() {
    return this.getJobCountByTypes('wait');
  };

  Queue.prototype.getPausedCount = function() {
    return this.getJobCountByTypes('paused');
  };

  Queue.prototype.getWaiting = function(start, end) {
    return this.getJobs(['wait', 'paused'], start, end, true);
  };

  Queue.prototype.getActive = function(start, end) {
    return this.getJobs('active', start, end, true);
  };

  Queue.prototype.getDelayed = function(start, end) {
    return this.getJobs('delayed', start, end, true);
  };

  Queue.prototype.getCompleted = function(start, end) {
    return this.getJobs('completed', start, end, false);
  };

  Queue.prototype.getFailed = function(start, end) {
    return this.getJobs('failed', start, end, false);
  };

  Queue.prototype.getRanges = function(types, start, end, asc) {
    var _this = this;

    start = _.isUndefined(start) ? 0 : start;
    end = _.isUndefined(end) ? -1 : end;

    var resultByType = _this._commandByType(
      parseTypeArg(types),
      false,
      function(key, command) {
        switch (command) {
          case 'lrange':
            if (asc) {
              return _this.client
                .lrange(key, -(end + 1), -(start + 1))
                .then(function(result) {
                  return result.reverse();
                });
            } else {
              return _this.client.lrange(key, start, end);
            }
          case 'zrange':
            return asc
              ? _this.client.zrange(key, start, end)
              : _this.client.zrevrange(key, start, end);
        }
      }
    );

    return Promise.all(resultByType).then(function(results) {
      return _.flatten(results);
    });
  };

  Queue.prototype.getJobs = function(types, start, end, asc) {
    var _this = this;
    return this.getRanges(types, start, end, asc).then(function(jobIds) {
      return Promise.all(jobIds.map(_this.getJobFromId));
    });
  };
};

function parseTypeArg(args) {
  var types = _.chain([])
    .concat(args)
    .join(',')
    .split(/\s*,\s*/g)
    .compact()
    .value();

  return types.length
    ? types
    : ['waiting', 'active', 'completed', 'failed', 'delayed'];
}
