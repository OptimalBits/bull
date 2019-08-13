'use strict';

const fork = require('child_process').fork;
const path = require('path');
const _ = require('lodash');
const getPort = require('get-port');

class ChildPool {
  constructor() {
    this.retained = {};
    this.free = {};
  }

  retain(processFile) {
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
  }

  release(child) {
    delete this.retained[child.pid];
    this.getFree(child.processFile).push(child);
  }

  remove(child) {
    delete this.retained[child.pid];

    const free = this.getFree(child.processFile);

    const childIndex = free.indexOf(child);
    if (childIndex > -1) {
      free.splice(childIndex, 1);
    }
  }

  kill(child, signal) {
    child.kill(signal || 'SIGKILL');
    this.remove(child);
  }

  clean() {
    const children = _.values(this.retained).concat(this.getAllFree());

    children.forEach(child => {
      // TODO: We may want to use SIGKILL if the process does not die after some time.
      this.kill(child, 'SIGTERM');
    });

    this.retained = {};
    this.free = {};
  }

  getFree(id) {
    return (this.free[id] = this.free[id] || []);
  }

  getAllFree() {
    return _.flatten(_.values(this.free));
  }
}

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

const initChild = function(child, processFile) {
  return new Promise(resolve => {
    child.send({ cmd: 'init', value: processFile }, resolve);
  });
};

module.exports = ChildPool;
