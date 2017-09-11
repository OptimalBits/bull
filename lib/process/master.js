/**
 * Master of child processes. Handles communication between the
 * processor and the main process.
 *
 */
var status;
var processor;
var Promise = require('bluebird');

process.on('message', (msg) => {

  switch(msg.cmd){
    case 'init':
      processor = require(msg.value);
      status = 'IDLE';
      break;

    case 'start':
      if(status !== 'IDLE'){
        return process.send({
          cmd: 'error',
          err: new Error('cannot start a not idling child process')
        });
      }
      status = 'STARTED';
      Promise.resolve(processor(wrapJob(msg.job)) || {}).then( (result) => {
        process.send({
          cmd: 'completed',
          result: result
        });
      }, (err) => {
        process.send({
          cmd: 'failed',
          err: err
        });
      }).finally(() => status = 'IDLE');
      break;
    case 'stop':
      break;
  }
});

var jobHandler = {
  get: function(target, name) {
    if(name === 'progress'){
      return function(progress){
        process.send({
          cmd: 'progress',
          value: progress
        });
      }
    }else{
      return target[name];
    }
  }
};

function wrapJob(job){
  var proxy = new Proxy(job, jobHandler);
  return proxy;
}
