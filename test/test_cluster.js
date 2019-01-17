'use strict';

const cluster = require('cluster');
const os = require('os');
const path = require('path');
const Queue = require('../');
const expect = require('expect.js');
const redis = require('ioredis');

const STD_QUEUE_NAME = 'cluster test queue';

function buildQueue(name) {
  const qName = name || STD_QUEUE_NAME;
  return new Queue(qName, 6379, '127.0.0.1');
}

function purgeQueue(queue) {
  // Since workers spawned only listen to the default queue,
  // we need to purge all keys after each test
  const client = new redis(6379, '127.0.0.1', {});
  client.select(0);

  const script = [
    'local KS = redis.call("KEYS", ARGV[1])',
    'local result = redis.call("DEL", unpack(KS))',
    'return'
  ].join('\n');

  return queue.client.eval(script, 0, queue.toKey('*')).finally(() => {
    return client.quit();
  });
}

cluster.setupMaster({
  exec: path.join(__dirname, '/cluster_worker.js')
});

let workerMessageHandler;
function workerMessageHandlerWrapper(message) {
  if (workerMessageHandler) {
    workerMessageHandler(message);
  }
}

describe.skip('Cluster', () => {
  const workers = [];

  before(() => {
    let worker;
    let _i = 0;
    for (_i; _i < os.cpus().length - 1; _i++) {
      worker = cluster.fork();
      worker.on('message', workerMessageHandlerWrapper);
      workers.push(worker);
      // console.log('Worker spawned: #', worker.id);
    }
  });

  let queue;

  afterEach(() => {
    if (queue) {
      return purgeQueue(queue).then(() => {
        return queue.close
          .bind(queue)()
          .then(() => {
            queue = undefined;
            workerMessageHandler = undefined;
          });
      });
    }
  });

  it('should process each job once', done => {
    const jobs = [];
    queue = buildQueue();
    const numJobs = 100;

    queue.on('stalled', job => {
      jobs.splice(jobs.indexOf(job.jobId), 1);
    });

    workerMessageHandler = function(job) {
      jobs.push(job.id);
      if (jobs.length === numJobs) {
        const counts = {};
        let j = 0;
        for (j; j < jobs.length; j++) {
          expect(counts[jobs[j]]).to.be(undefined);
          counts[jobs[j]] = 1;
        }
        done();
      }
    };

    let i = 0;
    for (i; i < numJobs; i++) {
      queue.add({});
    }
  });

  it('should process delayed jobs in correct order', function(done) {
    this.timeout(5000);
    queue = buildQueue();
    let order = 0;

    workerMessageHandler = function(job) {
      expect(order).to.be.below(job.data.order);
      order = job.data.order;
      if (order === 10) {
        done();
      }
    };

    queue.add({ order: 1 }, { delay: 100 });
    queue.add({ order: 6 }, { delay: 600 });
    queue.add({ order: 10 }, { delay: 1000 });
    queue.add({ order: 2 }, { delay: 200 });
    queue.add({ order: 9 }, { delay: 900 });
    queue.add({ order: 5 }, { delay: 500 });
    queue.add({ order: 3 }, { delay: 300 });
    queue.add({ order: 7 }, { delay: 700 });
    queue.add({ order: 4 }, { delay: 400 });
    queue.add({ order: 8 }, { delay: 800 });
  });

  it.skip('should process delayed jobs scheduled at the same timestamp in correct order (FIFO)', function(done) {
    /**
     * Note:
     * By logging out the jobId that is fetched in `updateDelaySet` via redis:
     * `redis.log(redis.LOG_WARNING, jobId)``
     * we can actually see that the jobs are being promoted in a correct order.
     * However, the following test almost always fails, one possible reason is that even though
     * jobs are fetched in order, there are enough workers to process them at the same time
     * therefore they appear to finish simultaneously.
     * TODO: find a better way to test this
     */

    this.timeout(5000);
    queue = buildQueue();
    let order = 0;

    workerMessageHandler = function(job) {
      expect(order).to.be.below(job.data.order);
      order = job.data.order;
      if (order === 10) {
        done();
      }
    };

    queue.add({ order: 1 }, { delay: 200 });
    queue.add({ order: 2 }, { delay: 200 });
    queue.add({ order: 3 }, { delay: 200 });
    queue.add({ order: 4 }, { delay: 200 });
    queue.add({ order: 5 }, { delay: 200 });
    queue.add({ order: 6 }, { delay: 200 });
    queue.add({ order: 7 }, { delay: 200 });
    queue.add({ order: 8 }, { delay: 200 });
    queue.add({ order: 9 }, { delay: 200 });
    queue.add({ order: 10 }, { delay: 200 });
  });

  after(() => {
    let _i = 0;
    for (_i; _i < workers.length; _i++) {
      workers[_i].kill();
    }
  });
});
