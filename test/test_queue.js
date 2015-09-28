/*eslint-env node */
/*global Promise:true */
'use strict';

var expect = require('expect.js');
var Promise = require('bluebird');
var Redis = require('ioredis');
var sinon = require('sinon');
var _ = require('lodash');
var uuid = require('node-uuid');
var helper = require('./helper');

var prefix = 'bull-test-queue';

describe('Queue', function () {
  this.timeout(60000);
  var sandbox = sinon.sandbox.create();

  before(function(done){
    helper.removeTestKeys(prefix).then(function() {
      done();
    });
  });

  afterEach(function(done){
    helper.removeTestKeys(prefix).then(function() {
      sandbox.restore();
      done();
    });
  });

  after(function(done){
    helper.removeTestKeys(prefix).then(function() {
      done();
    });
  });

  describe('.close', function () {
    var testQueue;
    beforeEach(function (done) {
      testQueue = helper.buildQueue('test');
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
      expect(testQueue.client.status).to.be('ready');
      expect(testQueue.bclient.status).to.be('ready');
      expect(testQueue.eclient.status).to.be('ready');

      return testQueue.close().then(function () {
        expect(testQueue.client.status).to.be('end');
        expect(testQueue.bclient.status).to.be('end');
        expect(testQueue.eclient.status).to.be('end');
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
        var closeQueue = helper.buildQueue('close from handler');

        closeQueue.process(function (job, jobDone) {
          expect(job.data.foo).to.be('bar');
          closeQueue.close().then(function (){
            done();
          }).catch(done);
          jobDone();
        });

        closeQueue.add({ foo: 'bar' }).then(function (job) {
          expect(job.jobId).to.be.ok();
          expect(job.data.foo).to.be('bar');
        }).catch(done);
      });

      it('a job handler that returns a promise', function (done) {
        var closeQueue = helper.buildQueue('close from handler');

        closeQueue.process(function (job) {
          expect(job.data.foo).to.be('bar');
          closeQueue.close().then(function (){
            done();
          }).catch(done);
          return Promise.resolve();
        });

        closeQueue.add({ foo: 'bar' }).then(function (job) {
          expect(job.jobId).to.be.ok();
          expect(job.data.foo).to.be('bar');
        }).catch(done);
      });
    });
  });

  describe('instantiation', function () {
    it('should create a queue with standard redis opts', function (done) {
      var queue = helper.buildQueue('standard');

      queue.once('ready', function () {
        expect(queue.client.options.host).to.be('127.0.0.1');
        expect(queue.bclient.options.host).to.be('127.0.0.1');

        expect(queue.client.options.port).to.be(6379);
        expect(queue.bclient.options.port).to.be(6379);

        expect(queue.client.options.db).to.be(0);
        expect(queue.bclient.options.db).to.be(0);

        done();
      });
    });

    it('creates a queue using the supplied redis DB', function (done) {
      var queue = helper.buildQueue('custom', { db: 1, prefix: 'bull-yo' });

      queue.once('ready', function () {
        expect(queue.client.options.host).to.be('127.0.0.1');
        expect(queue.bclient.options.host).to.be('127.0.0.1');

        expect(queue.client.options.port).to.be(6379);
        expect(queue.bclient.options.port).to.be(6379);

        expect(queue.client.options.db).to.be(1);
        expect(queue.bclient.options.db).to.be(1);

        expect(queue.bclient.options.keyPrefix).to.be('');
        expect(queue.prefix).to.be('bull-yo');

        done();
      });
    });

    it('creates a queue using custom the supplied redis host', function (done) {
      var queue = helper.buildQueue('custom', { host: 'localhost' });

      queue.once('ready', function () {
        expect(queue.client.options.host).to.be('localhost');
        expect(queue.bclient.options.host).to.be('localhost');

        expect(queue.client.options.db).to.be(0);
        expect(queue.bclient.options.db).to.be(0);
        done();
      });
    });

    it('creates a queue with dots in its name', function (done) {
      var queue = helper.buildQueue('using. dots. in.name.');

      return queue.add({ foo: 'bar' }).then(function (job) {
        expect(job.jobId).to.be.ok();
        expect(job.data.foo).to.be('bar');
      }).then(function () {
        queue.process(function (job, jobDone) {
          expect(job.data.foo).to.be.equal('bar');
          jobDone();
          done();
        });
      }).catch(done);
    });
  });

  describe('connection', function () {
    it('should recover from a connection loss', function (done) {
      var queue = helper.buildQueue('test connection loss');
      queue.on('error', function () {
        // error event has to be observed or the exception will bubble up
      }).process(function (job, jobDone) {
        expect(job.data.foo).to.be.equal('bar');
        jobDone();
        done();
      });

      queue.bclient.once('ready', function() {
        // Simulate disconnect
        queue.bclient.stream.end();
        queue.bclient.emit('error', new Error('ECONNRESET'));

        // add something to the queue
        queue.add({ 'foo': 'bar' });
      });
    });

    it('should reconnect when the blocking client triggers an "end" event', function (done) {
      var queue = helper.buildQueue();

      var runSpy = sandbox.spy(queue, 'run');
      queue.process(function (job, jobDone) {
        expect(runSpy.callCount).to.be(2);
        jobDone();
        done();
      });

      expect(runSpy.callCount).to.be(1);

      queue.add({ 'foo': 'bar' }).catch(done);
      queue.bclient.emit('end');
    });

    it('should not try to reconnect when the blocking client triggers an "end" event and no process have been called', function (done) {
      var queue = helper.buildQueue();

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
      var queue = helper.buildQueue();
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
      var queue = helper.buildQueue();
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
      var queue = helper.buildQueue();
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
        done();
      });
    });

    it('process a job that returns a promise', function (done) {
      var queue = helper.buildQueue();
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
      var queue = helper.buildQueue();
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
      var queue = helper.buildQueue();
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
      var queueStalled = helper.buildQueue('test queue stalled');
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
          queueStalled.disconnect().then(function() {
            var queue2 = helper.buildQueue('test queue stalled');
            var doneAfterFour = _.after(4, function () {
              done();
            });
            queue2.on('completed', doneAfterFour);

            queue2.process(function (job, jobDone) {
              jobDone();
            });
          });
        });
      });
    });

    it('processes jobs that were added before the queue backend started', function () {
      var queueStalled = helper.buildQueue('test queue added before');
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
          var queue = helper.buildQueue('test queue added before');
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
      var NUM_QUEUES = 10;
      var NUM_JOBS_PER_QUEUE = 20;
      var stalledQueues = [];
      var jobs = [];

      for(var i = 0; i < NUM_QUEUES; i++) {
        var queueStalled2 = helper.buildQueue('test queue stalled 2');
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
              var queue2 = helper.buildQueue('test queue stalled 2');
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
      var err = null;
      var anotherQueue;
      var queue = helper.buildQueue();

      queue.add({ foo: 'bar' }).then(function (addedJob) {
        queue.process(function (job, jobDone) {
          expect(job.data.foo).to.be.equal('bar');

          if(addedJob.jobId !== job.jobId) {
            err = new Error('Processed job id does not match that of added job');
          }
          setTimeout(jobDone, 100);
        });
        setTimeout(function () {
          anotherQueue = helper.buildQueue();
          anotherQueue.process(function (job, jobDone) {
            err = new Error('The second queue should not have received a job to process');
            jobDone();
          });

          queue.on('completed', function () {
            helper.cleanupQueue(anotherQueue, prefix).then(done.bind(null, err));
          });
        }, 10);
      });
    });

    it('process stalled jobs without requiring a queue restart', function (done) {
      var collect = _.after(2, done);
      var queue = helper.buildQueue('running-stalled-job-' + uuid());

      queue.LOCK_RENEW_TIME = 1000;

      queue.on('completed', function () {
        collect();
      });

      queue.process(function (job, jobDone) {
        expect(job.data.foo).to.be.equal('bar');
        jobDone();
        var client = new Redis();
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
      var queue = helper.buildQueue();

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
      var queue = helper.buildQueue();

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
      var queue = helper.buildQueue();

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

      var retryQueue = helper.buildQueue('retry-test-queue');
      var client = new Redis();

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
      var queue = helper.buildQueue();

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
      var queue = helper.buildQueue('test lifo');

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
    var queue = helper.buildQueue();

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

  it('emits waiting event when a job is added', function (done) {
    var queue = helper.buildQueue();
    queue.add({ foo: 'bar' });
    queue.once('waiting', function (job) {
      expect(job.data.foo).to.be.equal('bar');
      done();
    });
  });

  describe('.pause', function () {
    it('should pause a queue until resumed', function () {
      var ispaused = false, counter = 2;
      var queue = helper.buildQueue();

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
      var queue = helper.buildQueue();

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
    var client = new Redis();
    client.select(0);
    var queue = helper.buildQueue('test pub sub');
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
    var queue = helper.buildQueue();
    queue.process(function (job, jobDone) {
      jobDone();
    });
    queue.add({}).catch(done);
    queue.once('active', function () {
      queue.once('completed', function () {
        done();
      });
    });
  });

  describe('Delayed jobs', function () {
    it('should process a delayed job only after delayed time', function (done) {
      var delay = 500;
      var queue = helper.buildQueue('delayed queue simple');
      var client = new Redis();
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
          return queue.getDelayed();
        }).then(function (jobs) {
          expect(jobs.length).to.be.equal(0);
          expect(publishHappened).to.be(true);
          done();
        }).catch(done);
      });

      queue.on('ready', function () {
        queue.add({ delayed: 'foobar' }, { delay: delay }).then(function (job) {
          expect(job.jobId).to.be.ok();
          expect(job.data.delayed).to.be('foobar');
          expect(job.delay).to.be(delay);
        }).catch(done);
      });
    });

    it('should process delayed jobs in correct order', function (done) {
      var order = 0;
      var queue = helper.buildQueue('delayed queue multiple');

      queue.process(function (job, jobDone) {
        expect(order).to.be.below(job.data.order);
        order = job.data.order;

        jobDone();
        if(order === 10) {
          done();
        }
      });

      queue.add({ order: 1 }, { delay: 100 }).catch(done);
      queue.add({ order: 6 }, { delay: 600 }).catch(done);
      queue.add({ order: 10 }, { delay: 1000 }).catch(done);
      queue.add({ order: 2 }, { delay: 200 }).catch(done);
      queue.add({ order: 9 }, { delay: 900 }).catch(done);
      queue.add({ order: 5 }, { delay: 500 }).catch(done);
      queue.add({ order: 3 }, { delay: 300 }).catch(done);
      queue.add({ order: 7 }, { delay: 700 }).catch(done);
      queue.add({ order: 4 }, { delay: 400 }).catch(done);
      queue.add({ order: 8 }, { delay: 800 }).catch(done);
    });

    //FIXME this is a tricky test. This doesn't pass all the time.
    it('should process delayed jobs in correct order even in case of restart', function (done) {
      var QUEUE_NAME = 'delayed queue multiple' + uuid();
      var order = 1;
      var queue = helper.buildQueue(QUEUE_NAME);

      var fn = function (job, jobDone) {
        expect(order).to.be.equal(job.data.order);

        if(order === 4) {
          done();
        }
        order += 1;
        jobDone();
      };

      Promise.join(
        queue.add({ order: 2 }, { delay: 1300 }),
        queue.add({ order: 4 }, { delay: 1500 }),
        queue.add({ order: 1 }, { delay: 1200 }),
        queue.add({ order: 3 }, { delay: 1400 })).then(function () {
          //
          // Start processing so that jobs get into the delay set.
          //
          queue.process(fn);
        }).delay(20).then(function () {
          //We simulate a restart
          return queue.close();
        }).delay(100).then(function () {
          helper.buildQueue(QUEUE_NAME).process(fn);
        });
    });
  });

  describe('Concurrency process', function () {
    it('should run job in sequence if I specify a concurrency of 1', function (done) {
      var queue = helper.buildQueue();
      var processing = false;

      queue.process(1, function (job, jobDone) {
        expect(processing).to.be.equal(false);
        processing = true;
        Promise.delay(50).then(function () {
          processing = false;
          jobDone();
        });
      });

      queue.add({}).catch(done);
      queue.add({}).catch(done);

      queue.on('completed', _.after(2, done.bind(null, null)));
    });


    //This job use delay to check that at any time we have 4 process in parallel.
    //Due to time to get new jobs and call process, false negative can appear.
    it('should process job respecting the concurrency set', function (done) {
      var queue = helper.buildQueue('test concurrency');
      queue.empty().then(function () {
        var nbProcessing = 0;
        var pendingMessageToProcess = 8;
        var wait = 100;

        queue.process(4, function (job, jobDone) {
          nbProcessing += 1;
          expect(nbProcessing).to.be.lessThan(5);

          wait += 20;

          Promise.delay(wait).then(function () {
            //We should not have 4 more in parallel.
            //At the end, due to empty list, no new job will process, so nbProcessing will decrease.
            //FIXME parallel processes are somehow less than four for me.
            expect(nbProcessing).to.be.below(Math.min(pendingMessageToProcess, 4) + 1);

            pendingMessageToProcess--;
            nbProcessing--;
            jobDone();
          });
        });

        queue.add().catch(done);
        queue.add().catch(done);
        queue.add().catch(done);
        queue.add().catch(done);
        queue.add().catch(done);
        queue.add().catch(done);
        queue.add().catch(done);
        queue.add().catch(done);

        queue.on('completed', _.after(8, done.bind(null, null)));
        queue.on('failed', done);
      });
    });

    it('should wait for all concurrent processing in case of pause', function (done) {
      var queue = helper.buildQueue();
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

      queue.add({}).catch(done);
      queue.add({}).catch(done);
      queue.add({}).catch(done);
      queue.add({}).catch(done);
      queue.add({}).catch(done);
      queue.add({}).catch(done);
      queue.add({}).catch(done);
      queue.add({}).catch(done);

      var cb = _.after(8, done.bind(null, null));
      queue.on('completed', cb);
      queue.on('failed', cb);
      queue.on('error', done);
    });
  });

  describe('Jobs getters', function () {
    it('should get waitting jobs', function (done) {
      var queue = helper.buildQueue();
      Promise.join(queue.add({ foo: 'bar' }), queue.add({ baz: 'qux' })).then(function () {
        queue.getWaiting().then(function (jobs) {
          expect(jobs).to.be.a('array');
          expect(jobs.length).to.be.equal(2);
          expect(jobs[1].data.foo).to.be.equal('bar');
          expect(jobs[0].data.baz).to.be.equal('qux');
          done();
        });
      }).catch(done);
    });

    it('should get active jobs', function (done) {
      var queue = helper.buildQueue();
      queue.process(function (job, jobDone) {
        queue.getActive().then(function (jobs) {
          expect(jobs).to.be.a('array');
          expect(jobs.length).to.be.equal(1);
          expect(jobs[0].data.foo).to.be.equal('bar');
          done();
        }).catch(done);
        jobDone();
      }).catch(done);

      queue.add({ foo: 'bar' }).catch(done);
    });

    it('should get a specific job', function (done) {
      var data = { foo: 'sup!' };
      var queue = helper.buildQueue();
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
      var queue = helper.buildQueue();
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

      queue.add({ foo: 'bar' }).catch(done);
      queue.add({ baz: 'qux' }).catch(done);
    });

    it('should get failed jobs', function (done) {
      var counter = 2;
      var queue = helper.buildQueue();

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

      queue.add({ foo: 'bar' }).catch(done);
      queue.add({ baz: 'qux' }).catch(done);
    });

    it('fails jobs that exceed their specified timeout', function (done) {
      var queue = helper.buildQueue();

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
      }).catch(done);
    });
  });

  describe('Cleaner', function () {
    var queue = null;
    beforeEach(function (done) {
      queue = helper.buildQueue('cleaner' + uuid());
      queue.once('ready', function() {
        done();
      });
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
      }).catch(done);
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
      }).catch(done);
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
      }).catch(done);
    });

    it('should clean a job without a timestamp', function (done) {
      var client = new Redis();

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
      }).catch(done);
    });
  });
});
