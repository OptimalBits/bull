/**
 * Master of child processes. Handles communication between the
 * processor and the main process.
 *
 */
'use strict';

let status;
let processor;

//TODO remove for node >= 10
require('promise.prototype.finally').shim();

const promisify = require('util.promisify');

// https://stackoverflow.com/questions/18391212/is-it-not-possible-to-stringify-an-error-using-json-stringify
if (!('toJSON' in Error.prototype)) {
  Object.defineProperty(Error.prototype, 'toJSON', {
    value: function() {
      const alt = {};

      Object.getOwnPropertyNames(this).forEach(function(key) {
        alt[key] = this[key];
      }, this);

      return alt;
    },
    configurable: true,
    writable: true
  });
}

process.on('message', msg => {
  switch (msg.cmd) {
    case 'init':
      processor = require(msg.value);
      if (processor.default) {
        // support es2015 module.
        processor = processor.default;
      }
      if (processor.length > 1) {
        processor = promisify(processor);
      } else {
        const origProcessor = processor;
        processor = function() {
          try {
            return Promise.resolve(origProcessor.apply(null, arguments));
          } catch (err) {
            return Promise.reject(err);
          }
        };
      }
      status = 'IDLE';
      break;

    case 'start':
      if (status !== 'IDLE') {
        return process.send({
          cmd: 'error',
          err: new Error('cannot start a not idling child process')
        });
      }
      status = 'STARTED';
      Promise.resolve(processor(wrapJob(msg.job)) || {})
        .then(
          result => {
            process.send({
              cmd: 'completed',
              value: result
            });
          },
          err => {
            if (!err.message) {
              err = new Error(err);
            }
            process.send({
              cmd: 'failed',
              value: err
            });
          }
        )
        .finally(() => {
          status = 'IDLE';
        });
      break;
    case 'stop':
      break;
  }
});

process.on('uncaughtException', err => {
  if (!err.message) {
    err = new Error(err);
  }
  process.send({
    cmd: 'failed',
    value: err
  });
  throw err;
});

/**
 * Enhance the given job argument with some functions
 * that can be called from the sandboxed job processor.
 *
 * Note, the `job` argument is a JSON deserialized message
 * from the main node process to this forked child process,
 * the functions on the original job object are not in tact.
 * The wrapped job adds back some of those original functions.
 */
function wrapJob(job) {
  /*
   * Emulate the real job `progress` function.
   * If no argument is given, it behaves as a sync getter.
   * If an argument is given, it behaves as an async setter.
   */
  let progressValue = job.progress;
  job.progress = function(progress) {
    if (progress) {
      // Locally store reference to new progress value
      // so that we can return it from this process synchronously.
      progressValue = progress;
      // Send message to update job progress.
      process.send({
        cmd: 'progress',
        value: progress
      });
      return Promise.resolve();
    } else {
      // Return the last known progress value.
      return progressValue;
    }
  };
  /*
   * Emulate the real job `log` function.
   */
  job.log = function(row) {
    process.send({
      cmd: 'log',
      value: row
    });
  };
  return job;
}
