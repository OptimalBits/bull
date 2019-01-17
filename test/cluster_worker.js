'use strict';

const Queue = require('../');

const STD_QUEUE_NAME = 'cluster test queue';

function buildQueue(name) {
  const qName = name || STD_QUEUE_NAME;
  return new Queue(qName, 6379, '127.0.0.1');
}

const queue = buildQueue();

queue.process(1, (job, jobDone) => {
  jobDone();
  process.send({
    id: job.jobId,
    data: job.data
  });
});

process.on('disconnect', () => {
  queue
    .close()
    .then(() => {
      //  process.exit(0);
    })
    .catch(err => {
      console.error(err);
      //  process.exit(-1);
    });
});
