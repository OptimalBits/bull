'use strict';

var Promise = require('bluebird');

module.exports = function(processFile, childPool) {
  return function process(job) {
    return childPool.retain(processFile).then(function(child) {
      child.send({
        cmd: 'start',
        job: job
      });

      var done = new Promise(function(resolve, reject) {
        function handler(msg) {
          switch (msg.cmd) {
            case 'completed':
              child.removeListener('message', handler);
              resolve(msg.value);
              break;
            case 'failed':
            case 'error':
              child.removeListener('message', handler);
              reject(msg.value);
              break;
            case 'progress':
              job.progress(msg.value);
              break;
          }
        }

        child.on('message', handler);
      });

      return done.finally(function() {
        childPool.release(child);
      });
    });
  };
};
