var _ = require('lodash');

/**
 Timer Manager.

 There are currently two (transient) timers used by queues for
 cleanup/maintenance tasks. They both execute Redis commands,
 which means we can't close queues while these timers are active
 i.e. this won't work:

    queue.process(function (job, jobDone) {
      handle(job);
      queue.disconnect().then(jobDone);
    })

  The disconnect() call closes the Redis connections; then, when
  Bull tries to perform the scheduled Redis commands,
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

function TimerManager(){
  this.timers = {};
  this.idle = true;
  this.listeners = [];
}

/**
  Create a new named timer (setTimeout).
*/
TimerManager.prototype.set = function(name, delay, fn){
  this.timers[name] = setTimeout(fn, delay);
  this.idle = false;
};

/**
  Clear a named timer (clearTimeout).

  Queued listeners are executed if there are no
  remaining timers
*/
TimerManager.prototype.clear = function(name){
  var timers = this.timers;

  clearTimeout(timers[name]);
  delete timers[name];

  if((this.idle === false) && (_.size(timers) === 0)) {
    this.idle = true;

    while(this.listeners.length){
      this.listeners.pop()();
    }
  }
};

/**
  Register a callback to be called when there are no active timers.

  Called immediately if there are no active timers. Otherwise,
  queued and executed as soon as the last active timer has been
  cleared.
*/
TimerManager.prototype.whenIdle = function(fn){
    if (this.idle){
      fn();
    } else {
        this.listeners.unshift(fn);
    }
}

module.exports = TimerManager;
