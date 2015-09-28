/*eslint-env node */
/*global Promise:true */
'use strict';

var Queue = require('../lib/queue');
var PriorityQueue = require('../lib/priority-queue');
var Redis = require('ioredis');
var uuid = require('node-uuid');

var STD_QUEUE_NAME = 'test queue';
var redis = new Redis();

function buildQueue(name, config){
  config = config || {};
  config.prefix = config.prefix || 'bull-test-queue';
  return new Queue(name || (STD_QUEUE_NAME + uuid()), config);
}

function buildPriorityQueue(name, config) {
  config = config || {};
  config.prefix = config.prefix || 'bull-test-pqueue';
  return new PriorityQueue(name || (STD_QUEUE_NAME + uuid()), config);
}

function removeTestKeys(prefix){
  return redis.keys(prefix + ':*').then(function(keys){
    if(keys.length){
      return redis.del(keys);
    }
  });
}

function cleanupQueue(queue, prefix) {
  return queue.close().then(function() {
    return removeTestKeys(prefix);
  });
}

module.exports = {
  buildQueue: buildQueue,
  buildPriorityQueue: buildPriorityQueue,
  removeTestKeys: removeTestKeys,
  cleanupQueue: cleanupQueue
};
