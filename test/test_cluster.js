/*eslint-env node */
/*global Promise:true */
'use strict';

var cluster = require('cluster');
var os = require('os');
var path = require('path');
var Queue = require('../');
var expect = require('expect.js');
var Promise = require('bluebird');
var redis = require('redis');
var sinon = require('sinon');
var _ = require('lodash');
var uuid = require('node-uuid');

var STD_QUEUE_NAME = 'cluster test queue';

function buildQueue(name) {
  var qName = name || STD_QUEUE_NAME;
  return new Queue(qName, 6379, '127.0.0.1');
}

function purgeQueue(queue) {
  var client = redis.createClient(6379, '127.0.0.1', {});
  client = Promise.promisifyAll(client);
  client.selectAsync(0);

  var script = [
    'local KS = redis.call("KEYS", ARGV[1])',
    'local result = redis.call("DEL", unpack(KS))',
    'return'].join('\n');

  return queue.client.evalAsync(
    script,
    0,
    queue.toKey('*'));
}

cluster.setupMaster({
  exec: path.join(__dirname, '/cluster_worker.js')
});

var workerMessageHandler;
function workerMessageHandlerWrapper(message) {
  if(workerMessageHandler) {
    workerMessageHandler(message);
  }
}

var worker;
var _i = 0;
for(_i; _i < os.cpus().length - 1; _i++) {
  worker = cluster.fork();
  worker.on('message', workerMessageHandlerWrapper);
  console.log('Worker spawned, #', worker.id);
}

describe.only('Cluster', function () {

  var queue;

  afterEach(function(){
    if(queue){
      return purgeQueue(queue).then(function() {
        return queue.close.bind(queue)().then(function() {
          queue = undefined;
          workerMessageHandler = undefined;
        });
      });
    }
  });

  it('should process each job once', function(done) {
    var jobs = [];
    queue = buildQueue();

    workerMessageHandler = function(job) {
      jobs.push(job.id);
      if(jobs.length === 11) {
        var counts = {};
        var j = 0;
        for(j; j < jobs.length; j++) {
          expect(counts[jobs[j]]).to.be(undefined);
          counts[jobs[j]] = 1;
        }
        done();
      }
    };

    var i = 0;
    for(i; i < 11; i++) {
      queue.add({});
    }
  });

  it('should process delayed jobs in correct order', function(done) {
    this.timeout(12000);
    queue = buildQueue();
    var orders = [];

    workerMessageHandler = function(job) {
      orders.push(job.data.order);
      console.log(orders);
    };

    queue.add({ order: 1 }, { delay: 1000 });
    queue.add({ order: 6 }, { delay: 6000 });
    queue.add({ order: 10 }, { delay: 10000 });
    queue.add({ order: 2 }, { delay: 2000 });
    queue.add({ order: 9 }, { delay: 9000 });
    queue.add({ order: 5 }, { delay: 5000 });
    queue.add({ order: 3 }, { delay: 3000 });
    queue.add({ order: 7 }, { delay: 7000 });
    queue.add({ order: 4 }, { delay: 4000 });
    queue.add({ order: 8 }, { delay: 8000 });
  });

});
