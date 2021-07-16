'use strict';

const fork = require('child_process').fork;
const path = require('path');
const _ = require('lodash');
const getPort = require('get-port');
const { killAsync } = require('./utils');

const CHILD_KILL_TIMEOUT = 30000;

const ChildPool = function ChildPool() {
  if (!(this instanceof ChildPool)) {
    return new ChildPool();
  }

  // Flag for keeping or killing processes after finished processing, default keep always
  this.reuseProcesses = true;

  this.retained = {};
  this.free = {};
};

const convertExecArgv = function(execArgv) {
  const standard = [];
  const promises = [];

  _.forEach(execArgv, arg => {
    if (arg.indexOf('--inspect') === -1) {
      standard.push(arg);
    } else {
      const argName = arg.split('=')[0];
      promises.push(
        getPort().then(port => {
          return `${argName}=${port}`;
        })
      );
    }
  });

  return Promise.all(promises).then(convertedArgs => {
    return standard.concat(convertedArgs);
  });
};

ChildPool.prototype.setReuseProcesses = function(reuseProcesses) {
  this.reuseProcesses = reuseProcesses;
}

ChildPool.prototype.retain = function(processFile) {
  const _this = this;
  let child = _this.getFree(processFile).pop();

  if (child) {
    _this.retained[child.pid] = child;
    return Promise.resolve(child);
  }

  return convertExecArgv(process.execArgv).then(execArgv => {
    child = fork(path.join(__dirname, './master.js'), {
      execArgv
    });
    child.processFile = processFile;

    _this.retained[child.pid] = child;

    child.on('exit', _this.remove.bind(_this, child));

    return initChild(child, child.processFile).then(() => {
      return child;
    });
  });
};

ChildPool.prototype.release = function(child) {
  if (this.reuseProcesses === true) {
    delete this.retained[child.pid];
    this.getFree(child.processFile).push(child);
  } else {
    this.kill(child);
  }
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
  this.remove(child);
  return killAsync(child, signal || 'SIGKILL', CHILD_KILL_TIMEOUT);
};

ChildPool.prototype.clean = function() {
  const children = _.values(this.retained).concat(this.getAllFree());
  this.retained = {};
  this.free = {};

  const allKillPromises = [];
  children.forEach(child => {
    allKillPromises.push(this.kill(child, 'SIGTERM'));
  });
  return Promise.all(allKillPromises).then(() => {});
};

ChildPool.prototype.getFree = function(id) {
  return (this.free[id] = this.free[id] || []);
};

ChildPool.prototype.getAllFree = function() {
  return _.flatten(_.values(this.free));
};

async function initChild(child, processFile) {
  const onComplete = new Promise(resolve => {
    const onMessageHandler = msg => {
      if (msg.cmd === 'init-complete') {
        resolve();
        child.off('message', onMessageHandler);
      }
    };
    child.on('message', onMessageHandler);
  });

  await new Promise(resolve =>
    child.send({ cmd: 'init', value: processFile }, resolve)
  );
  await onComplete;
}
module.exports = ChildPool;
