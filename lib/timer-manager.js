/*eslint-env node */
'use strict';

var Promise = require('bluebird');
var _ = require('lodash');
var uuid = require('uuid');

/**
  Timer Manager

  Keep track of timers to ensure that disconnect() is
  only called (via close()) at a time when it's safe
  to do so.

  Queues currently use two timers:

    - The first one is used for delayed jobs and is
    preemptible i.e. it is possible to close a queue
    while delayed jobs are still pending (they will
    be processed when the queue is resumed). This timer
    is cleared by close() and is not managed here.

    - The second one is used to lock Redis while
    processing jobs. These timers are short-lived,
    and there can be more than one active at a
    time.

  The lock timer executes Redis commands, which
  means we can't close queues while it's active i.e.
  this won't work:

    queue.process(function (job, jobDone) {
      handle(job);
      queue.disconnect().then(jobDone);
    })

  The disconnect() call closes the Redis connections; then, when
  a queue tries to perform the scheduled Redis commands,
  they block until a Redis connection becomes available...

  The solution is to close the Redis connections when there are no
  active timers i.e. when the queue is idle. This helper class keeps
  track of the active timers and executes any queued listeners
  whenever that count goes to zero.

  Since disconnect() simply can't work if there are active handles,
  its close() wrapper postpones closing the Redis connections
  until the next idle state. This means that close() can safely
  be called from anywhere at any time, even from within a job
  handler:

    queue.process(function (job, jobDone) {
      handle(job);
      queue.close();
      jobDone();
    })
*/

function TimerManager() {
  this.idle = true;
  this.listeners = [];
  this.timers = {};
}

/**
  Create a new timer (setTimeout).

  Expired timers are automatically cleared

  @param {String} name - Name of a timer key. Used only for debugging.
  @param {Number} delay - delay of timeout
  @param {Function} fn - Function to execute after delay
  @returns {Number} id - The timer id. Used to clear the timer
*/
TimerManager.prototype.set = function(name, delay, fn) {
  var id = uuid.v4();
  var timer = setTimeout(
    function(timerInstance, timeoutId) {
      timerInstance.clear(timeoutId);
      try {
        fn();
      } catch (err) {
        console.error(err);
      }
    },
    delay,
    this,
    id
  );

  // XXX only the timer is used, but the
  // other fields are useful for
  // troubleshooting/debugging
  this.timers[id] = {
    name: name,
    timer: timer
  };

  this.idle = false;
  return id;
};

/**
  Clear a timer (clearTimeout).

  Queued listeners are executed if there are no
  remaining timers
*/
TimerManager.prototype.clear = function(id) {
  var timers = this.timers;
  var timer = timers[id];
  if (!timer) {
    return;
  }
  clearTimeout(timer.timer);
  delete timers[id];
  if (!this.idle && _.size(timers) === 0) {
    while (this.listeners.length) {
      this.listeners.pop()();
    }
    this.idle = true;
  }
};

TimerManager.prototype.clearAll = function() {
  var _this = this;
  _.each(this.timers, function(timer, id) {
    _this.clear(id);
  });
};

/**
 * Returns a promise that resolves when there are no active timers.
 */
TimerManager.prototype.whenIdle = function() {
  var _this = this;
  return new Promise(function(resolve) {
    if (_this.idle) {
      resolve();
    } else {
      _this.listeners.unshift(resolve);
    }
  });
};

module.exports = TimerManager;
