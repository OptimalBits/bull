'use strict';

const fork = require('child_process').fork;
const path = require('path');
const _ = require('lodash');

const ChildPool = function ChildPool() {
  if (!(this instanceof ChildPool)) {
    return new ChildPool();
  }

  this.retained = {};
  this.free = {};
};

ChildPool.prototype.retain = function(processFile) {
  let child = this.getFree(processFile).pop();

  if (child) {
    this.retained[child.pid] = child;
    return Promise.resolve(child);
  }

  // if node process is running with --inspect, don't include that option
  // when spawning the children
  const execArgv = _.filter(process.execArgv, arg => {
    return arg.indexOf('--inspect') === -1;
  });

  child = fork(path.join(__dirname, './master.js'), {
    execArgv
  });
  child.processFile = processFile;

  this.retained[child.pid] = child;

  child.on('exit', this.remove.bind(this, child));

  return initChild(child, processFile).then(() => {
    return child;
  });
};

ChildPool.prototype.release = function(child) {
  delete this.retained[child.pid];
  this.getFree(child.processFile).push(child);
};

ChildPool.prototype.remove = function(child) {
  delete this.retained[child.pid];

  const free = this.getFree(child.processFile);

  const childIndex = free.indexOf(child);
  if (childIndex > -1) {
    free.splice(childIndex, 1);
  }
};

ChildPool.prototype.kill = function(child, signal) {
  child.kill(signal || 'SIGKILL');
  this.remove(child);
};

ChildPool.prototype.clean = function() {
  const children = _.values(this.retained).concat(this.getAllFree());

  children.forEach(child => {
    // TODO: We may want to use SIGKILL if the process does not die after some time.
    this.kill(child, 'SIGTERM');
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

const initChild = function(child, processFile) {
  return new Promise(resolve => {
    child.send({ cmd: 'init', value: processFile }, resolve);
  });
};

module.exports = ChildPool;
