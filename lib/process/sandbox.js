'use strict';

//TODO remove for node >= 10
require('promise.prototype.finally').shim();

module.exports = function(processFile, childPool) {
  return function process(job) {
    return childPool.retain(processFile).then(child => {
      child.send({
        cmd: 'start',
        job: job
      });

      const done = new Promise((resolve, reject) => {
        function handler(msg) {
          switch (msg.cmd) {
            case 'completed':
              child.removeListener('message', handler);
              resolve(msg.value);
              break;
            case 'failed':
            case 'error': {
              child.removeListener('message', handler);
              const err = new Error();
              Object.assign(err, msg.value);
              reject(err);
              break;
            }
            case 'progress':
              job.progress(msg.value);
              break;
          }
        }

        child.on('message', handler);
        child.on('exit', exitCode => {
          reject(new Error('Unexpected exit code: ' + exitCode));
        });
      });

      return done.finally(() => {
        childPool.release(child);
      });
    });
  };
};
