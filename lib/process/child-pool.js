'use strict';

var fork = require('child_process').fork;
var path = require('path');
var Promise = require('bluebird');

module.exports = function ChildPool() {
  if(!(this instanceof ChildPool)){
    return new ChildPool();
  }

  this.retained = {};
  this.free = [];

  this.retain = function(processFile){
    return new Promise(function(resolve, reject) {

      var child = this.free.pop();
      if(child){
        return resolve(child);
      }

      try{
        child = fork(path.join(__dirname, './master.js'));

        this.retained[child.pid] = child;

        child.on('exit', function(){
          delete this.retained[child.pid];
          var childIndex = this.free.indexOf(child);
          if (childIndex > -1) {
            this.free.splice(childIndex, 1);
          }
        }.bind(this));

        child.send({
          cmd: 'init',
          value: processFile
        }, function() {
          resolve(child);
        });
      } catch(err){
        reject(err);
      }
    }.bind(this));
  };

  this.release = function(child){
    delete this.retained[child.pid];
    this.free.push(child);
  };

  this.clean = function(){
    var keys = Object.keys(this.retained);
    for(var i=0; i<keys.length; i++){
      this.retained[keys[i]].kill();
    }
    this.retained = {};

    for(var i=0; i<this.free.length; i++){
      this.free[i].kill();
    }
    this.free = [];
  };
};
