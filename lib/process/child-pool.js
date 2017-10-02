
var fork = require('child_process').fork;
var path = require('path');
var pool = {};
var Promise = require('bluebird');

module.exports.retain = function(processFile){
  return new Promise(function(resolve, rejected) {
    var keys = Object.keys(pool);
    for(var i=0; i<keys.length; i++){
      var child = pool[keys[i]];
      if(!child.retained){
        child.retained = true;
        return resolve(child.subprocess);
      }
    }

    try{
      var child = fork(path.join(__dirname, './master.js'));

      child.on('exit', function(code, signal){
        console.error('Child process exited', child.pid, code, signal);
        delete pool[child.pid];
      });

      pool[child.pid] = {
        subprocess: child,
        retained: true
      };

      child.send({
        cmd: 'init',
        value: processFile
      }, function() {
        resolve(child);
      });
    }catch(err){
      reject(err);
    }
  });
};

module.exports.release = function(child){;
  pool[child.pid].retained = false;
};

module.exports.clean = function(){
  var keys = Object.keys(pool);
  for(var i=0; i<keys.length; i++){
    pool[keys[i]].subprocess.kill();
    delete pool[keys[i]];
  }
};
