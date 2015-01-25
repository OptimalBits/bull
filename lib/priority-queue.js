"use strict";

var Queue = require('./queue');
var Promise = require("bluebird");
var events = require('events');
var util = require('util');

var Strategy = {};


/**
 * This Strategy ensure that a queue Qn will be processing twice faster as all lower queue.
 * @param n
 * @returns {number}
 */
Strategy.exponential = function(n) {
  return Math.exp(n) * 2;
};


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
    this.queues.push(Queue(PriorityQueue.getQueueName(name, key), redisPort, redisHost, redisOptions));
  }

  Promise.map(this.queues, function(queue) {
    return new Promise(function(resolve, reject) {
      queue.once('ready', resolve);
    });
  }).then(_this.emit.bind(_this, 'ready'))

  this.queues.forEach(function(queue) {
      queue.on('error', _this.emit.bind(_this, 'error'));
  })

  this.queues.forEach(function(queue) {
      queue.on('progress', _this.emit.bind(_this, 'progress'));
  })

  this.queues.forEach(function(queue) {
    queue.on('completed', _this.emit.bind(_this, 'completed'));
  })

  this.queues.forEach(function(queue) {
    queue.on('failed', _this.emit.bind(_this, 'failed'));
  })


  this.strategy = Strategy.exponential;
}

util.inherits(PriorityQueue, events.EventEmitter);

PriorityQueue.priorities = {
  low: -2,
  normal: -1,
  medium: 0,
  hight: 1,
  critical: 2
}

PriorityQueue.getQueueName = function(name, priority){
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

PriorityQueue.prototype.close = function() {
  return Promise.map(this.queues, function(queue) {
    return queue.close();
  })
}

PriorityQueue.prototype.process = function(handler) {
  this.handler = handler;
  this.queues.forEach(function (queue, key) {
    queue.handler = handler;
  });

  return this.run();
}

PriorityQueue.prototype.run = function() {
  var _this = this;

  var loop = function() {
    var emptyLoop = true;

    return Promise.map(_this.queues, function (queue, index) {
      var nbJobsToProcess = _this.strategy(index);
      var i = 0;

      var fn = function () {
        return queue.processStalledJobs().then(queue.getNextJob.bind(queue, {block: false}))
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
    }, {concurrency: 1}).finally(function() {
      if (!_this.paused) {
        return Promise.delay((emptyLoop) ? _this.waitAfterEmptyLoop : 0).then(loop);
      }
    }).catch(function() {
      console.log(arguments);
    });
  }

  return loop().then(function() {

  });
}

PriorityQueue.prototype.add = function(data, opts) {
  return this.getQueue(opts && opts.priority).add(data, opts);
}

PriorityQueue.prototype.empty = function() {
  return Promise.map(this.queues, function(queue) {
    return queue.empty();
  });
}

PriorityQueue.prototype.pause = function() {
  var _this = this;

  _this.paused = Promise.map(this.queues, function(queue) {
    return queue.pause();
  }).then(_this.emit.bind(_this, 'paused'));

  return _this.paused;
}

PriorityQueue.prototype.resume = function() {
  var _this = this;
  _this.paused = false;
  return Promise.map(this.queues, function(queue) {
    return queue.resume();
  }).then(_this.emit.bind(_this, 'resumed')).then(function() {
    if (_this.handler) {
      _this.run();
    }
  });
}

PriorityQueue.genericCount = function(fnName) {
  return function() {
    var args = arguments;
    return Promise.map(this.queues, function (queue) {
      return queue[fnName].apply(queue, args);
    }).then(function (results) {
      var jobs = [];
      results.forEach(function (val) {
        jobs = jobs.concat(val);
      });
      return jobs;
    })
  }
}

PriorityQueue.prototype.count = function() {
  return Promise.map(this.queues, function (queue) {
    return queue.count();
  }).then(function (results) {
    var sum = 0;
    results.forEach(function (val) {
      sum += val
    });
    return sum;
  })
};

PriorityQueue.prototype.getWaiting = PriorityQueue.genericCount("getWaiting");
PriorityQueue.prototype.getActive = PriorityQueue.genericCount("getActive");
PriorityQueue.prototype.getDelayed = PriorityQueue.genericCount("getDelayed");
PriorityQueue.prototype.getCompleted = PriorityQueue.genericCount("getCompleted");
PriorityQueue.prototype.getFailed = PriorityQueue.genericCount("getFailed");


// ---------------------------------------------------------------------
// Private methods
// ---------------------------------------------------------------------

PriorityQueue.prototype.getQueue = function(priority) {
  if (!PriorityQueue.priorities[priority]) {
    //console.log("Unknown priotity " + priority);
    priority = "normal";
  }

  return this.queues[PriorityQueue.priorities[priority] + 2];
}
