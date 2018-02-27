'use strict';

var Queue = require('..'),
  cluster = require('cluster');

var numWorkers = 8;
var queue = Queue('test concurrent queue', 6379, '127.0.0.1');

if (cluster.isMaster) {
  for (var i = 0; i < numWorkers; i++) {
    cluster.fork();
  }

  cluster.on('online', function(worker) {
    // Lets create a few jobs for every created worker
    for (var i = 0; i < 500; i++) {
      queue.add({ foo: 'bar' });
    }
  });

  cluster.on('exit', function(worker, code, signal) {
    console.log('worker ' + worker.process.pid + ' died');
  });
} else {
  queue.process(function(job, jobDone) {
    console.log('Job done by worker', cluster.worker.id, job.jobId);
    jobDone();
  });
}
