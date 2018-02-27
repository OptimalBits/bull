/**
 * Master of child processes. Handles communication between the
 * processor and the main process.
 *
 */
var status;
var processor;
var Promise = require('bluebird');

// https://stackoverflow.com/questions/18391212/is-it-not-possible-to-stringify-an-error-using-json-stringify
if (!('toJSON' in Error.prototype)) {
  Object.defineProperty(Error.prototype, 'toJSON', {
    value: function() {
      var alt = {};

      Object.getOwnPropertyNames(this).forEach(function(key) {
        alt[key] = this[key];
      }, this);

      return alt;
    },
    configurable: true,
    writable: true
  });
}

process.on('message', function(msg) {
  switch (msg.cmd) {
    case 'init':
      processor = require(msg.value);
      if (processor.default) {
        // support es2015 module.
        processor = processor.default;
      }
      if (processor.length > 1) {
        processor = Promise.promisify(processor);
      } else {
        processor = Promise.method(processor);
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
          function(result) {
            process.send({
              cmd: 'completed',
              value: result
            });
          },
          function(err) {
            process.send({
              cmd: 'failed',
              value: err
            });
          }
        )
        .finally(function() {
          status = 'IDLE';
        });
      break;
    case 'stop':
      break;
  }
});

function wrapJob(job) {
  job.progress = function(progress) {
    process.send({
      cmd: 'progress',
      value: progress
    });
  };
  return job;
}
