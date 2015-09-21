/*eslint-env node */
/*global Promise:true */
'use strict';

var Queue = require('../');
var expect = require('expect.js');
var Promise = require('bluebird');
var redis = require('redis');
var sinon = require('sinon');
var _ = require('lodash');
var uuid = require('node-uuid');

var STD_QUEUE_NAME = 'test queue';

function buildQueue(name) {
  var qName = name || STD_QUEUE_NAME;
  return new Queue(qName, 6379, '127.0.0.1');
}

function cleanupQueue(queue) {
  return queue.empty().then(queue.close.bind(queue));
}

describe('Queue', function () {
  var queue;
  var sandbox = sinon.sandbox.create();

  afterEach(function(){
    if(queue){
      return cleanupQueue(queue).then(function () {
        queue = undefined;
      });
    }
    sandbox.restore();
  });

  describe('.close', function () {
    var testQueue;
    beforeEach(function (done) {
      testQueue = new Queue('test');
      testQueue.once('ready', done);
    });

    it('should call end on the client', function () {
      var endSpy = sandbox.spy(testQueue.client, 'end');
      return testQueue.close().then(function () {
        expect(endSpy.calledOnce).to.be(true);
      });
    });

    it('should call end on the blocking client', function () {
      var endSpy = sandbox.spy(testQueue.bclient, 'end');
      return testQueue.close().then(function () {
        expect(endSpy.calledOnce).to.be(true);
      });
    });

    it('should call end on the event subscriber client', function () {
      var endSpy = sandbox.spy(testQueue.eclient, 'end');
      return testQueue.close().then(function () {
        expect(endSpy.calledOnce).to.be(true);
      });
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

    describe('should be callable from within', function () {
      it('a job handler that takes a callback', function (done) {
        this.timeout(6000);

        var closeQueue = new Queue('close from handler');

        closeQueue.process(function (job, jobDone) {
          expect(job.data.foo).to.be('bar');
          closeQueue.close().then(function () { done(); });
          jobDone();
        });

        closeQueue.add({ foo: 'bar' }).then(function (job) {
          expect(job.jobId).to.be.ok();
          expect(job.data.foo).to.be('bar');
        });
      });

      it('a job handler that returns a promise', function (done) {
        this.timeout(6000);

        var closeQueue = new Queue('close from handler');

        closeQueue.process(function (job) {
          expect(job.data.foo).to.be('bar');
          closeQueue.close().then(function () { done(); });
          return Promise.resolve();
        });

        closeQueue.add({ foo: 'bar' }).then(function (job) {
          expect(job.jobId).to.be.ok();
          expect(job.data.foo).to.be('bar');
        });
      });
    });
  });

  describe('instantiation', function () {
    it('should create a queue with standard redis opts', function (done) {
      queue = new Queue('standard');

      queue.once('ready', function () {
        expect(queue.client.connectionOption.host).to.be('127.0.0.1');
        expect(queue.bclient.connectionOption.host).to.be('127.0.0.1');

        expect(queue.client.connectionOption.port).to.be(6379);
        expect(queue.bclient.connectionOption.port).to.be(6379);

        expect(queue.client.selected_db).to.be(0);
        expect(queue.bclient.selected_db).to.be(0);

        done();
      });
    });

    it('creates a queue using the supplied redis DB', function (done) {
      queue = new Queue('custom', { redis: { DB: 1 } });

      queue.once('ready', function () {
        expect(queue.client.connectionOption.host).to.be('127.0.0.1');
        expect(queue.bclient.connectionOption.host).to.be('127.0.0.1');

        expect(queue.client.connectionOption.port).to.be(6379);
        expect(queue.bclient.connectionOption.port).to.be(6379);

        expect(queue.client.selected_db).to.be(1);
        expect(queue.bclient.selected_db).to.be(1);

        done();
      });
    });

    it('creates a queue using custom the supplied redis host', function (done) {
      queue = new Queue('custom', { redis: { host: 'localhost' } });

      queue.once('ready', function () {
        expect(queue.client.connectionOption.host).to.be('localhost');
        expect(queue.bclient.connectionOption.host).to.be('localhost');

        expect(queue.client.selected_db).to.be(0);
        expect(queue.bclient.selected_db).to.be(0);
        done();
      });
    });

    it('creates a queue with dots in its name', function () {
      queue = new Queue('using. dots. in.name.');

      return queue.add({ foo: 'bar' }).then(function (job) {
        expect(job.jobId).to.be.ok();
        expect(job.data.foo).to.be('bar');
      }).then(function () {
        queue.process(function (job, jobDone) {
          expect(job.data.foo).to.be.equal('bar');
          jobDone();
        });
      });
    });
  });

  describe('connection', function () {
    it('should recover from a connection loss', function (done) {
      queue = new Queue('test connection loss');
      queue.on('error', function () {
        // error event has to be observed or the exception will bubble up
      }).process(function (job, jobDone) {
        expect(job.data.foo).to.be.equal('bar');
        jobDone();
        done();
      });

      // Simulate disconnect
      queue.bclient.stream.end();
      queue.bclient.emit('error', new Error('ECONNRESET'));

      // add something to the queue
      queue.add({ 'foo': 'bar' });
    });

    it('should reconnect when the blocking client triggers an "end" event', function (done) {
      queue = buildQueue();

      var runSpy = sandbox.spy(queue, 'run');
      queue.process(function (job, jobDone) {
        expect(runSpy.callCount).to.be(2);
        jobDone();
        done();
      });

      expect(runSpy.callCount).to.be(1);

      queue.add({ 'foo': 'bar' });
      queue.bclient.emit('end');
    });

    it('should not try to reconnect when the blocking client triggers an "end" event and no process have been called', function (done) {
      queue = buildQueue();

      var runSpy = sandbox.spy(queue, 'run');

      queue.bclient.emit('end');

      setTimeout(function () {
        expect(runSpy.callCount).to.be(0);
        done();
      }, 100);
    });
  });

  describe(' a worker', function () {
    it('should process a job', function (done) {
      queue = buildQueue();
      queue.process(function (job, jobDone) {
        expect(job.data.foo).to.be.equal('bar');
        jobDone();
        done();
      });

      queue.add({ foo: 'bar' }).then(function (job) {
        expect(job.jobId).to.be.ok();
        expect(job.data.foo).to.be('bar');
      }).catch(done);
    });

    it('process a job that updates progress', function (done) {
      queue = buildQueue();
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
      queue = buildQueue();
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
      queue = buildQueue();
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
      queue = buildQueue();
      queue.process(function (job) {
        expect(job.data.foo).to.be.equal('bar');
        return Promise.delay(250).then(function(){
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
      queue = buildQueue();
      queue.process(function (job) {
        expect(job.data.foo).to.be.equal('bar');
        return Promise.delay(42, 250);
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
      queue = buildQueue();
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
      var queueStalled = new Queue('test queue stalled', 6379, '127.0.0.1');
      queueStalled.LOCK_RENEW_TIME = 10;
      var jobs = [
        queueStalled.add({ bar: 'baz' }),
        queueStalled.add({ bar1: 'baz1' }),
        queueStalled.add({ bar2: 'baz2' }),
        queueStalled.add({ bar3: 'baz3' })
      ];

      Promise.all(jobs).then(function () {
        queueStalled.process(function () {
          // instead of completing we just close the queue to simulate a crash.
          queueStalled.disconnect();
          setTimeout(function () {
            var queue2 = new Queue('test queue stalled', 6379, '127.0.0.1');
            var doneAfterFour = _.after(4, function () {
              done();
            });
            queue2.on('completed', doneAfterFour);

            queue2.process(function (job, jobDone) {
              jobDone();
            });
          }, 100);
        });
      });
    });

    it('processes jobs that were added before the queue backend started', function () {
      var queueStalled = new Queue('test queue added before', 6379, '127.0.0.1');
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
        queue = new Queue('test queue added before', 6379, '127.0.0.1');
        queue.process(function (job, jobDone) {
          jobDone();
        });

        return new Promise(function (resolve) {
          var resolveAfterAllJobs = _.after(jobs.length, resolve);
          queue.on('completed', resolveAfterAllJobs);
        });
      });
    });

    it('processes several stalled jobs when starting several queues', function (done) {
      this.timeout(5000);

      var NUM_QUEUES = 10;
      var NUM_JOBS_PER_QUEUE = 20;
      var stalledQueues = [];
      var jobs = [];

      for(var i = 0; i < NUM_QUEUES; i++) {
        var queueStalled2 = new Queue('test queue stalled 2', 6379, '127.0.0.1');
        stalledQueues.push(queueStalled2);
        queueStalled2.LOCK_RENEW_TIME = 10;

        for(var j = 0; j < NUM_JOBS_PER_QUEUE; j++) {
          jobs.push(queueStalled2.add({ job: j }));
        }
      }

      Promise.all(jobs).then(function () {
        var processed = 0;
        var procFn = function () {
          // instead of completing we just close the queue to simulate a crash.
          this.disconnect();

          processed++;
          if(processed === stalledQueues.length) {
            setTimeout(function () {
              var queue2 = new Queue('test queue stalled 2', 6379, '127.0.0.1');
              queue2.process(function (job2, jobDone) {
                jobDone();
              });

              var counter = 0;
              queue2.on('completed', function () {
                counter++;
                if(counter === NUM_QUEUES * NUM_JOBS_PER_QUEUE) {
                  queue2.close().then(function () {
                    done();
                  });
                }
              });
            }, 100);
          }
        };

        for(var k = 0; k < stalledQueues.length; k++) {
          stalledQueues[k].process(procFn);
        }
      });
    });

    it('does not process a job that is being processed when a new queue starts', function (done) {
      this.timeout(5000);
      var err = null;
      var anotherQueue;

      queue = buildQueue();

      queue.add({ foo: 'bar' }).then(function (addedJob) {
        queue.process(function (job, jobDone) {
          expect(job.data.foo).to.be.equal('bar');

          if(addedJob.jobId !== job.jobId) {
            err = new Error('Processed job id does not match that of added job');
          }
          setTimeout(jobDone, 100);
        });
        setTimeout(function () {
          anotherQueue = buildQueue();
          anotherQueue.process(function (job, jobDone) {
            err = new Error('The second queue should not have received a job to process');
            jobDone();
          });

          queue.on('completed', function () {
            cleanupQueue(anotherQueue).then(done.bind(null, err));
          });
        }, 10);
      });
    });

    it('process stalled jobs without requiring a queue restart', function (done) {
      this.timeout(5000);
      var collect = _.after(2, done);

      queue = buildQueue('running-stalled-job-' + uuid());

      queue.LOCK_RENEW_TIME = 1000;

      queue.on('completed', function () {
        collect();
      });

      queue.process(function (job, jobDone) {
        expect(job.data.foo).to.be.equal('bar');
        jobDone();
        var client = redis.createClient();
        client.srem(queue.toKey('completed'), 1);
        client.lpush(queue.toKey('active'), 1);
      });

      queue.add({ foo: 'bar' }).then(function (job) {
        expect(job.jobId).to.be.ok();
        expect(job.data.foo).to.be('bar');
      }).catch(done);
    });

    it('process a job that fails', function (done) {
      var jobError = new Error('Job Failed');
      queue = buildQueue();

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

      queue = buildQueue();

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

    it('process a job that returns a rejected promise', function (done) {
      var jobError = new Error('Job Failed');
      queue = buildQueue();

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

      var retryQueue = buildQueue('retry-test-queue');
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
        if(called % 2 !== 0) {
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
        done();
      });
    });

    it('process several jobs serially', function (done) {
      var counter = 1;
      var maxJobs = 100;

      queue = buildQueue();

      queue.process(function (job, jobDone) {
        expect(job.data.num).to.be.equal(counter);
        expect(job.data.foo).to.be.equal('bar');
        jobDone();
        if(counter === maxJobs) {
          done();
        }
        counter++;
      });

      for(var i = 1; i <= maxJobs; i++) {
        queue.add({ foo: 'bar', num: i });
      }
    });

    it('process a lifo queue', function (done) {
      var currentValue = 0, first = true;
      queue = new Queue('test lifo');

      queue.once('ready', function () {
        queue.process(function (job, jobDone) {
          // Catching the job before the pause
          if(first) {
            expect(job.data.count).to.be.equal(0);
            first = false;
            return jobDone();
          }
          expect(job.data.count).to.be.equal(currentValue--);
          jobDone();
          if(currentValue === 0) {
            done();
          }
        });

        // Add a job to pend proccessing
        queue.add({ 'count': 0 }).then(function () {
          queue.pause().then(function () {
            // Add a series of jobs in a predictable order
            var fn = function (cb) {
              queue.add({ 'count': ++currentValue }, { 'lifo': true }).then(cb);
            };
            fn(fn(fn(fn(function () {
              queue.resume();
            }))));
          });
        });
      });
    });
  });

  it('count added, unprocessed jobs', function () {
    var maxJobs = 100;
    var added = [];

    queue = buildQueue();

    for(var i = 1; i <= maxJobs; i++) {
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
    });
  });

  it('emits waiting event when a job is added', function (cb) {
    queue = buildQueue();
    queue.add({ foo: 'bar' });
    queue.once('waiting', function (job) {
      expect(job.data.foo).to.be.equal('bar');
      cb();
    });
  });

  describe('.pause', function () {
    it('should pause a queue until resumed', function () {
      var ispaused = false, counter = 2;

      queue = buildQueue();

      var resultPromise = new Promise(function (resolve) {
        queue.process(function (job, jobDone) {
          expect(ispaused).to.be(false);
          expect(job.data.foo).to.be.equal('paused');
          jobDone();
          counter--;
          if(counter === 0) {
            resolve();
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

    it('should be able to pause a running queue and emit relevant events', function (done) {
      var ispaused = false, isresumed = true, first = true;

      queue = buildQueue();

      queue.empty().then(function () {
        queue.process(function (job, jobDone) {
          expect(ispaused).to.be(false);
          expect(job.data.foo).to.be.equal('paused');
          jobDone();

          if(first) {
            first = false;
            ispaused = true;
            queue.pause();
          }else{
            expect(isresumed).to.be(true);
            done();
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

  });

  it('should publish a message when a new message is added to the queue', function (done) {
    var client = redis.createClient(6379, '127.0.0.1', {});
    client.select(0);
    queue = new Queue('test pub sub');
    client.on('ready', function () {
      client.on('message', function (channel, message) {
        expect(channel).to.be.equal(queue.toKey('jobs'));
        expect(parseInt(message, 10)).to.be.a('number');
        done();
      });
      client.subscribe(queue.toKey('jobs'));
      queue.add({ test: 'stuff' });
    });
  });

  it('should emit an event when a job becomes active', function (done) {
    queue = buildQueue();
    queue.process(function (job, jobDone) {
      jobDone();
    });
    queue.add({});
    queue.once('active', function () {
      queue.once('completed', function () {
        done();
      });
    });
  });

  describe('Delayed jobs', function () {
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
          done();
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

      queue.on('ready', function() {

        queue.process(function (job, jobDone) {
          expect(order).to.be.below(job.data.order);
          order = job.data.order;

          jobDone();
          if(order === 10) {
            done();
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
      this.timeout(5000);

      var QUEUE_NAME = 'delayed queue multiple' + uuid();
      var order = 1;

      queue = new Queue(QUEUE_NAME);

      var fn = function (job, jobDone) {
        expect(order).to.be.equal(job.data.order);
        jobDone();

        if(order === 4) {
          done();
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
          //We simulate a restart
          return queue.close().then(function () {
            return Promise.delay(100).then(function () {
              queue = new Queue(QUEUE_NAME);
              queue.process(fn);
            });
          });
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

        if(order === 12) {
          done();
        }

        order++;
      };

      queue.on('ready', function() {
        var now = Date.now();
        var _promises = [];
        var _i = 1;
        for(_i; _i <= 12; _i++){
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
    it('should run job in sequence if I specify a concurrency of 1', function (done) {
      queue = buildQueue();

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
      queue = buildQueue('test concurrency');
      queue.empty().then(function () {
        var nbProcessing = 0;
        var pendingMessageToProcess = 8;
        var wait = 100;

        queue.process(4, function (job, jobDone) {
          nbProcessing++;
          expect(nbProcessing).to.be.lessThan(5);

          wait += 20;

          Promise.delay(wait).then(function () {
            //We should not have 4 more in parallel.
            //At the end, due to empty list, no new job will process, so nbProcessing will decrease.
            expect(nbProcessing).to.be(Math.min(pendingMessageToProcess, 4));

            pendingMessageToProcess--;
            nbProcessing--;
            jobDone();
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
    });

    it('should wait for all concurrent processing in case of pause', function (done) {
      queue = buildQueue();

      var i = 0;
      var nbJobFinish = 0;

      queue.process(3, function (job, jobDone) {
        var error = null;

        if(++i === 4){
          queue.pause().then(function () {
            Promise.delay(500).then(function () { // Wait for all the active jobs to finalize.
              expect(nbJobFinish).to.be.above(3);
              queue.resume();
            });
          });
        }

        // We simulate an error of one processing job.
        // They had a bug in pause() with this special case.
        if(i % 3 === 0){
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

  describe('Retries and backoffs', function() {

    it('should automatically retry a failed job if attempts is bigger than 1', function(done) {
      queue = buildQueue('test retries and backoffs');
      queue.on('ready', function() {

        var tries = 0;
        queue.process(function (job, jobDone) {
          tries++;
          if(job.attemptsMade < 2){
            throw new Error('Not yet!');
          }
          expect(job.attemptsMade).to.be(tries - 1);
          jobDone();
        });

        queue.add({ foo: 'bar' }, {
          attempts: 3
        });
      });
      queue.on('completed', function() {
        done();
      });
    });

    it('should not retry a failed job more than the number of given attempts times', function(done) {
      queue = buildQueue('test retries and backoffs');
      var tries = 0;
      queue.on('ready', function() {
        queue.process(function (job, jobDone) {
          tries++;
          if(job.attemptsMade < 3){
            throw new Error('Not yet!');
          }
          expect(job.attemptsMade).to.be(tries - 1);
          jobDone();
        });

        queue.add({ foo: 'bar' }, {
          attempts: 3
        });
      });
      queue.on('completed', function() {
        done(new Error('Failed job was retried more than it should be!'));
      });
      queue.on('failed', function() {
        if(tries === 3){
          done();
        }
      });
    });

    it('should retry a job after a delay if a fixed backoff is given', function(done) {
      this.timeout(5000);
      queue = buildQueue('test retries and backoffs');
      var start;
      queue.on('ready', function() {
        queue.process(function (job, jobDone) {
          if(job.attemptsMade < 2){
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
      queue.on('completed', function() {
        var elapse = Date.now() - start;
        expect(elapse).to.be.greaterThan(2000);
        done();
      });
    });

    it('should retry a job after a delay if an exponential backoff is given', function(done) {
      this.timeout(5000);
      queue = buildQueue('test retries and backoffs');
      var start;
      queue.on('ready', function() {
        queue.process(function (job, jobDone) {
          if(job.attemptsMade < 2){
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
      queue.on('completed', function() {
        var elapse = Date.now() - start;
        var expected = 1000 * (Math.pow(2, 2) - 1);
        expect(elapse).to.be.greaterThan(expected);
        done();
      });
    });

  });

  describe('Jobs getters', function () {
    it('should get waitting jobs', function (done) {
      queue = buildQueue();
      Promise.join(queue.add({ foo: 'bar' }), queue.add({ baz: 'qux' })).then(function () {
        queue.getWaiting().then(function (jobs) {
          expect(jobs).to.be.a('array');
          expect(jobs.length).to.be.equal(2);
          expect(jobs[1].data.foo).to.be.equal('bar');
          expect(jobs[0].data.baz).to.be.equal('qux');
          done();
        });
      });
    });

    it('should get active jobs', function (done) {
      queue = buildQueue();
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

      queue = buildQueue();
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

      queue = buildQueue();
      queue.process(function (job, jobDone) {
        jobDone();
      });

      queue.on('completed', function () {
        counter--;

        if(counter === 0){
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

      queue = buildQueue();

      queue.process(function (job, jobDone) {
        jobDone(new Error('Forced error'));
      });

      queue.on('failed', function () {
        counter--;

        if(counter === 0){
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
      queue = buildQueue();

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

  describe('Cleaner', function () {
    beforeEach(function () {
      queue = buildQueue('cleaner' + uuid());
    });

    it('should reject the cleaner with no grace', function(done){
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
      queue.add({some: 'data'});
      queue.add({some: 'data'});
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
      queue.add({some: 'data'});
      queue.add({some: 'data'});
      Promise.delay(200).then(function () {
        queue.add({some: 'data'});
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
      queue.add({some: 'data'});
      queue.add({some: 'data'});
      queue.process(function (job, jobDone) {
        jobDone(new Error('It failed'));
      });
      Promise.delay(100).then(function () {
        return queue.clean(0, 'failed');
      }).then(function (jobs) {
        expect(jobs.length).to.be(2);
        return queue.count();
      }).then(function(len) {
        expect(len).to.be(0);
        done();
      });
    });

    it('should clean a job without a timestamp', function (done) {
      var client = redis.createClient(6379, '127.0.0.1', {});

      queue.add({some: 'data'});
      queue.add({some: 'data'});
      queue.process(function (job, jobDone) {
        jobDone(new Error('It failed'));
      });

      Promise.delay(100).then(function () {
        return new Promise(function(resolve) {
          client.hdel('bull:' + queue.name + ':1', 'timestamp', resolve);
        });
      }).then(function() {
        return queue.clean(0, 'failed');
      }).then(function (jobs) {
        expect(jobs.length).to.be(2);
        return queue.getFailed();
      }).then(function(failed) {
        expect(failed.length).to.be(0);
        done();
      });
    });
  });
});
