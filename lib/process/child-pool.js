'use strict';

var fork = require('child_process').fork;
var fs = require('fs');
var path = require('path');
var Promise = require('bluebird');
var _ = require('lodash');

var ChildPool = function ChildPool() {
  if (!(this instanceof ChildPool)) {
    return new ChildPool();
  }

  this.retained = {};
  this.free = {};
};

ChildPool.prototype.retain = function(processFile) {
  var _this = this;
  var child = _this.getFree(processFile).pop();

  if (child) {
    _this.retained[child.pid] = child;
    return Promise.resolve(child);
  }

  // if node process is running with --inspect, don't include that option
  // when spawning the children
  var execArgv = _.filter(process.execArgv, function(arg) {
    return arg.indexOf('--inspect') === -1;
  });

  child = fork(path.join(__dirname, './master.js'), {
    execArgv: execArgv
  });
  child.processFile = processFile;

  _this.retained[child.pid] = child;

  child.on('exit', _this.remove.bind(_this, child));

  return initChild(child, processFile).return(child);
};

ChildPool.prototype.release = function(child) {
  delete this.retained[child.pid];
  this.getFree(child.processFile).push(child);
};

ChildPool.prototype.remove = function(child) {
  delete this.retained[child.pid];

  var free = this.getFree(child.processFile);

  var childIndex = free.indexOf(child);
  if (childIndex > -1) {
    free.splice(childIndex, 1);
  }
};

ChildPool.prototype.kill = function(child, signal) {
  child.kill(signal || 'SIGKILL');
  this.remove(child);
};

ChildPool.prototype.clean = function() {
  var children = _.values(this.retained).concat(this.getAllFree());
  var _this = this;
  children.forEach(function(child) {
    // TODO: We may want to use SIGKILL if the process does not die after some time.
    _this.kill(child, 'SIGTERM');
  });

  this.retained = {};
  this.free = {};
};

ChildPool.prototype.getFree = function(id) {
  return (this.free[id] = this.free[id] || []);
};

ChildPool.prototype.getAllFree = function() {
  return _.flatten(_.values(this.free));
};

var initChild = function(child, processFile) {
  return new Promise(function(resolve) {
    child.send({ cmd: 'init', value: processFile }, resolve);
  });
};

module.exports = ChildPool;
