'use strict';

var Promise = require('bluebird');

module.exports = function(processFile, childPool, killOnComplete){
  return function process(job){
    return childPool.retain(processFile).then(function(child){
      child.send({
        cmd: 'start',
        job: job
      });


      var done = new Promise(function(resolve, reject) {
        function handleMessage(msg){
          switch(msg.cmd){
            case 'completed':
              child.removeListener('message', handleMessage);
              child.removeListener('exit', handleExit);
              resolve(msg.value);
              break;
            case 'failed':
            case 'error':
              child.removeListener('message', handleMessage);
              child.removeListener('exit', handleExit);
              reject(msg.value);
              break;
            case 'progress':
              job.progress(msg.value);
              break;
          }
        }

        function handleExit(){
          handleMessage({ cmd: 'error', value: 'child process exited' });
        }

        child.on('message', handleMessage);
        child.on('exit', handleExit);
      });

      return done.finally(function(){
        if (killOnComplete) {
          return childPool.kill(child);
        } else {
          return childPool.release(child);
        }
      });
    });
  };
};
