"use strict";

var Queue = require('./queue');
var Promise = require("bluebird");
var events = require('events');
var util = require('util');

/**
   Priority Queue.

   This is a priority queue based on the normal Queue, to provide the same
   stability and robustness. The priority queue is in fact several Queues,
   one for every possible priority.
*/
var PriorityQueue = module.exports = function(name, redisPort, redisHost, redisOptions) {
  if (!(this instanceof PriorityQueue)) {
    return new PriorityQueue(name, redisPort, redisHost, redisOptions);
  }

  var _this = this;
  this.paused = false;
  this.queues = [];

  for (var key in PriorityQueue.priorities) {
    var queue = Queue(PriorityQueue.getQueueName(name, key), redisPort, redisHost, redisOptions);
    this.queues[PriorityQueue.priorities[key]] = queue;
  }

  var groupEvents = ['ready', 'paused', 'resumed']
  groupEvents.forEach(function(event) {
    Promise.map(_this.queues, function(queue) {
      return new Promise(function(resolve, reject) {
        queue.once(event, resolve);
      });
    }).then(_this.emit.bind(_this, event))    
  })

  var singleEvents = ['error', 'active', 'stalled', 'progress', 'completed', 'failed', 'cleaned']
  singleEvents.forEach(function(event) {
    _this.queues.forEach(function(queue) {
      queue.on(event, _this.emit.bind(_this, event))
    })
  })

  this.strategy = Strategy.exponential;
}

util.inherits(PriorityQueue, events.EventEmitter);

PriorityQueue.priorities = {
  low: 0,
  normal: 1,
  medium: 2,
  high: 3,
  critical: 4
}

PriorityQueue.getQueueName = function(name, priority) {
  return name + ':prio:' + priority;
}

/**
 * Priority queue do not use blocking
 * In order to avoid query redis too much, and to reduce load, we wait a certain time if we loop all queue
 * without processing any job (ie: all are empty)
 *
 * @type {number}
 */
PriorityQueue.prototype.waitAfterEmptyLoop = 200;

PriorityQueue.prototype.disconnect = function() {
  return Promise.map(this.queues, function(queue) {
    return queue.disconnect();
  })
}

PriorityQueue.prototype.close = function( doNotWaitJobs ) {
  return this.closing = Promise.map(this.queues, function(queue) {
    return queue.close( doNotWaitJobs );
  });
}

PriorityQueue.prototype.process = function(handler) {
  this.handler = handler;
  this.queues.forEach(function(queue, key) {
    queue.setHandler(handler);
  });
  return this.run();
}

//
// TODO: Remove the polling mechanism using pub/sub.
//
PriorityQueue.prototype.run = function() {
  var _this = this;

  // .reverse() is done in place and therefore mutating the queues array
  // so a copy is needed to prevent harmful side effects and general voodoo
  var reversedQueues = _this.queues.slice().reverse();

  var loop = function() {
    var emptyLoop = true;

    return Promise.each(reversedQueues, function(queue, index) {

      if(_this.closing){
        return _this.closing;
      }

      // the index is reversed to the actual priority number (0 is 'critical')
      // so flip it to get the correct "priority index"
      var nbJobsToProcess = _this.strategy(PriorityQueue.priorities.critical - index);
      var i = 0;

      var fn = function() {
        return queue.moveUnlockedJobsToWait().then(queue.getNextJob.bind(queue, {
            block: false
          }))
          .then(function(job) {
            if (job) {
              emptyLoop = false;
              return queue.processJob(job).then(function() {
                if (++i < nbJobsToProcess && !_this.paused) {
                  return fn();
                }
              })
            } else {
              //nothing It will release loop and call next priority queue even if we have no reach nbJobsToProcess
            }
          })
      }

      return fn();
    }).then(function() {
      if (!_this.paused) {
        return Promise.delay((emptyLoop) ? _this.waitAfterEmptyLoop : 0).then(loop);
      }
    });
  }

  return loop();
}

PriorityQueue.prototype.setLockRenewTime = function(lockRenewTime) {
  this.queues.forEach(function(queue) {
    queue.LOCK_RENEW_TIME = lockRenewTime;
  })
}

PriorityQueue.prototype.add = function(data, opts) {
  return this.getQueue(opts && opts.priority).add(data, opts);
}

PriorityQueue.prototype.empty = function() {
  return Promise.map(this.queues, function(queue) {
    return queue.empty();
  });
}

PriorityQueue.prototype.pause = function(localOnly) {
  var _this = this;
  
  _this.paused = Promise.map(this.queues, function(queue) {
    return queue.pause(localOnly || false);
  }).then(_this.emit.bind(_this, 'paused'));

  return _this.paused;
}

PriorityQueue.prototype.resume = function(localOnly) {
  var _this = this;
  _this.paused = false;
  return Promise.map(this.queues, function(queue) {
    return queue.resume(localOnly || false);
  }).then(_this.emit.bind(_this, 'resumed')).then(function() {
    if (_this.handler) {
      _this.run();
    }
  });
}

//See normal queue for options
PriorityQueue.prototype.clean = function(grace, type) {
  var _this = this;
  return Promise.map(this.queues, function(queue) {
    return queue.clean(grace, type);
  }).then(function (results) {
    var jobs = [].concat.apply([], results);
    var tp = type || 'completed';
    _this.emit('cleaned', jobs, tp);
    return Promise.resolve(jobs);
  });
}


PriorityQueue.prototype.count = function() {
  return Promise.map(this.queues, function(queue) {
    return queue.count();
  }).then(function(results) {
    var sum = 0;
    results.forEach(function(val) {
      sum += val;
    });
    return sum;
  })
};

/**
 * A generic function to get jobs in all queues
 *
 * @param fnName
 * @returns {Function}
 */
PriorityQueue.genericGetter = function(fnName) {
  return function() {
    var args = arguments;
    return Promise.map(this.queues, function(queue) {
      return queue[fnName].apply(queue, args);
    }).then(function(results) {
      var jobs = [];
      results.forEach(function(val) {
        jobs = jobs.concat(val);
      });
      return jobs;
    })
  }
}

PriorityQueue.prototype.getWaiting = PriorityQueue.genericGetter("getWaiting");
PriorityQueue.prototype.getActive = PriorityQueue.genericGetter("getActive");
PriorityQueue.prototype.getDelayed = PriorityQueue.genericGetter("getDelayed");
PriorityQueue.prototype.getCompleted = PriorityQueue.genericGetter("getCompleted");
PriorityQueue.prototype.getFailed = PriorityQueue.genericGetter("getFailed");


// ---------------------------------------------------------------------
// Private methods
// ---------------------------------------------------------------------
PriorityQueue.prototype.getQueue = function(priority) {
  if (!(priority in PriorityQueue.priorities)) {
    //in case of unknown priority, we use normal
    priority = "normal";
  }

  var queue = this.queues[PriorityQueue.priorities[priority]];
  return queue;
}

var Strategy = {};

/**
 * This Strategy ensure that a queue Qn will be processing twice faster as all lower queue.
 * @param n
 * @returns {number}
 */
Strategy.exponential = function(n) {
  return Math.pow(n, n) * 2;
};

/**
 * This strategy is the minimal acceptable to respect the rule Qn will be processing quicker than Qn-1
 *
 * @param n
 * @returns {*}
 */
Strategy.minimum = function(n) {
  return n + 1;
};

Strategy.square = function(n) {
  return Math.pow(n, 2);
};
