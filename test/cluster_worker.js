/*eslint-env node */
/*global Promise:true */
'use strict';

var Queue = require('../');

var STD_QUEUE_NAME = 'cluster test queue';

function buildQueue(name) {
  var qName = name || STD_QUEUE_NAME;
  return new Queue(qName, 6379, '127.0.0.1');
}

var queue = buildQueue();

queue.process(1, function(job, jobDone) {
  jobDone();
  process.send({
    id: job.jobId,
    data: job.data
  });
});

process.on('disconnect', function () {
  queue.close().then(function () {
//    process.exit(0);
  }).catch(function (err) {
    console.err(err);
  //  process.exit(-1);
  });
});
