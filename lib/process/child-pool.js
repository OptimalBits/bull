
var {fork} = require('child_process');
var path = require('path');
var pool = {};
var Promise = require('bluebird');

module.exports.retain = function(processFile){
  return new Promise((resolve, rejected) => {
    var keys = Object.keys(pool)
      for(var i=0; i<keys.length; i++){
        var child = pool[keys[i]];
        if(!child.retained){
          child.retained = true;
          return resolve(child.subprocess);
        }
      }

      try{
        var child = fork(path.join(__dirname, './master.js'));

        pool[child.pid] = {
          subprocess: child,
          retained: true
        };

        child.send({
          cmd: 'init',
          value: processFile
        }, () => {
          resolve(child);
        });
      }catch(err){
        throw(err);
      }
  });
}

module.exports.release = function(child){;
  pool[child.pid].retained = false;
}
