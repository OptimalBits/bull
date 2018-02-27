'use strict';

var fork = require('child_process').fork;
var path = require('path');
var Promise = require('bluebird');
var _ = require('lodash');

module.exports = function ChildPool() {
  if (!(this instanceof ChildPool)) {
    return new ChildPool();
  }

  this.retained = {};
  this.free = {};

  this.retain = Promise.method(function(processFile) {
    var child = this.getFree(processFile).pop();

    if (child) {
      return child;
    }

    child = fork(path.join(__dirname, './master.js'));
    child.processFile = processFile;

    this.retained[child.pid] = child;

    child.on('exit', this.remove.bind(this, child));

    var send = function(msg) {
      return new Promise(function(resolve) {
        child.send(msg, resolve);
      });
    };

    return send({ cmd: 'init', value: processFile }).return(child);
  });

  this.release = function(child) {
    delete this.retained[child.pid];
    this.getFree(child.processFile).push(child);
  };

  this.remove = function(child) {
    delete this.retained[child.pid];

    var free = this.getFree(child.processFile);

    var childIndex = free.indexOf(child);
    if (childIndex > -1) {
      free.splice(childIndex, 1);
    }
  };

  this.kill = function(child, signal) {
    child.kill(signal);
    this.remove(child);
  };

  this.clean = function() {
    var children = _.values(this.retained).concat(this.getAllFree());
    var _this = this;
    children.forEach(function(child) {
      // TODO: We may want to use SIGKILL if the process does not die after some time.
      _this.kill(child, 'SIGTERM');
    });

    this.retained = {};
    this.free = {};
  };

  this.getFree = function(id) {
    return (this.free[id] = this.free[id] || []);
  };

  this.getAllFree = function() {
    return _.flatten(_.values(this.free));
  };
};
