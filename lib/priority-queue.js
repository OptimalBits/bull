"use strict";

var Queue = require('./queue');


var Strategy = {};


/**
 * This Strategy ensure that a queue Qn will be processing twice faster as all lower queue.
 * @param n
 * @returns {number}
 */
Strategy.exponential = function(n) {
  return 2*Math.exp(n);
};


/**
 Priority Queue.

 This is a priority queue based on the normal Queue, to provide the same
 stability and robustness. The priority queue is in fact several Queues,
 one for every possible priority.
 */
var PriorityQueue = function(name, redisPort, redisHost, redisOptions) {
  if (!(this instanceof PriorityQueue)) {
    return new PriorityQueue(name, redisPort, redisHost, redisOptions);
  }
  var queues = [];

  PriorityQueue.priorities.forEach(function (val, key) {
    queues.push(Queue(PriorityQueue.getQueueName(name, key), redisPort, redisHost, redisOptions));
  })
}

PriorityQueue.priorities = {
  low: -2,
  normal: -1,
  medium: 0,
  hight: 1,
  critical: 2
}

PriorityQueue.getQueueName = function(name, priority){
  return name + ':prio:' + priority;
}

PriorityQueue.prototype.close = function() {

}

PriorityQueue.prototype.process = function(handler) {

}

PriorityQueue.prototype.process = function(handler) {

}

PriorityQueue.prototype.add = function(data, opts) {

}

PriorityQueue.prototype.count = function() {

}

PriorityQueue.prototype.empty = function() {

}

PriorityQueue.prototype.pause = function() {

}

PriorityQueue.prototype.resume = function() {

}

PriorityQueue.prototype.run = function() {

}


