/*eslint-env node */
/*global Promise:true */
'use strict';

var Queue = require('../');
var Promise = require('bluebird');
var STD_QUEUE_NAME = 'test queue';

function simulateDisconnect(queue){
  queue.client.stream.end();
  queue.bclient.stream.end();
  queue.eclient.stream.end();
}

function buildQueue(name) {
  var qName = name || STD_QUEUE_NAME;
  return new Queue(qName, 6379, '127.0.0.1');
}

function newQueue(name){
  var qName = name || STD_QUEUE_NAME;
  var queue = new Queue(qName, 6379, '127.0.0.1');
  return new Promise(function(resolve){
    queue.on('ready', function(){
      resolve(queue);
    });
  });
}

function cleanupQueue(queue) {
  return queue.empty().then(queue.close.bind(queue));
}

module.exports = {
  simulateDisconnect: simulateDisconnect,
  buildQueue: buildQueue,
  cleanupQueue: cleanupQueue,
  newQueue: newQueue
};
