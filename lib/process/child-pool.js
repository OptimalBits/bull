'use strict';

var fork = require('child_process').fork;
var path = require('path');
var Promise = require('bluebird');
var createPool = require('generic-pool').createPool;

module.exports = ChildPool;

function ChildPool(concurrency) {
  if(!(this instanceof ChildPool)){
    return new ChildPool(concurrency);
  }

  var factory = {
    create: function () {
      var child = fork(path.join(__dirname, './master.js'));
      return Promise.resolve(child);
    },
    destroy: function (child) {
      child.kill();
      return Promise.resolve();
    },
    validate: function (child) {
      var token = Math.random().toString();

      var response = new Promise(function (resolve) {
        var handler = function(msg) {
          if (msg.cmd === 'pong' && msg.value === token) {
            child.removeListener('message', handler);
            resolve();
          }
        };

        child.on('message', handler);
      });

      child.send({
        cmd:'ping',
        value: token
      });

      return response.timeout(100).return(true).catchReturn(false);
    }
  };

  this.pool = createPool(factory, {
    testOnBorrow: true,
    evictionRunIntervalMillis: 500,
    max: concurrency || 1
  });
};

ChildPool.prototype.retain = Promise.method(function(processFile){
  return this.pool.acquire().then(function(child){
    child.send({
      cmd: 'init',
      value: processFile
    });

    return child;
  });
});

ChildPool.prototype.release = function(child){
  return this.pool.release(child);
};

ChildPool.prototype.kill = function(child){
  return this.pool.destroy(child);
};

ChildPool.prototype.clean = function(){
  var pool = this.pool;
  return pool.drain().then(function(){
    return pool.clear();
  });
};
