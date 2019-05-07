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

function wrapJob(job) {
  job.progress = function(progress) {
    process.send({
      cmd: 'progress',
      value: progress
    });
    return Promise.resolve();
  };
  job.log = function(row) {
    process.send({
      cmd: 'log',
      value: row
    });
  };
  return job;
}
