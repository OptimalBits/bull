'use strict';

var fork = require('child_process').fork;
var path = require('path');
var Promise = require('bluebird');
var _ = require('lodash');

module.exports = function ChildPool() {
  if(!(this instanceof ChildPool)){
    return new ChildPool();
  }

  this.retained = {};
  this.free = [];

  this.retain = Promise.method(function(processFile){
    var child = this.free.pop();

    if (child) return child;

    child = fork(path.join(__dirname, './master.js'));

    this.retained[child.pid] = child;

    child.on('exit', this.remove.bind(this, child));

    var send = function(msg) {
      return new Promise(function(resolve){
        child.send(msg, resolve);
      });
    };

    return send({ cmd: 'init', value: processFile }).return(child);
  });

  this.release = function(child){
    delete this.retained[child.pid];
    this.free.push(child);
  };

  this.remove = function(child){
    delete this.retained[child.pid];
    var childIndex = this.free.indexOf(child);
    if (childIndex > -1) this.free.splice(childIndex, 1);
  };

  this.kill = function(child){
    child.kill();
    this.remove(child);
  };

  this.clean = function(){
    var children = _.values(this.retained).concat(this.free);
    children.forEach(this.kill.bind(this));

    this.retained = {};
    this.free = [];
  };
};
