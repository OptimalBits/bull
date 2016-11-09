/// <reference path='../typings/mocha/mocha.d.ts'/>
/*eslint-env node */
'use strict';

var Queue = require('../lib/priority-queue');
var expect = require('expect.js');
var Promise = require('bluebird');
var sinon = require('sinon');
var _ = require('lodash');
var uuid = require('node-uuid');
var redis = require('redis');

var STD_QUEUE_NAME = 'test queue';

function buildQueue(name){
  var qName = name || STD_QUEUE_NAME;
  return new Queue(qName, 6379, '127.0.0.1');
}

function cleanupQueue(queue){
  return queue.empty().then(queue.close.bind(queue));
}

describe.skip('Priority queue', function(){
  var queue;
  var sandbox = sinon.sandbox.create();

  beforeEach(function(){
    var client = redis.createClient();
    return client.flushdbAsync();
  });

  afterEach(function(){
    if(queue){
      return cleanupQueue(queue).then(function(){
        queue = undefined;
      });
    }
    sandbox.restore();
  });

  it('allow custom clients', function(){
    var clients = 0;
    queue = new Queue(STD_QUEUE_NAME, {
      redis: {
        opts: {
          createClient: function(){
            clients++;
            return redis.createClient();
          }
        }
      }
    });
    expect(clients).to.be(15);
  });

  describe('.close', function(){
    var testQueue;

    beforeEach(function(){
      testQueue = buildQueue('test close');
    });

    it('should return a promise', function(){
      var closePromise = testQueue.close().then(function(){
        expect(closePromise).to.be.a(Promise);
      });
    });

    describe('should be callable from within', function(){
      it('a job handler that takes a callback', function(done){
        this.timeout(6000);

        testQueue.process(function(job, jobDone){
          expect(job.data.foo).to.be('bar');
          testQueue.close().then(function(){
            done();
          });
          jobDone();
        });

        testQueue.add({
          foo: 'bar'
        }).then(function(job){
          expect(job.jobId).to.be.ok();
          expect(job.data.foo).to.be('bar');
        });
      });

      it('a job handler that returns a promise', function(done){
        this.timeout(6000);

        testQueue.process(function(job){
          expect(job.data.foo).to.be('bar');
          testQueue.close().then(function(){
            done();
          });
          return Promise.resolve();
        });

        testQueue.add({
          foo: 'bar'
        }).then(function(job){
          expect(job.jobId).to.be.ok();
          expect(job.data.foo).to.be('bar');
        });
      });
    });
  });

  it('creates a queue with dots in its name', function(){
    queue = new Queue('using. dots. in.name.');

    return queue.add({
      foo: 'bar'
    }).then(function(job){
      expect(job.jobId).to.be.ok();
      expect(job.data.foo).to.be('bar');
    }).then(function(){
      queue.process(function(job, jobDone){
        expect(job.data.foo).to.be.equal('bar');
        jobDone();
      });
    });
  });

  it('processes jobs by priority', function(done){
    queue = buildQueue();

    var normalPriority = [],
      mediumPriority = [],
      highPriority = [];

    // for the current strategy this number should not exceed 8 (2^2*2)
    // this is done to maitain a deterministic output.
    var numJobsPerPriority = 6;

    for(var i = 0; i < numJobsPerPriority; i++){
      normalPriority.push(queue.add({p: 1}, {priority: 'normal'}));
      mediumPriority.push(queue.add({p: 2}, {priority: 'medium'}));
      highPriority.push(queue.add({p: 3}, {priority: 'high'}));
    }

    // wait for all jobs to enter the queue and then start processing
    Promise
      .all(normalPriority, mediumPriority, highPriority)
      .then(function(){
        var currentPriority = 3;
        var counter = 0;
        queue.process(function(job, jobDone){
          expect(job.jobId).to.be.ok();
          expect(job.data.p).to.be(currentPriority);

          jobDone();

          if(++counter === numJobsPerPriority){
            currentPriority--;
            counter = 0;

            if(currentPriority < 1){
              done();
            }
          }
        });
      });
  });

  it('process a job', function(done){
    queue = buildQueue();
    queue.process(function(job, jobDone){
      expect(job.data.foo).to.be.equal('bar');
      jobDone();
      done();
    });

    queue.add({
      foo: 'bar'
    }).then(function(job){
      expect(job.jobId).to.be.ok();
      expect(job.data.foo).to.be('bar');
    }).catch(done);
  });

  it('process a job that updates progress', function(done){
    queue = buildQueue();
    queue.process(function(job, jobDone){
      expect(job.data.foo).to.be.equal('bar');
      job.progress(42);
      jobDone();
    });

    queue.add({
      foo: 'bar'
    }).then(function(job){
      expect(job.jobId).to.be.ok();
      expect(job.data.foo).to.be('bar');
    }).catch(done);

    queue.on('progress', function(job, progress){
      expect(job).to.be.ok();
      expect(progress).to.be.eql(42);
      done();
    });
  });

  it('process a job that returns data in the process handler', function(done){
    queue = buildQueue();
    queue.process(function(job, jobDone){
      expect(job.data.foo).to.be.equal('bar');
      jobDone(null, 37);
    });

    queue.add({
      foo: 'bar'
    }).then(function(job){
      expect(job.jobId).to.be.ok();
      expect(job.data.foo).to.be('bar');
    }).catch(done);

    queue.on('completed', function(job, data){
      expect(job).to.be.ok();
      expect(data).to.be.eql(37);
      done();
    });
  });

  it('process stalled jobs when starting a queue', function(done){
    this.timeout(16000);
    var queueStalled = buildQueue('test queue stalled');
    queueStalled.setLockRenewTime(10);
    var jobs = [
      queueStalled.add({
        bar: 'baz'
      }),
      queueStalled.add({
        bar1: 'baz1'
      }),
      queueStalled.add({
        bar2: 'baz2'
      }),
      queueStalled.add({
        bar3: 'baz3'
      })
    ];

    queueStalled.empty().then(function(){
      Promise.all(jobs).then(function(){
        return queueStalled.process(function(){
          // instead of completing we just force-close the queue to simulate a crash.
          return queueStalled.close( true ).then(function(){
            var queue2 = buildQueue('test queue stalled');
            queue2.once('ready', function() {

              var doneAfterFour = _.after(4, function(){
                queue2.close().then(function(){
                  done()
                }, done);
              });
              queue2.on('completed', function(){
                doneAfterFour();
              });
              queue2.process(function(job, jobDone){
                jobDone();
              });
            });
          });
          // The sudden simulated crash will throw,
          // catch it here to let the tests continue normally
        }).catch(function () {
          return Promise.resolve();
        });
      }).catch(done);
    });
  });

  it('processes jobs that were added before the queue backend started', function(){
    var queueStalled = buildQueue('test queue added before');
    queueStalled.setLockRenewTime(10);
    var jobs = [
      queueStalled.add({
        bar: 'baz'
      }),
      queueStalled.add({
        bar1: 'baz1'
      }),
      queueStalled.add({
        bar2: 'baz2'
      }),
      queueStalled.add({
        bar3: 'baz3'
      })
    ];

    return Promise.all(jobs)
      .then(queueStalled.close.bind(queueStalled))
      .then(function(){
        queue = buildQueue('test queue added before');
        queue.process(function(job, jobDone){
          jobDone();
        });

        return new Promise(function(resolve){
          var resolveAfterAllJobs = _.after(jobs.length, resolve);
          queue.on('completed', resolveAfterAllJobs);
        });
      });
  });

  it.skip('processes several stalled jobs when starting several queues', function(done){
    this.timeout(5000);

    var NUM_QUEUES = 5;
    var NUM_JOBS_PER_QUEUE = 10;
    var stalledQueues = [];
    var jobs = [];

    for(var i = 0; i < NUM_QUEUES; i++){
      var stalledQueue = buildQueue('test queue stalled 2');
      stalledQueues.push(stalledQueue);
      stalledQueue.setLockRenewTime(10);

      for(var j = 0; j < NUM_JOBS_PER_QUEUE; j++){
        jobs.push(stalledQueue.add({
          job: j
        }));
      }
    }

    Promise.all(jobs).then(function(){
      var processed = 0;
      var procFn = function(){
        // instead of completing we just force-close the queue to simulate a crash.
        this.disconnect().then(function(){
          processed++;
          if(processed === stalledQueues.length){
            setTimeout(function(){
              var queue2 = buildQueue('test queue stalled 2');
              queue2.process(function(job2, jobDone){
                jobDone();
              });

              var counter = 0;
              queue2.on('completed', function(){
                counter++;
                if(counter === NUM_QUEUES * NUM_JOBS_PER_QUEUE){
                  queue2.close().then(function(){
                    done();
                  });
                }
              });
            }, 100);
          }
        });
      };

      for(var k = 0; k < stalledQueues.length; k++){
        stalledQueues[k].process(procFn);
      }
    });
  });

  it('does not process a job that is being processed when a new queue starts', function(done){
    this.timeout(5000);
    var err = null;
    var anotherQueue;
    var queueName = uuid();
    queue = buildQueue(queueName);

    queue.add({
      foo: 'bar'
    }).then(function(addedJob){
      queue.process(function(job, jobDone){
        expect(job.data.foo).to.be.equal('bar');

        if(addedJob.jobId !== job.jobId){
          err = new Error('Processed job id does not match that of added job');
        }

        anotherQueue = buildQueue(queueName);
        anotherQueue.process(function(job2, jobDone2){
          err = new Error('The second queue should not have received a job to process');
          jobDone2();
        });

        setTimeout(jobDone, 100);
      });

      queue.on('completed', function(){
        cleanupQueue(anotherQueue).then(done.bind(null, err));
      });
    });
  });

  it.skip('process stalled jobs without requiring a queue restart');

  it('process a job that fails', function(done){
    var jobError = new Error('Job Failed');
    queue = buildQueue();

    queue.process(function(job, jobDone){
      expect(job.data.foo).to.be.equal('bar');
      jobDone(jobError);
    });

    queue.add({
      foo: 'bar'
    }).then(function(job){
      expect(job.jobId).to.be.ok();
      expect(job.data.foo).to.be('bar');
    }, function(err){
      done(err);
    });

    queue.once('failed', function(job, err){
      expect(job.jobId).to.be.ok();
      expect(job.data.foo).to.be('bar');
      expect(err).to.be.eql(jobError);
      done();
    });
  });

  it('process a job that throws an exception', function(done){
    var jobError = new Error('Job Failed');

    queue = buildQueue();

    queue.process(function(job){
      expect(job.data.foo).to.be.equal('bar');
      throw jobError;
    });

    queue.add({
      foo: 'bar'
    }).then(function(job){
      expect(job.jobId).to.be.ok();
      expect(job.data.foo).to.be('bar');
    }, function(err){
      done(err);
    });

    queue.once('failed', function(job, err){
      expect(job.jobId).to.be.ok();
      expect(job.data.foo).to.be('bar');
      expect(err).to.be.eql(jobError);
      done();
    });
  });

  it('process several jobs serially', function(done){
    var counter = 1;
    var maxJobs = 100;

    queue = buildQueue();

    queue.process(function(job, jobDone){
      expect(job.data.num).to.be.equal(counter);
      expect(job.data.foo).to.be.equal('bar');
      jobDone();
      if(counter === maxJobs){
        done();
      }
      counter++;
    });

    for(var i = 1; i <= maxJobs; i++){
      queue.add({
        foo: 'bar',
        num: i
      });
    }
  });

  it('count added, unprocessed jobs', function(){
    var maxJobs = 100;
    var added = [];

    queue = buildQueue();

    for(var i = 1; i <= maxJobs; i++){
      added.push(queue.add({
        foo: 'bar',
        num: i
      }));
    }

    return Promise.all(added)
      .then(queue.count.bind(queue))
      .then(function(count){
        expect(count).to.be(100);
      })
      .then(queue.empty.bind(queue))
      .then(queue.count.bind(queue))
      .then(function(count){
        expect(count).to.be(0);
      });
  });

  it('add jobs to a paused queue', function(done){
    var ispaused = false,
      counter = 2;

    queue = buildQueue();

    queue.process(function(job, jobDone){
      expect(ispaused).to.be(false);
      expect(job.data.foo).to.be.equal('paused');
      jobDone();
      counter--;
      if(counter === 0){
        done();
      }
    });

    queue.pause();

    ispaused = true;

    queue.add({
      foo: 'paused'
    });
    queue.add({
      foo: 'paused'
    });

    setTimeout(function(){
      ispaused = false;
      queue.resume();
    }, 100); // We hope that this was enough to trigger a process if
    // we were not paused.
  });

  it('paused a running queue', function(done){
    var ispaused = false,
      isresumed = true,
      first = true;

    queue = buildQueue();

    queue.process(function(job, jobDone){
      expect(ispaused).to.be(false);
      expect(job.data.foo).to.be.equal('paused');
      jobDone();

      if(first){
        first = false;
        queue.pause();
        ispaused = true;
      } else{
        expect(isresumed).to.be(true);
        done();
      }
    });

    queue.add({
      foo: 'paused'
    });
    queue.add({
      foo: 'paused'
    });

    queue.on('paused', function(){
      setTimeout(function(){
        ispaused = false;
        queue.resume();
      }, 100); // We hope that this was enough to trigger a process if
    });

    queue.on('resumed', function(){
      isresumed = true;
    });
  });

  it('process a lifo queue', function(done){
    var currentValue = 0,
      first = true;
    queue = new Queue('test lifo');

    queue.once('ready', function(){
      queue.process(function(job, jobDone){
        // Catching the job before the pause
        if(first){
          expect(job.data.count).to.be.equal(0);
          first = false;
          return jobDone();
        }
        expect(job.data.count).to.be.equal(currentValue--);
        jobDone();
        if(currentValue === 0){
          done();
        }
      });

      // Add a job to pend proccessing
      queue.add({
        'count': 0
      }).then(function(){
        Promise.delay(500).then(function(){
          queue.pause().then(function(){
            // Add a series of jobs in a predictable order
            var fn = function(cb){
              queue.add({
                'count': ++currentValue
              }, {
                'lifo': true
              }).then(cb);
            };
            fn(fn(fn(fn(function(){
              queue.resume();
            }))));
          });
        });
      });
    });
  });

  describe('Jobs getters', function(){
    it('should get waitting jobs', function(done){
      queue = buildQueue();
      Promise.join(queue.add({
        foo: 'bar'
      }), queue.add({
        baz: 'qux'
      })).then(function(){
        queue.getWaiting().then(function(jobs){
          expect(jobs).to.be.a('array');
          expect(jobs.length).to.be.equal(2);
          expect(jobs[1].data.foo).to.be.equal('bar');
          expect(jobs[0].data.baz).to.be.equal('qux');
          done();
        });
      });
    });

    it('should get active jobs', function(done){
      queue = buildQueue();
      queue.process(function(job, jobDone){
        queue.getActive().then(function(jobs){
          expect(jobs).to.be.a('array');
          expect(jobs.length).to.be.equal(1);
          expect(jobs[0].data.foo).to.be.equal('bar');
          done();
        });
        jobDone();
      });

      queue.add({
        foo: 'bar'
      });
    });

    it('should get completed jobs', function(done){
      var counter = 2;

      queue = buildQueue();
      queue.process(function(job, jobDone){
        jobDone();
      });

      queue.on('completed', function(){
        counter--;

        if(counter === 0){
          queue.getCompleted().then(function(jobs){
            expect(jobs).to.be.a('array');
            // We need a 'empty completed' kind of function.
            //expect(jobs.length).to.be.equal(2);
            done();
          });
        }
      });

      queue.add({
        foo: 'bar'
      });
      queue.add({
        baz: 'qux'
      });
    });

    it('should get failed jobs', function(done){
      var counter = 2;

      queue = buildQueue();

      queue.process(function(job, jobDone){
        jobDone(new Error('Forced error'));
      });

      queue.on('failed', function(){
        counter--;

        if(counter === 0){
          queue.getFailed().then(function(jobs){
            expect(jobs).to.be.a('array');
            done();
          });
        }
      });

      queue.add({
        foo: 'bar'
      });
      queue.add({
        baz: 'qux'
      });
    });

    it('fails jobs that exceed their specified timeout', function(done){
      queue = buildQueue();

      queue.process(function(job, jobDone){
        setTimeout(jobDone, 150);
      });

      queue.on('failed', function(job, error){
        expect(error).to.be.a(Promise.TimeoutError);
        done();
      });

      queue.on('completed', function(){
        var error = new Error('The job should have timed out');
        done(error);
      });

      queue.add({
        some: 'data'
      }, {
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
      queue.add({some: 'data'}, {priority: 'normal'});
      queue.add({some: 'data'}, {priority: 'normal'});
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
      queue.add({some: 'data'}, {priority: 'normal'});
      queue.add({some: 'data'}, {priority: 'normal'});
      Promise.delay(200).then(function () {
        queue.add({some: 'data'});
        queue.clean(100);
      }).delay(100).then(function () {
        return queue.getCompleted();
      }).then(function (jobs) {
        expect(jobs.length).to.be(1);
        return queue.empty();
      }).then(function () {
        queue = undefined;
        done();
      });
    });

    it('should clean all failed jobs', function (done) {
      queue.add({some: 'data'}, {priority: 'normal'});
      queue.add({some: 'data'}, {priority: 'normal'});
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
        queue = undefined;
        done();
      });
    });

    it('should clean a job without a timestamp', function (done) {
      var client = redis.createClient(6379, '127.0.0.1', {});

      queue.add({some: 'data'}, {priority: 'normal'});
      queue.add({some: 'data'}, {priority: 'normal'});
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
        queue = undefined;
        done();
      });
    });
  });
});
