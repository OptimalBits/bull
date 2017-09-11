var Promise = require('bluebird');
var childPool = require('./child-pool');

module.exports = function(processFile){
  return function process(job){
    return childPool.retain(processFile).then(function(child){

      child.send({
        cmd: 'start',
        job: job
      });

      return (new Promise((resolve, reject) => {
        function handler(msg){
          switch(msg.cmd){
            case 'completed':
              child.removeListener('message', handler)
              resolve(msg.value);
              break;
            case 'failed':
            case 'error':
              child.removeListener('message', handler)
              reject(msg.result);
              break;
            case 'progress':
              job.progress(msg.value);
              break;
          }
        }

        child.on('message', handler);
      })).finally( () => childPool.release(child));

    });
  }
}
