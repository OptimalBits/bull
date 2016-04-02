/*eslint-env node */
'use strict';

var Queue = require('../');
var Promise = require('bluebird');
var STD_QUEUE_NAME = 'test queue';

var queues = [];

function simulateDisconnect(queue){
  queue.client.stream.end();
  queue.bclient.stream.end();
  queue.eclient.stream.end();
}

function buildQueue(name) {
  var queue = new Queue(name || STD_QUEUE_NAME, 6379, '127.0.0.1');
  queues.push(queue);
  return queue;
}

function newQueue(name){
  var queue = buildQueue(name);
  return new Promise(function(resolve){
    queue.on('ready', function(){
      resolve(queue);
    });
  });
}

function cleanupQueue(queue) {
  return queue.empty().then(queue.close.bind(queue));
}

function cleanupQueues() {
  return Promise.map(queues, function(queue){
    return queue.close();
  }).then(function(){
    queues = [];
  });
}

module.exports = {
  simulateDisconnect: simulateDisconnect,
  buildQueue: buildQueue,
  cleanupQueue: cleanupQueue,
  newQueue: newQueue,
  cleanupQueues: cleanupQueues
};
