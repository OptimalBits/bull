'use strict';

var fork = require('child_process').fork;
var path = require('path');
var Promise = require('bluebird');

module.exports = function ChildPool() {
  if(!(this instanceof ChildPool)){
    return new ChildPool();
  }

  var retained = {};
  var free = [];

  this.retain = function(processFile){
    return new Promise(function(resolve, reject) {

      var child = free.pop();
      if(child){
        return resolve(child);
      }

      try{
        var child = fork(path.join(__dirname, './master.js'));

        retained[child.id];

        child.on('exit', function(code, signal){
          console.error('Child process exited', child.pid, code, signal);

          // Remove exited child
          deleteChild(child);

          function deleteChild(child){
            delete retained[child.pid];
            var childIndex = free.indexOf(child);
            if (childIndex > -1) {
              free.splice(childIndex, 1);
            }
          }
        });

        child.send({
          cmd: 'init',
          value: processFile
        }, function() {
          resolve(child);
        });
      } catch(err){
        reject(err);
      }
    });
  };

  this.release = function(child){
    delete retained[child.pid];
    free.push(child);
  };

  this.clean = function(){
    var keys = Object.keys(retained);
    for(var i=0; i<keys.length; i++){
      retained[keys[i]].kill();
    }
    retained = {};

    for(var i=0; i<free.length; i++){
      free[i].kill();
    }
    free = [];
  };
};
