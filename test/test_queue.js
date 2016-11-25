/*eslint-env node */
'use strict';

var Queue = require('../');
var expect = require('expect.js');
var Promise = require('bluebird');
var redis = require('redis');
var sinon = require('sinon');
var _ = require('lodash');
var uuid = require('node-uuid');
var utils = require('./utils');

Promise.promisifyAll(redis.RedisClient.prototype);
Promise.promisifyAll(redis.Multi.prototype);

/*
console.error = function(){
};
*/

Promise.config({
  // Enable warnings.
  // warnings: true,
  // Enable long stack traces.
  longStackTraces: process.NODE_ENV !== 'production',
  // Enable cancellation.
  cancellation: true
});

describe('Queue', function () {
  var sandbox = sinon.sandbox.create();

  beforeEach(function () {
    var client = redis.createClient();
    return client.flushdbAsync();
  });

  afterEach(function () {
    sandbox.restore();
  });

  describe('.close', function () {
    var testQueue;
    beforeEach(function () {
      return utils.newQueue('test').then(function (queue) {
        testQueue = queue;
      });
    });

    it('should call end on the client', function (done) {
      testQueue.client.once('end', function () {
        done();
      });
      testQueue.close();
    });

    it('should call end on the blocking client', function () {
      var endSpy = sandbox.spy(testQueue.bclient, 'end');
      return testQueue.close().then(function () {
        expect(endSpy.calledOnce).to.be(true);
      });
    });

    it('should call end on the event subscriber client', function (done) {
      testQueue.eclient.once('end', function () {
        done();
      });
      testQueue.close();
    });

    it('should resolve the promise when each client has disconnected', function () {
      expect(testQueue.client.connected).to.be(true);
      expect(testQueue.bclient.connected).to.be(true);
      expect(testQueue.eclient.connected).to.be(true);

      return testQueue.close().then(function () {
        expect(testQueue.client.connected).to.be(false);
        expect(testQueue.bclient.connected).to.be(false);
        expect(testQueue.eclient.connected).to.be(false);
      });
    });

    it('should return a promise', function () {
      var closePromise = testQueue.close().then(function () {
        expect(closePromise).to.be.a(Promise);
      });
      return closePromise;
    });

    it('should close if the job expires after the LOCK_RENEW_TIME', function (done) {
      testQueue.LOCK_RENEW_TIME = 10;
      testQueue.process(function () {
        return Promise.delay(40);
      });

      testQueue.on('completed', function () {
        testQueue.close().then(done);
      });
      testQueue.add({ foo: 'bar' });
    });

    describe('should be callable from within', function () {
      it('a job handler that takes a callback', function (done) {
        this.timeout(12000); // Close can be a slow operation

        testQueue.process(function (job, jobDone) {
          expect(job.data.foo).to.be('bar');
          jobDone();
          testQueue.close().then(done);
        });

        testQueue.add({ foo: 'bar' }).then(function (job) {
          expect(job.jobId).to.be.ok();
          expect(job.data.foo).to.be('bar');
        });
      });

      it('a job handler that returns a promise', function (done) {
        testQueue.process(function (job) {
          expect(job.data.foo).to.be('bar');
          return Promise.resolve();
        });

        testQueue.on('completed', function () {
          testQueue.close().then(done);
        });

        testQueue.add({ foo: 'bar' }).then(function (job) {
          expect(job.jobId).to.be.ok();
          expect(job.data.foo).to.be('bar');
        });
      });
    });
  });

  describe('instantiation', function () {
    it('should create a queue with standard redis opts', function (done) {
      var queue = new Queue('standard');

      queue.once('ready', function () {
        expect(queue.client.connection_options.host).to.be('127.0.0.1');
        expect(queue.bclient.connection_options.host).to.be('127.0.0.1');

        expect(queue.client.connection_options.port).to.be(6379);
        expect(queue.bclient.connection_options.port).to.be(6379);

        expect(queue.client.selected_db).to.be(0);
        expect(queue.bclient.selected_db).to.be(0);

        queue.close().then(done);
      });
    });

    it('should create a queue with a redis connection string', function (done) {
      var queue = new Queue('connstring', 'redis://127.0.0.1:6379');

      queue.once('ready', function () {
        expect(queue.client.connection_options.host).to.be('127.0.0.1');
        expect(queue.bclient.connection_options.host).to.be('127.0.0.1');

        expect(queue.client.connection_options.port).to.be(6379);
        expect(queue.bclient.connection_options.port).to.be(6379);

        expect(queue.client.selected_db).to.be(0);
        expect(queue.bclient.selected_db).to.be(0);

        queue.close().then(done);

      });
    });

    it('should create a queue with a port number and a hostname', function (done) {
      var queue = new Queue('connstring', '6379', '127.0.0.1');

      queue.once('ready', function () {
        expect(queue.client.connection_options.host).to.be('127.0.0.1');
        expect(queue.bclient.connection_options.host).to.be('127.0.0.1');

        expect(queue.client.connection_options.port).to.be(6379);
        expect(queue.bclient.connection_options.port).to.be(6379);

        expect(queue.client.selected_db).to.be(0);
        expect(queue.bclient.selected_db).to.be(0);

        queue.close().then(done);

      });
    });

    it('creates a queue using the supplied redis DB', function (done) {
      var queue = new Queue('custom', { redis: { DB: 1 } });

      queue.once('ready', function () {
        expect(queue.client.connection_options.host).to.be('127.0.0.1');
        expect(queue.bclient.connection_options.host).to.be('127.0.0.1');

        expect(queue.client.connection_options.port).to.be(6379);
        expect(queue.bclient.connection_options.port).to.be(6379);

        expect(queue.client.selected_db).to.be(1);
        expect(queue.bclient.selected_db).to.be(1);

        queue.close().then(done);
      });
    });

    it('creates a queue using custom the supplied redis host', function (done) {
      var queue = new Queue('custom', { redis: { host: 'localhost' } });

      queue.once('ready', function () {
        expect(queue.client.connection_options.host).to.be('localhost');
        expect(queue.bclient.connection_options.host).to.be('localhost');

        expect(queue.client.selected_db).to.be(0);
        expect(queue.bclient.selected_db).to.be(0);

        queue.close().then(done);
      });
    });

    it('creates a queue with dots in its name', function () {
      var queue = new Queue('using. dots. in.name.');

      return queue.add({ foo: 'bar' }).then(function (job) {
        expect(job.jobId).to.be.ok();
        expect(job.data.foo).to.be('bar');
      }).then(function () {
        queue.process(function (job, jobDone) {
          expect(job.data.foo).to.be.equal('bar');
          jobDone();
        });
      }).then(function () {
        return queue.close();
      });
    });

    it('creates a queue accepting port as a string', function () {
      var queue = new Queue('foobar', '6379', 'localhost');

      return queue.add({ foo: 'bar' }).then(function (job) {
        expect(job.jobId).to.be.ok();
        expect(job.data.foo).to.be('bar');
      }).then(function () {
        queue.process(function (job, jobDone) {
          expect(job.data.foo).to.be.equal('bar');
          jobDone();
        });
      }).then(function () {
        return queue.close();
      });
    });

    it('should create a queue with a prefix option', function () {
      var queue = new Queue('q', 'redis://127.0.0.1', { keyPrefix: 'myQ' });

      return queue.add({ foo: 'bar' }).then(function (job) {
        expect(job.jobId).to.be.ok();
        expect(job.data.foo).to.be('bar');
      }).then(function () {
        return queue.close();
      });
    });

  });

  describe(' a worker', function () {
    var queue;

    beforeEach(function () {
      var client = redis.createClient();
      return client.flushdbAsync().then(function () {
        return utils.newQueue();
      }).then(function (_queue) {
        queue = _queue;
      });
    });

    afterEach(function () {
      return utils.cleanupQueues();
    });

    it('should process a job', function (done) {
      queue.process(function (job, jobDone) {
        expect(job.data.foo).to.be.equal('bar');
        jobDone();
        done();
      });
      queue.add({ foo: 'bar' }).then(function (job) {
        expect(job.jobId).to.be.ok();
        expect(job.data.foo).to.be('bar');
      }, done);
    });

    it('process a lifo queue', function (done) {
      this.timeout(3000);
      var currentValue = 0, first = true;
      utils.newQueue('test lifo').then(function (queue2) {
        queue2.process(function (job, jobDone) {
          // Catching the job before the pause
          expect(job.data.count).to.be.equal(currentValue--);
          jobDone();
          if (first) {
            first = false;
          } else if (currentValue === 0) {
            done();
          }
        });

        queue2.pause().then(function () {
          // Add a series of jobs in a predictable order
          var fn = function (cb) {
            queue2.add({ 'count': ++currentValue }, { 'lifo': true }).then(cb);
          };
          fn(fn(fn(fn(function () {
            queue2.resume();
          }))));
        });
      });
    });

    it('process several jobs serially', function (done) {
      this.timeout(12000);
      var counter = 1;
      var maxJobs = 35;

      queue.process(function (job, jobDone) {
        expect(job.data.num).to.be.equal(counter);
        expect(job.data.foo).to.be.equal('bar');
        jobDone();
        if (counter === maxJobs) {
          done();
        }
        counter++;
      });

      for (var i = 1; i <= maxJobs; i++) {
        queue.add({ foo: 'bar', num: i });
      }
    });

    it('process a job that updates progress', function (done) {
      queue.process(function (job, jobDone) {
        expect(job.data.foo).to.be.equal('bar');
        job.progress(42);
        jobDone();
      });

      queue.add({ foo: 'bar' }).then(function (job) {
        expect(job.jobId).to.be.ok();
        expect(job.data.foo).to.be('bar');
      }).catch(done);

      queue.on('progress', function (job, progress) {
        expect(job).to.be.ok();
        expect(progress).to.be.eql(42);
        done();
      });
    });

    it('process a job that returns data in the process handler', function (done) {
      queue.process(function (job, jobDone) {
        expect(job.data.foo).to.be.equal('bar');
        jobDone(null, 37);
      });

      queue.add({ foo: 'bar' }).then(function (job) {
        expect(job.jobId).to.be.ok();
        expect(job.data.foo).to.be('bar');
      }).catch(done);

      queue.on('completed', function (job, data) {
        expect(job).to.be.ok();
        expect(data).to.be.eql(37);
        expect(job.returnvalue).to.be.eql(37);
        done();
      });
    });

    it('process a job that returns data in the process handler and the returnvalue gets stored in the database', function (done) {
      queue.process(function (job, jobDone) {
        expect(job.data.foo).to.be.equal('bar');
        jobDone(null, 37);
      });

      queue.add({ foo: 'bar' }).then(function (job) {
        expect(job.jobId).to.be.ok();
        expect(job.data.foo).to.be('bar');
      }).catch(done);

      queue.on('completed', function (job, data) {
        expect(job).to.be.ok();
        expect(data).to.be.eql(37);
        expect(job.returnvalue).to.be.eql(37);
        queue.client.hgetAsync(queue.toKey(job.jobId), 'returnvalue').then(function (retval) {
          expect(JSON.parse(retval)).to.be.eql(37);
          done();
        });
      });
    });

    it('process a job that returns a promise', function (done) {
      queue.process(function (job) {
        expect(job.data.foo).to.be.equal('bar');
        return Promise.delay(250).then(function () {
          return 'my data';
        });
      });

      queue.add({ foo: 'bar' }).then(function (job) {
        expect(job.jobId).to.be.ok();
        expect(job.data.foo).to.be('bar');
      }).catch(done);

      queue.on('completed', function (job, data) {
        expect(job).to.be.ok();
        expect(data).to.be.eql('my data');
        done();
      });
    });

    it('process a job that returns data in a promise', function (done) {
      queue.process(function (job) {
        expect(job.data.foo).to.be.equal('bar');
        return Promise.delay(250, 42);
      });

      queue.add({ foo: 'bar' }).then(function (job) {
        expect(job.jobId).to.be.ok();
        expect(job.data.foo).to.be('bar');
      }).catch(done);

      queue.on('completed', function (job, data) {
        expect(job).to.be.ok();
        expect(data).to.be.eql(42);
        done();
      });
    });

    it('process a synchronous job', function (done) {
      queue.process(function (job) {
        expect(job.data.foo).to.be.equal('bar');
      });

      queue.add({ foo: 'bar' }).then(function (job) {
        expect(job.jobId).to.be.ok();
        expect(job.data.foo).to.be('bar');
      }).catch(done);

      queue.on('completed', function (job) {
        expect(job).to.be.ok();
        done();
      });
    });

    it('process stalled jobs when starting a queue', function (done) {
      this.timeout(12000);
      utils.newQueue('test queue stalled').then(function (queueStalled) {
        queueStalled.LOCK_RENEW_TIME = 10;
        var jobs = [
          queueStalled.add({ bar: 'baz' }),
          queueStalled.add({ bar1: 'baz1' }),
          queueStalled.add({ bar2: 'baz2' }),
          queueStalled.add({ bar3: 'baz3' })
        ];

        Promise.all(jobs).then(function () {
          var afterJobsRunning = function () {
            var stalledCallback = sandbox.spy();

            return queueStalled.close(true).then(function () {
              return new Promise(function (resolve) {
                utils.newQueue('test queue stalled').then(function (queue2) {
                  queue2.LOCK_RENEW_TIME = 100;
                  var doneAfterFour = _.after(4, function () {
                    expect(stalledCallback.calledOnce).to.be(true);
                    resolve();
                  });
                  queue2.on('completed', doneAfterFour);
                  queue2.on('stalled', stalledCallback);

                  queue2.process(function (job, jobDone2) {
                    jobDone2();
                  });
                });
              });
            }).then(done, done);
          };

          var onceRunning = _.once(afterJobsRunning);

          queueStalled.process(function () {
            onceRunning();
            return Promise.delay(150);
          });
        });
      });
    });

    it('processes jobs that were added before the queue backend started', function () {
      utils.newQueue('test queue added before').then(function (queueStalled) {
        queueStalled.LOCK_RENEW_TIME = 10;
        var jobs = [
          queueStalled.add({ bar: 'baz' }),
          queueStalled.add({ bar1: 'baz1' }),
          queueStalled.add({ bar2: 'baz2' }),
          queueStalled.add({ bar3: 'baz3' })
        ];

        return Promise.all(jobs)
          .then(queueStalled.close.bind(queueStalled))
          .then(function () {
            utils.newQueue('test queue added before').then(function (queue2) {
              queue2.process(function (job, jobDone) {
                jobDone();
              });

              return new Promise(function (resolve) {
                var resolveAfterAllJobs = _.after(jobs.length, resolve);
                queue2.on('completed', resolveAfterAllJobs);
              });
            });
          });
      });
    });

    it.skip('processes several stalled jobs when starting several queues', function (done) {
      this.timeout(50000);

      var NUM_QUEUES = 10;
      var NUM_JOBS_PER_QUEUE = 20;
      var stalledQueues = [];
      var jobs = [];

      for (var i = 0; i < NUM_QUEUES; i++) {
        var queueStalled2 = new Queue('test queue stalled 2', 6379, '127.0.0.1');
        stalledQueues.push(queueStalled2);
        queueStalled2.LOCK_RENEW_TIME = 10;

        for (var j = 0; j < NUM_JOBS_PER_QUEUE; j++) {
          jobs.push(queueStalled2.add({ job: j }));
        }
      }

      Promise.all(jobs).then(function () {
        var processed = 0;
        var procFn = function () {
          // instead of completing we just close the queue to simulate a crash.
          utils.simulateDisconnect(this);

          //return this.disconnect().then(function(){
          processed++;
          if (processed === stalledQueues.length) {
            setTimeout(function () {
              var queue2 = new Queue('test queue stalled 2', 6379, '127.0.0.1');
              queue2.process(function (job2, jobDone) {
                jobDone();
              });

              var counter = 0;
              queue2.on('completed', function () {
                counter++;
                if (counter === NUM_QUEUES * NUM_JOBS_PER_QUEUE) {
                  queue2.close().then(done);
                }
              });
            }, 100);
          }
          //});
        };

        var processes = [];
        for (var k = 0; k < stalledQueues.length; k++) {
          processes.push(stalledQueues[k].process(procFn));
        }
        return Promise.all(processes);
      });
    });

    it('does not process a job that is being processed when a new queue starts', function (done) {
      this.timeout(12000);
      var err = null;
      var anotherQueue;

      queue.on('completed', function () {
        utils.cleanupQueue(anotherQueue).then(done.bind(null, err));
      });

      queue.add({ foo: 'bar' }).then(function (addedJob) {
        queue.process(function (job, jobDone) {
          expect(job.data.foo).to.be.equal('bar');

          if (addedJob.jobId !== job.jobId) {
            err = new Error('Processed job id does not match that of added job');
          }
          setTimeout(jobDone, 500);
        });

        utils.newQueue().then(function (_anotherQueue) {
          anotherQueue = _anotherQueue;
          setTimeout(function () {
            anotherQueue.process(function (job, jobDone) {
              err = new Error('The second queue should not have received a job to process');
              jobDone();
            });
          }, 50);
        });
      });
    });

    it('process stalled jobs without requiring a queue restart', function (done) {
      this.timeout(12000);

      var queue2 = utils.buildQueue('running-stalled-job-' + uuid());

      var collect = _.after(2, function () {
        queue2.close().then(done);
      });

      queue2.LOCK_RENEW_TIME = 500;

      queue2.on('completed', function () {
        collect();
      });

      queue2.process(function (job, jobDone) {
        expect(job.data.foo).to.be.equal('bar');
        jobDone();
        var client = redis.createClient();
        client.srem(queue2.toKey('completed'), 1);
        client.lpush(queue2.toKey('active'), 1);
      });

      queue2.add({ foo: 'bar' }).then(function (job) {
        expect(job.jobId).to.be.ok();
        expect(job.data.foo).to.be('bar');
      }).catch(done);
    });

    it('process a job that fails', function (done) {
      var jobError = new Error('Job Failed');

      queue.process(function (job, jobDone) {
        expect(job.data.foo).to.be.equal('bar');
        jobDone(jobError);
      });

      queue.add({ foo: 'bar' }).then(function (job) {
        expect(job.jobId).to.be.ok();
        expect(job.data.foo).to.be('bar');
      }, function (err) {
        done(err);
      });

      queue.once('failed', function (job, err) {
        expect(job.jobId).to.be.ok();
        expect(job.data.foo).to.be('bar');
        expect(err).to.be.eql(jobError);
        done();
      });
    });

    it('process a job that throws an exception', function (done) {
      var jobError = new Error('Job Failed');

      queue.process(function (job) {
        expect(job.data.foo).to.be.equal('bar');
        throw jobError;
      });

      queue.add({ foo: 'bar' }).then(function (job) {
        expect(job.jobId).to.be.ok();
        expect(job.data.foo).to.be('bar');
      }, function (err) {
        done(err);
      });

      queue.once('failed', function (job, err) {
        expect(job.jobId).to.be.ok();
        expect(job.data.foo).to.be('bar');
        expect(err).to.be.eql(jobError);
        done();
      });
    });

    it('process a job that returns data with a circular dependency', function (done) {
      queue.on('error', function (err) {
        done(err);
      });
      queue.on('failed', function () {
        done();
      });
      queue.on('completed', function () {
        done(Error('Should not complete'));
      });
      queue.process(function () {
        var circular = {};
        circular.x = circular;
        return Promise.resolve(circular);
      });

      queue.add('foobar');
    });

    it('process a job that returns a rejected promise', function (done) {
      var jobError = new Error('Job Failed');

      queue.process(function (job) {
        expect(job.data.foo).to.be.equal('bar');
        return Promise.reject(jobError);
      });

      queue.add({ foo: 'bar' }).then(function (job) {
        expect(job.jobId).to.be.ok();
        expect(job.data.foo).to.be('bar');
      }, function (err) {
        done(err);
      });

      queue.once('failed', function (job, err) {
        expect(job.jobId).to.be.ok();
        expect(job.data.foo).to.be('bar');
        expect(err).to.be.eql(jobError);
        done();
      });
    });

    it('retry a job that fails', function (done) {
      var called = 0;
      var messages = 0;
      var failedOnce = false;

      var retryQueue = utils.buildQueue('retry-test-queue');
      var client = redis.createClient(6379, '127.0.0.1', {});

      client.select(0);

      client.on('ready', function () {
        client.on('message', function (channel, message) {
          expect(channel).to.be.equal(retryQueue.toKey('jobs'));
          expect(parseInt(message, 10)).to.be.a('number');
          messages++;
        });
        client.subscribe(retryQueue.toKey('jobs'));

        retryQueue.add({ foo: 'bar' }).then(function (job) {
          expect(job.jobId).to.be.ok();
          expect(job.data.foo).to.be('bar');
        });
      });

      retryQueue.process(function (job, jobDone) {
        called++;
        if (called % 2 !== 0) {
          throw new Error('Not even!');
        }
        jobDone();
      });

      retryQueue.once('failed', function (job, err) {
        expect(job.jobId).to.be.ok();
        expect(job.data.foo).to.be('bar');
        expect(err.message).to.be.eql('Not even!');
        failedOnce = true;
        retryQueue.retryJob(job);
      });

      retryQueue.once('completed', function () {
        expect(failedOnce).to.be(true);
        expect(messages).to.eql(2);
        retryQueue.close().then(done);
      });
    });

  });

  it('count added, unprocessed jobs', function () {
    var maxJobs = 100;
    var added = [];

    var queue = utils.buildQueue();

    for (var i = 1; i <= maxJobs; i++) {
      added.push(queue.add({ foo: 'bar', num: i }));
    }

    return Promise.all(added)
      .then(queue.count.bind(queue))
      .then(function (count) {
        expect(count).to.be(100);
      })
      .then(queue.empty.bind(queue))
      .then(queue.count.bind(queue))
      .then(function (count) {
        expect(count).to.be(0);
        return queue.close();
      });
  });

  it('emits waiting event when a job is added', function (done) {
    var queue = utils.buildQueue();
    queue.add({ foo: 'bar' });
    queue.once('waiting', function (job) {
      expect(job.data.foo).to.be.equal('bar');
      queue.close().then(done);
    });
  });

  describe('.pause', function () {
    beforeEach(function () {
      var client = redis.createClient();
      return client.flushdbAsync();
    });

    it.skip('should pause a queue until resumed', function () {
      var ispaused = false, counter = 2;

      utils.newQueue().then(function (queue) {
        var resultPromise = new Promise(function (resolve) {
          queue.process(function (job, jobDone) {
            expect(ispaused).to.be(false);
            expect(job.data.foo).to.be.equal('paused');
            jobDone();
            counter--;
            if (counter === 0) {
              resolve(queue.close());
            }
          });
        });

        return Promise.join(queue.pause().then(function () {
          ispaused = true;
          return queue.add({ foo: 'paused' });
        }).then(function () {
          return queue.add({ foo: 'paused' });
        }).then(function () {
          ispaused = false;
          queue.resume();
        }), resultPromise);
      });
    });

    it('should be able to pause a running queue and emit relevant events', function (done) {
      var ispaused = false, isresumed = true, first = true;

      utils.newQueue().then(function (queue) {
        queue.process(function (job, jobDone) {
          expect(ispaused).to.be(false);
          expect(job.data.foo).to.be.equal('paused');
          jobDone();

          if (first) {
            first = false;
            ispaused = true;
            queue.pause();
          } else {
            expect(isresumed).to.be(true);
            queue.close().then(done);
          }
        });

        queue.add({ foo: 'paused' });
        queue.add({ foo: 'paused' });

        queue.on('paused', function () {
          ispaused = false;
          queue.resume();
        });

        queue.on('resumed', function () {
          isresumed = true;
        });
      });
    });

    it('should pause the queue locally', function (testDone) {
      var counter = 2;

      var queue = utils.buildQueue();

      queue.pause(true /* Local */).then(function () {
        // Add the worker after the queue is in paused mode since the normal behavior is to pause
        // it after the current lock expires. This way, we can ensure there isn't a lock already
        // to test that pausing behavior works.
        queue.process(function (job, done) {
          expect(queue.paused).not.to.be.ok();
          done();
          counter--;
          if (counter === 0) {
            queue.close().then(testDone);
          }
        });
      }).then(function () {
        return queue.add({ foo: 'paused' });
      }).then(function () {
        return queue.add({ foo: 'paused' });
      }).then(function () {
        expect(counter).to.be(2);
        expect(queue.paused).to.be.ok(); // Parameter should exist.
        return queue.resume(true /* Local */);
      });
    });

    it('should wait until active jobs are finished before resolving pause', function (done) {
      var queue = utils.buildQueue();
      queue.process(function (job, completed) {
        setTimeout(completed, 200);
      });

      queue.on('ready', function () {
        var jobs = [];
        for (var i = 0; i < 10; i++) {
          jobs.push(queue.add(i));
        }
        Promise.all(jobs).then(function () {
          queue.pause(true).then(function () {
            var active = queue.getJobCountByTypes(['active']).then(function (count) {
              expect(count).to.be(0);
              expect(queue.paused).to.be.ok();
              return null;
            });

            // One job from the 10 posted above will be processed, so we expect 9 jobs pending
            var paused = queue.getJobCountByTypes(['wait', 'delayed']).then(function (count) {
              expect(count).to.be(9);
              return null;
            });

            return Promise.all([active, paused]);

          }).then(function () {
            return queue.add({});
          }).then(function () {
            var active = queue.getJobCountByTypes(['active']).then(function (count) {
              expect(count).to.be(0);
              return null;
            });

            var paused = queue.getJobCountByTypes(['wait', 'delayed']).then(function (count) {
              expect(count).to.be(10);
              return null;
            });

            return Promise.all([active, paused]);
          }).then(function () {
            return queue.close().then(done, done);
          });
        });
      });
    });
  });

  it('should publish a message when a new message is added to the queue', function (done) {
    var client = redis.createClient(6379, '127.0.0.1', {});
    client.select(0);
    var queue = new Queue('test pub sub');
    client.on('ready', function () {
      client.on('message', function (channel, message) {
        expect(channel).to.be.equal(queue.toKey('jobs'));
        expect(parseInt(message, 10)).to.be.a('number');
        queue.close().then(done, done);
      });
      client.subscribe(queue.toKey('jobs'));
      queue.add({ test: 'stuff' });
    });
  });

  it('should emit an event when a job becomes active', function (done) {
    var queue = utils.buildQueue();
    queue.process(function (job, jobDone) {
      jobDone();
    });
    queue.add({});
    queue.once('active', function () {
      queue.once('completed', function () {
        queue.close().then(done);
      });
    });
  });

  describe('Delayed jobs', function () {
    var queue;

    beforeEach(function () {
      var client = redis.createClient();
      return client.flushdbAsync();
    });

    it('should process a delayed job only after delayed time', function (done) {
      var delay = 500;
      queue = new Queue('delayed queue simple');
      var client = redis.createClient(6379, '127.0.0.1', {});
      var timestamp = Date.now();
      var publishHappened = false;
      client.on('ready', function () {
        client.on('message', function (channel, message) {
          expect(parseInt(message, 10)).to.be.a('number');
          publishHappened = true;
        });
        client.subscribe(queue.toKey('jobs'));
      });

      queue.process(function (job, jobDone) {
        jobDone();
      });

      queue.on('completed', function () {
        expect(Date.now() > timestamp + delay);
        queue.getWaiting().then(function (jobs) {
          expect(jobs.length).to.be.equal(0);
        }).then(function () {
          return queue.getDelayed().then(function (jobs) {
            expect(jobs.length).to.be.equal(0);
          });
        }).then(function () {
          expect(publishHappened).to.be(true);
          queue.close().then(done, done);
        });
      });

      queue.on('ready', function () {
        queue.add({ delayed: 'foobar' }, { delay: delay }).then(function (job) {
          expect(job.jobId).to.be.ok();
          expect(job.data.delayed).to.be('foobar');
          expect(job.delay).to.be(delay);
        });
      });
    });

    it('should process delayed jobs in correct order', function (done) {
      var order = 0;
      queue = new Queue('delayed queue multiple');

      queue.on('failed', function (err) {
        done(err);
      });

      queue.on('ready', function () {

        queue.process(function (job, jobDone) {
          order++;
          expect(order).to.be.equal(job.data.order);
          jobDone();
          if (order === 10) {
            queue.close().then(done, done);
          }
        });

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
    });

    it('should process delayed jobs in correct order even in case of restart', function (done) {
      this.timeout(15000);

      var QUEUE_NAME = 'delayed queue multiple' + uuid();
      var order = 1;

      queue = new Queue(QUEUE_NAME);

      var fn = function (job, jobDone) {
        expect(order).to.be.equal(job.data.order);
        jobDone();

        if (order === 4) {
          queue.close().then(done, done);
        }

        order++;
      };

      Promise.join(
        queue.add({ order: 2 }, { delay: 300 }),
        queue.add({ order: 4 }, { delay: 500 }),
        queue.add({ order: 1 }, { delay: 200 }),
        queue.add({ order: 3 }, { delay: 400 })).then(function () {
          //
          // Start processing so that jobs get into the delay set.
          //
          queue.process(fn);
        }).delay(20).then(function () {
          /*
          //We simulate a restart
          console.log('RESTART');
          return queue.close().then(function () {
            console.log('CLOSED');
            return Promise.delay(100).then(function () {
              queue = new Queue(QUEUE_NAME);
              queue.process(fn);
            });
          });
          */
        });
    });

    it('should process delayed jobs with exact same timestamps in correct order (FIFO)', function (done) {
      var client = redis.createClient(6379, '127.0.0.1', {});
      client = Promise.promisifyAll(client);
      var QUEUE_NAME = 'delayed queue multiple' + uuid();
      queue = new Queue(QUEUE_NAME);
      var order = 1;

      var fn = function (job, jobDone) {
        expect(order).to.be.equal(job.data.order);
        jobDone();

        if (order === 12) {
          queue.close().then(done, done);
        }

        order++;
      };

      queue.on('ready', function () {
        var now = Date.now();
        var _promises = [];
        var _i = 1;
        for (_i; _i <= 12; _i++) {
          _promises.push(queue.add({ order: _i }, {
            delay: 1000,
            timestamp: now
          }));
        }
        Promise.join.apply(null, _promises).then(function () {
          queue.process(fn);
        });
      });
    });
  });

  describe('Concurrency process', function () {
    var queue;

    beforeEach(function () {
      var client = redis.createClient();
      queue = utils.buildQueue();
      return client.flushdbAsync();
    });

    afterEach(function () {
      return queue.close();
    });

    it('should run job in sequence if I specify a concurrency of 1', function (done) {
      var processing = false;

      queue.process(1, function (job, jobDone) {
        expect(processing).to.be.equal(false);
        processing = true;
        Promise.delay(50).then(function () {
          processing = false;
          jobDone();
        });
      });

      queue.add({});
      queue.add({});

      queue.on('completed', _.after(2, done.bind(null, null)));
    });

    //This job use delay to check that at any time we have 4 process in parallel.
    //Due to time to get new jobs and call process, false negative can appear.
    it('should process job respecting the concurrency set', function (done) {
      var nbProcessing = 0;
      var pendingMessageToProcess = 8;
      var wait = 100;

      queue.process(4, function () {
        nbProcessing++;
        expect(nbProcessing).to.be.lessThan(5);

        wait += 100;

        return Promise.delay(wait).then(function () {
          //We should not have 4 more in parallel.
          //At the end, due to empty list, no new job will process, so nbProcessing will decrease.
          expect(nbProcessing).to.be(Math.min(pendingMessageToProcess, 4));
          pendingMessageToProcess--;
          nbProcessing--;
        });
      }).catch(done);

      queue.add();
      queue.add();
      queue.add();
      queue.add();
      queue.add();
      queue.add();
      queue.add();
      queue.add();

      queue.on('completed', _.after(8, done.bind(null, null)));
      queue.on('failed', done);
    });

    it('should wait for all concurrent processing in case of pause', function (done) {
      var i = 0;
      var nbJobFinish = 0;

      queue.process(3, function (job, jobDone) {
        var error = null;

        if (++i === 4) {
          queue.pause().then(function () {
            Promise.delay(500).then(function () { // Wait for all the active jobs to finalize.
              expect(nbJobFinish).to.be.above(3);
              queue.resume();
            });
          });
        }

        // We simulate an error of one processing job.
        // They had a bug in pause() with this special case.
        if (i % 3 === 0) {
          error = new Error();
        }

        //100 - i*20 is to force to finish job n°4 before lower job that will wait longer
        Promise.delay(100 - i * 10).then(function () {
          nbJobFinish++;
          jobDone(error);
        });
      }).catch(done);

      queue.add({});
      queue.add({});
      queue.add({});
      queue.add({});
      queue.add({});
      queue.add({});
      queue.add({});
      queue.add({});

      var cb = _.after(8, done.bind(null, null));
      queue.on('completed', cb);
      queue.on('failed', cb);
      queue.on('error', done);
    });
  });

  describe('Retries and backoffs', function () {
    var queue;

    afterEach(function () {
      return queue.close();
    });

    it('should automatically retry a failed job if attempts is bigger than 1', function (done) {
      queue = utils.buildQueue('test retries and backoffs');
      queue.on('ready', function () {

        var tries = 0;
        queue.process(function (job, jobDone) {
          tries++;
          if (job.attemptsMade < 2) {
            throw new Error('Not yet!');
          }
          expect(job.attemptsMade).to.be(tries - 1);
          jobDone();
        });

        queue.add({ foo: 'bar' }, {
          attempts: 3
        });
      });
      queue.on('completed', function () {
        done();
      });
    });

    it('should not retry a failed job more than the number of given attempts times', function (done) {
      queue = utils.buildQueue('test retries and backoffs');
      var tries = 0;
      queue.on('ready', function () {
        queue.process(function (job, jobDone) {
          tries++;
          if (job.attemptsMade < 3) {
            throw new Error('Not yet!');
          }
          expect(job.attemptsMade).to.be(tries - 1);
          jobDone();
        });

        queue.add({ foo: 'bar' }, {
          attempts: 3
        });
      });
      queue.on('completed', function () {
        done(new Error('Failed job was retried more than it should be!'));
      });
      queue.on('failed', function () {
        if (tries === 3) {
          done();
        }
      });
    });

    it('should retry a job after a delay if a fixed backoff is given', function (done) {
      this.timeout(12000);
      queue = utils.buildQueue('test retries and backoffs');
      var start;
      queue.on('ready', function () {
        queue.process(function (job, jobDone) {
          if (job.attemptsMade < 2) {
            throw new Error('Not yet!');
          }
          jobDone();
        });

        start = Date.now();
        queue.add({ foo: 'bar' }, {
          attempts: 3,
          backoff: 1000
        });
      });
      queue.on('completed', function () {
        var elapse = Date.now() - start;
        expect(elapse).to.be.greaterThan(2000);
        done();
      });
    });

    it('should retry a job after a delay if an exponential backoff is given', function (done) {
      this.timeout(12000);
      queue = utils.buildQueue('test retries and backoffs');
      var start;
      queue.on('ready', function () {
        queue.process(function (job, jobDone) {
          if (job.attemptsMade < 2) {
            throw new Error('Not yet!');
          }
          jobDone();
        });

        start = Date.now();
        queue.add({ foo: 'bar' }, {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 1000
          }
        });
      });
      queue.on('completed', function () {
        var elapse = Date.now() - start;
        var expected = 1000 * (Math.pow(2, 2) - 1);
        expect(elapse).to.be.greaterThan(expected);
        done();
      });
    });

    it('should not retry a job that has been removed', function (done) {
      queue = utils.buildQueue('retry a removed job');
      queue.on('ready', function () {
        var attempts = 0;
        queue.process(function (job, jobDone) {
          if (attempts === 0) {
            attempts++;
            throw new Error('failed');
          } else {
            jobDone();
          }
        });

        queue.add({ foo: 'bar' });
      });

      var failedHandler = _.once(function (job, err) {
        expect(job.data.foo).to.equal('bar');
        expect(err.message).to.equal('failed');

        job.retry().delay(100)
          .then(function () {
            return queue.getCompletedCount().then(function (count) {
              return expect(count).to.equal(1);
            });
          })
          .then(function () {
            return queue.clean(0).then(function () {
              return job.retry().catch(function (err) {
                expect(err.message).to.equal('Couldn\'t retry job: The job doesn\'t exist');
              });
            });
          })
          .then(function () {
            return Promise.all([
              queue.getCompletedCount().then(function (count) {
                return expect(count).to.equal(0);
              }),
              queue.getFailedCount().then(function (count) {
                return expect(count).to.equal(0);
              })
            ]);
          })
          .then(function () {
            done();
          }, done);
      });

      queue.on('failed', failedHandler);
    });

    it('should not retry a job that has been retried already', function (done) {
      queue = utils.buildQueue('retry already retried job');
      queue.on('ready', function () {
        var attempts = 0;
        queue.process(function (job, jobDone) {
          if (attempts === 0) {
            attempts++;
            throw new Error('failed');
          } else {
            jobDone();
          }
        });

        queue.add({ foo: 'bar' });
      });

      var failedHandler = _.once(function (job, err) {
        expect(job.data.foo).to.equal('bar');
        expect(err.message).to.equal('failed');

        job.retry().delay(100)
          .then(function () {
            return queue.getCompletedCount().then(function (count) {
              return expect(count).to.equal(1);
            });
          })
          .then(function () {
            return job.retry().catch(function (err) {
              expect(err.message).to.equal('Couldn\'t retry job: The job has been already retried or has not failed');
            });
          })
          .then(function () {
            return Promise.all([
              queue.getCompletedCount().then(function (count) {
                return expect(count).to.equal(1);
              }),
              queue.getFailedCount().then(function (count) {
                return expect(count).to.equal(0);
              })
            ]);
          })
          .then(function () {
            done();
          }, done);
      });

      queue.on('failed', failedHandler);
    });

    it('should not retry a job that is locked', function (done) {
      queue = utils.buildQueue('retry a locked job');
      var addedHandler = _.once(function (job) {
        expect(job.data.foo).to.equal('bar');

        job.retry().catch(function (err) {
          expect(err.message).to.equal('Couldn\'t retry job: The job has been already retried or has not failed');
          return null;
        }).then(done, done);
      });

      queue.on('ready', function () {
        queue.process(function (job, jobDone) {
          return Promise.delay(200).then(jobDone);
        });
        queue.add({ foo: 'bar' }).then(addedHandler);
      });
    });
  });

  describe.only('Jobs getters', function () {
    var queue;

    beforeEach(function () {
      queue = utils.buildQueue();
      return queue.clean(1000);
    });

    afterEach(function () {
      return queue.close();
    });

    it('should get waiting jobs', function () {
      return Promise.join(queue.add({ foo: 'bar' }), queue.add({ baz: 'qux' })).then(function () {
        return queue.getWaiting().then(function (jobs) {
          expect(jobs).to.be.a('array');
          expect(jobs.length).to.be.equal(2);
          expect(jobs[1].data.foo).to.be.equal('bar');
          expect(jobs[0].data.baz).to.be.equal('qux');
        });
      });
    });

    it('should get paused jobs', function () {
      return queue.pause().then(function () {
        return Promise.join(queue.add({ foo: 'bar' }), queue.add({ baz: 'qux' })).then(function () {
          return queue.getWaiting().then(function (jobs) {
            expect(jobs).to.be.a('array');
            expect(jobs.length).to.be.equal(2);
            expect(jobs[1].data.foo).to.be.equal('bar');
            expect(jobs[0].data.baz).to.be.equal('qux');
          });
        });
      });
    });

    it('should get active jobs', function (done) {
      queue.process(function (job, jobDone) {
        queue.getActive().then(function (jobs) {
          expect(jobs).to.be.a('array');
          expect(jobs.length).to.be.equal(1);
          expect(jobs[0].data.foo).to.be.equal('bar');
          done();
        });
        jobDone();
      });

      queue.add({ foo: 'bar' });
    });

    it('should get a specific job', function (done) {
      var data = { foo: 'sup!' };
      queue.add(data).then(function (job) {
        queue.getJob(job.jobId).then(function (returnedJob) {
          expect(returnedJob.data).to.eql(data);
          expect(returnedJob.jobId).to.be(job.jobId);
          done();
        });
      });
    });

    it('should get completed jobs', function (done) {
      var counter = 2;

      queue.process(function (job, jobDone) {
        jobDone();
      });

      queue.on('completed', function () {
        counter--;

        if (counter === 0) {
          queue.getCompleted().then(function (jobs) {
            expect(jobs).to.be.a('array');
            // We need a "empty completed" kind of function.
            //expect(jobs.length).to.be.equal(2);
            done();
          });
        }
      });

      queue.add({ foo: 'bar' });
      queue.add({ baz: 'qux' });
    });

    it('should get failed jobs', function (done) {
      var counter = 2;

      queue.process(function (job, jobDone) {
        jobDone(new Error('Forced error'));
      });

      queue.on('failed', function () {
        counter--;

        if (counter === 0) {
          queue.getFailed().then(function (jobs) {
            expect(jobs).to.be.a('array');
            done();
          });
        }
      });

      queue.add({ foo: 'bar' });
      queue.add({ baz: 'qux' });
    });

    it('fails jobs that exceed their specified timeout', function (done) {

      queue.process(function (job, jobDone) {
        setTimeout(jobDone, 150);
      });

      queue.on('failed', function (job, error) {
        expect(error).to.be.a(Promise.TimeoutError);
        done();
      });

      queue.on('completed', function () {
        var error = new Error('The job should have timed out');
        done(error);
      });

      queue.add({ some: 'data' }, {
        timeout: 100
      });
    });
  });

  describe('getJobs', function () {
    this.timeout(12000);
    var queue;

    beforeEach(function () {
      queue = utils.buildQueue();
      return queue.clean(1000);
    });

    afterEach(function () {
      return queue.close();
    });

    it('should return all completed jobs when not setting start/end', function (done) {
      queue.process(function (job, completed) {
        completed();
      });

      queue.on('completed', _.after(3, function () {
        queue.getJobs('completed', 'SET').then(function (jobs) {
          expect(jobs).to.be.an(Array);
          expect(jobs).to.have.length(3);
          done();
        }).catch(done);
      }));

      queue.add({ foo: 1 });
      queue.add({ foo: 2 });
      queue.add({ foo: 3 });
    });

    it('should return all failed jobs when not setting start/end', function (done) {
      queue.process(function (job, completed) {
        completed(new Error('error'));
      });

      queue.on('failed', _.after(3, function () {
        queue.getJobs('failed', 'SET').then(function (jobs) {
          expect(jobs).to.be.an(Array);
          expect(jobs).to.have.length(3);
          done();
        }).catch(done);
      }));

      queue.add({ foo: 1 });
      queue.add({ foo: 2 });
      queue.add({ foo: 3 });
    });

    it('should return subset of jobs when setting positive range', function (done) {
      queue.process(function (job, completed) {
        completed();
      });

      queue.on('completed', _.after(3, function () {
        queue.getJobs('completed', 'SET', 1, 2).then(function (jobs) {
          expect(jobs).to.be.an(Array);
          expect(jobs).to.have.length(2);
          expect(jobs[0].data.foo).to.be.equal(2);
          expect(jobs[1].data.foo).to.be.eql(3);
          done();
        }).catch(done);
      }));

      queue.add({ foo: 1 });
      queue.add({ foo: 2 });
      queue.add({ foo: 3 });
    });

    it('should return subset of jobs when setting a negative range', function (done) {
      queue.process(function (job, completed) {
        completed();
      });

      queue.on('completed', _.after(3, function () {
        queue.getJobs('completed', 'SET', -3, -1).then(function (jobs) {
          expect(jobs).to.be.an(Array);
          expect(jobs).to.have.length(3);
          expect(jobs[0].data.foo).to.be.equal(1);
          expect(jobs[1].data.foo).to.be.eql(2);
          expect(jobs[2].data.foo).to.be.eql(3);
          done();
        }).catch(done);
      }));

      queue.add({ foo: 1 });
      queue.add({ foo: 2 });
      queue.add({ foo: 3 });
    });

    it('should return subset of jobs when range overflows', function (done) {
      queue.process(function (job, completed) {
        completed();
      });

      queue.on('completed', _.after(3, function () {
        queue.getJobs('completed', 'SET', -300, 99999).then(function (jobs) {
          expect(jobs).to.be.an(Array);
          expect(jobs).to.have.length(3);
          expect(jobs[0].data.foo).to.be.equal(1);
          expect(jobs[1].data.foo).to.be.eql(2);
          expect(jobs[2].data.foo).to.be.eql(3);
          done();
        }).catch(done);
      }));

      queue.add({ foo: 1 });
      queue.add({ foo: 2 });
      queue.add({ foo: 3 });
    });

  });

  describe('Cleaner', function () {
    var queue;

    beforeEach(function () {
      queue = utils.buildQueue('cleaner' + uuid());
    });

    afterEach(function () {
      return queue.close();
    });

    it('should reject the cleaner with no grace', function (done) {
      queue.clean().then(function () {
        done(new Error('Promise should not resolve'));
      }, function (err) {
        expect(err).to.be.a(Error);
        done();
      });
    });

    it('should reject the cleaner an unknown type', function (done) {
      queue.clean(0, 'bad').then(function () {
        done(new Error('Promise should not resolve'));
      }, function (e) {
        expect(e).to.be.a(Error);
        done();
      });
    });

    it('should clean an empty queue', function (done) {
      queue.clean(0);
      queue.on('error', function (err) {
        done(err);
      });
      queue.on('cleaned', function (jobs, type) {
        expect(type).to.be('completed');
        expect(jobs.length).to.be(0);
        done();
      });
    });

    it('should clean two jobs from the queue', function (done) {
      queue.add({ some: 'data' });
      queue.add({ some: 'data' });
      queue.process(function (job, jobDone) {
        jobDone();
      });
      Promise.delay(100).then(function () {
        return queue.clean(0);
      }).then(function (jobs) {
        expect(jobs.length).to.be(2);
        done();
      }, function (err) {
        done(err);
      });
    });

    it('should only remove a job outside of the grace period', function (done) {
      queue.process(function (job, jobDone) {
        jobDone();
      });
      queue.add({ some: 'data' });
      queue.add({ some: 'data' });
      Promise.delay(200).then(function () {
        queue.add({ some: 'data' });
        queue.clean(100);
      }).delay(100).then(function () {
        return queue.getCompleted();
      }).then(function (jobs) {
        expect(jobs.length).to.be(1);
        return queue.empty();
      }).then(function () {
        done();
      });
    });

    it('should clean all failed jobs', function (done) {
      queue.add({ some: 'data' });
      queue.add({ some: 'data' });
      queue.process(function (job, jobDone) {
        jobDone(new Error('It failed'));
      });
      Promise.delay(100).then(function () {
        return queue.clean(0, 'failed');
      }).then(function (jobs) {
        expect(jobs.length).to.be(2);
        return queue.count();
      }).then(function (len) {
        expect(len).to.be(0);
        done();
      });
    });

    it('should clean all waiting jobs', function (done) {
      queue.add({ some: 'data' });
      queue.add({ some: 'data' });
      Promise.delay(100).then(function () {
        return queue.clean(0, 'wait');
      }).then(function (jobs) {
        expect(jobs.length).to.be(2);
        return queue.count();
      }).then(function (len) {
        expect(len).to.be(0);
        done();
      });
    });

    it('should clean all delayed jobs', function (done) {
      queue.add({ some: 'data' }, { delay: 5000 });
      queue.add({ some: 'data' }, { delay: 5000 });
      Promise.delay(100).then(function () {
        return queue.clean(0, 'delayed');
      }).then(function (jobs) {
        expect(jobs.length).to.be(2);
        return queue.count();
      }).then(function (len) {
        expect(len).to.be(0);
        done();
      });
    });

    it('should clean the number of jobs requested', function (done) {
      queue.add({ some: 'data' });
      queue.add({ some: 'data' });
      queue.add({ some: 'data' });
      Promise.delay(100).then(function () {
        return queue.clean(0, 'wait', 1);
      }).then(function (jobs) {
        expect(jobs.length).to.be(1);
        return queue.count();
      }).then(function (len) {
        expect(len).to.be(2);
        done();
      });
    });

    it('should clean a job without a timestamp', function (done) {
      var client = redis.createClient(6379, '127.0.0.1', {});

      queue.add({ some: 'data' });
      queue.add({ some: 'data' });
      queue.process(function (job, jobDone) {
        jobDone(new Error('It failed'));
      });

      Promise.delay(100).then(function () {
        return new Promise(function (resolve) {
          client.hdel('bull:' + queue.name + ':1', 'timestamp', resolve);
        });
      }).then(function () {
        return queue.clean(0, 'failed');
      }).then(function (jobs) {
        expect(jobs.length).to.be(2);
        return queue.getFailed();
      }).then(function (failed) {
        expect(failed.length).to.be(0);
        done();
      });
    });
  });
});
