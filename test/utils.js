/*eslint-env node */
'use strict';

var Queue = require('../');
var Promise = require('bluebird');
var STD_QUEUE_NAME = 'test queue';
var _ = require('lodash');

var queues = [];

var originalSetTimeout = setTimeout;

function simulateDisconnect(queue) {
  queue.client.disconnect();
  queue.eclient.disconnect();
}

function buildQueue(name, options) {
  options = _.extend({ redis: { port: 6379, host: '127.0.0.1' } }, options);
  var queue = new Queue(name || STD_QUEUE_NAME, options);
  queues.push(queue);
  return queue;
}

function newQueue(name, opts) {
  var queue = buildQueue(name, opts);
  return queue.isReady();
}

function cleanupQueue(queue) {
  return queue.empty().then(queue.close.bind(queue));
}

function cleanupQueues() {
  return Promise.map(queues, function(queue) {
    var errHandler = function() {};
    queue.on('error', errHandler);
    return queue.close().catch(errHandler);
  }).then(function() {
    queues = [];
  });
}

function sleep(ms) {
  return new Promise(function(resolve) {
    originalSetTimeout(function() {
      resolve();
    }, ms);
  });
}

module.exports = {
  simulateDisconnect: simulateDisconnect,
  buildQueue: buildQueue,
  cleanupQueue: cleanupQueue,
  newQueue: newQueue,
  cleanupQueues: cleanupQueues,
  sleep: sleep
};
