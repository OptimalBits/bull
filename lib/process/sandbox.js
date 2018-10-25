'use strict';

var Promise = require('bluebird');

module.exports = function(processFile, childPool) {
  return function process(job) {
    return childPool.retain(processFile).then(function(child) {
      child.send({
        cmd: 'start',
        job: job
      });

      var done = new Promise(function(resolve, reject, onCancel) {
        function handler(msg) {
          switch (msg.cmd) {
            case 'completed':
              child.removeListener('message', handler);
              resolve(msg.value);
              break;
            case 'failed':
            case 'error':
              child.removeListener('message', handler);
              var err = new Error();
              Object.assign(err, msg.value);
              reject(err);
              break;
            case 'progress':
              job.progress(msg.value);
              break;
          }
        }

        onCancel(() => {
          child.removeListener('message', handler);
          reject(new Error('cancelled'));
        });

        child.on('message', handler);
      });

      return done.finally(function() {
        if (done.isCancelled()) {
          job.discard();
          job
            .moveToFailed(new Error('cancelled'), true)
            .then(() => child.kill());
        }

        childPool.release(child);
      });
    });
  };
};
