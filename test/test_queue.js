"use strict";

var Job = require('../lib/job');
var Queue = require('../');
var expect = require('expect.js');
var Promise = require('bluebird');
var redis = require('redis');
var sinon = require('sinon');
var _ = require('lodash');

var STD_QUEUE_NAME = 'test queue';

function buildQueue(name) {
  var qName = name || STD_QUEUE_NAME;
  return new Queue(qName, 6379, '127.0.0.1');
}

function cleanupQueue(queue){
  return queue.empty().then(queue.close.bind(queue));
}

describe('Queue', function(){
  var queue;
  var sandbox = sinon.sandbox.create();

  afterEach(function(){
    if(queue){
      return cleanupQueue(queue).then(function(){
        queue = undefined;  
      })
    }
    sandbox.restore();
  });

  describe('.close', function () {
    var testQueue;

    beforeEach(function () {
        testQueue = new Queue('test');
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

    it('should resolve the promise when the streams for botch clients have emitted "close"', function () {
      testQueue.close();

      expect(typeof testQueue.client.stream._events.close).to.be('function');
      expect(typeof testQueue.bclient.stream._events.close).to.be('function');
    });

    it('should return a promise', function () {
      var closePromise = testQueue.close().then(function(){
        expect(closePromise).to.be.a(Promise);  
      });
    });
  });

  it('creates a queue with standard redis opts', function(done){
    queue = Queue('standard');

    queue.once('ready', function(){
      expect(queue.client.host).to.be('127.0.0.1');
      expect(queue.bclient.host).to.be('127.0.0.1');

      expect(queue.client.port).to.be(6379);
      expect(queue.bclient.port).to.be(6379);

      expect(queue.client.selected_db).to.be(0);
      expect(queue.bclient.selected_db).to.be(0);

      done();
    });
  });

  it('creates a queue using the supplied redis DB', function(done){
    queue = Queue('custom', {redis: {DB: 1}});

    queue.once('ready', function(){
      expect(queue.client.host).to.be('127.0.0.1');
      expect(queue.bclient.host).to.be('127.0.0.1');

      expect(queue.client.port).to.be(6379);
      expect(queue.bclient.port).to.be(6379);

      expect(queue.client.selected_db).to.be(1);
      expect(queue.bclient.selected_db).to.be(1);

      done();
    });
  });

  it('creates a queue using custom the supplied redis host', function(done){
    queue = Queue('custom', {redis: {host: 'localhost'}});

    queue.once('ready', function(){
      expect(queue.client.host).to.be('localhost');
      expect(queue.bclient.host).to.be('localhost');

      expect(queue.client.selected_db).to.be(0);
      expect(queue.bclient.selected_db).to.be(0);
      done();
    });
  });

  it('creates a queue with dots in its name', function(){
    queue = Queue('using. dots. in.name.');

    return queue.add({foo: 'bar'}).then(function(job){
        expect(job.jobId).to.be.ok()
        expect(job.data.foo).to.be('bar')
      })
      .then(function(){
        queue.process(function(job, jobDone){
          expect(job.data.foo).to.be.equal('bar')
          jobDone();
        });
      });
  });

  it('should recover from a connection loss', function(done){
    queue = Queue('test connection loss');
    queue.on('error', function(err){
      // error event has to be observed or the exception will bubble up
    }).process(function(job, jobDone){
      expect(job.data.foo).to.be.equal('bar');
      jobDone();
      done();
    });

    // Simulate disconnect
    queue.bclient.stream.end();
    queue.bclient.emit('error', new Error('ECONNRESET'));

    // add something to the queue
    queue.add({'foo': 'bar'});
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

      queue.add({'foo': 'bar'});
      queue.bclient.emit('end');
  });

  it('should not try to reconnect when the blocking client triggers an "end" event and no process have been called', function (done) {
    queue = buildQueue();

    var runSpy = sandbox.spy(queue, 'run');

    queue.bclient.emit('end');

    setTimeout(function() {
      expect(runSpy.callCount).to.be(0);
      done()
    }, 100)
  });

  it('process a job', function(done){
    queue = buildQueue();
    queue.process(function(job, jobDone){
      expect(job.data.foo).to.be.equal('bar');
      jobDone();
      done();
    });

    queue.add({foo: 'bar'}).then(function(job){
      expect(job.jobId).to.be.ok()
      expect(job.data.foo).to.be('bar')
    }).catch(done);
  });

  it('process a job that updates progress', function(done){
    queue = buildQueue();
    queue.process(function(job, jobDone){
      expect(job.data.foo).to.be.equal('bar');
      job.progress(42);
      jobDone();
    });

    queue.add({foo: 'bar'}).then(function(job){
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

    queue.add({foo: 'bar'}).then(function(job){
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
    var queueStalled = Queue('test queue stalled', 6379, '127.0.0.1');
    queueStalled.LOCK_RENEW_TIME = 10;
    var jobs = [
      queueStalled.add({bar: 'baz'}),
      queueStalled.add({bar1: 'baz1'}),
      queueStalled.add({bar2: 'baz2'}),
      queueStalled.add({bar3: 'baz3'})
    ];

    Promise.all(jobs).then(function(){
      queueStalled.process(function(job){
        // instead of completing we just close the queue to simulate a crash.
        queueStalled.close();
        setTimeout(function(){
          var queue2 = Queue('test queue stalled', 6379, '127.0.0.1');
          var doneAfterFour = _.after(4, function(){
            done();
          });
          queue2.on('completed', doneAfterFour);

          queue2.process(function(job, jobDone){
            jobDone();
          });
        }, 100);
      });
    });
  });

  it('processes jobs that were added before the queue backend started', function(){
    var queueStalled = Queue('test queue added before', 6379, '127.0.0.1');
    queueStalled.LOCK_RENEW_TIME = 10;
    var jobs = [
      queueStalled.add({bar: 'baz'}),
      queueStalled.add({bar1: 'baz1'}),
      queueStalled.add({bar2: 'baz2'}),
      queueStalled.add({bar3: 'baz3'})
    ];

    return Promise.all(jobs)
      .then(queueStalled.close.bind(queueStalled))
      .then(function(){
        queue = Queue('test queue added before', 6379, '127.0.0.1');
        queue.process(function(job, jobDone){
          jobDone();
        });

        return new Promise(function(resolve, reject){
          var resolveAfterAllJobs = _.after(jobs.length, resolve);
          queue.on('completed', resolveAfterAllJobs);
        });
      });
  });

  it('processes several stalled jobs when starting several queues', function(done){
    var NUM_QUEUES = 10;
    var NUM_JOBS_PER_QUEUE = 20;
    var stalledQueues = [];
    var jobs = [];

    for(var i=0; i<NUM_QUEUES; i++){
      var queue = Queue('test queue stalled 2', 6379, '127.0.0.1');
      stalledQueues.push(queue);
      queue.LOCK_RENEW_TIME = 10;

      for(var j=0; j<NUM_JOBS_PER_QUEUE; j++){
        jobs.push(queue.add({job: j}));
      }
    }

    Promise.all(jobs).then(function(){
      var processed = 0;
      for(var k=0; k<stalledQueues.length; k++){
        stalledQueues[k].process(function(job){
          // instead of completing we just close the queue to simulate a crash.
          this.close();

          processed ++;
          if(processed === stalledQueues.length){
            setTimeout(function(){
              var queue2 = Queue('test queue stalled 2', 6379, '127.0.0.1');
              queue2.process(function(job, jobDone){
                jobDone();
              });

              var counter = 0;
              queue2.on('completed', function(job){
                counter ++;
                if(counter === NUM_QUEUES * NUM_JOBS_PER_QUEUE) {
                  queue2.close().then(function(){
                      done();
                  });
                }
              });
            }, 100);
          }
        });
      }
    });
  });

  it('does not process a job that is being processed when a new queue starts', function(done){
    this.timeout(5000)
    var err = null;
    var anotherQueue;

    queue = buildQueue();

    queue.add({foo: 'bar'}).then(function(addedJob){
      queue.process(function(job, jobDone){
        expect(job.data.foo).to.be.equal('bar');

        if(addedJob.jobId !== job.jobId){
          err = new Error('Processed job id does not match that of added job');
        }
        setTimeout(jobDone, 100);
      });

      anotherQueue = buildQueue();
      anotherQueue.process(function(job, jobDone){
        err = new Error('The second queue should not have received a job to process');
        jobDone();
      });

      queue.on('completed', function(){
        cleanupQueue(anotherQueue).then(done.bind(null, err));
      });
    });
  });

  it.skip('process stalled jobs without requiring a queue restart');

  it('process a job that fails', function(done){
    var jobError = Error("Job Failed");
    queue = buildQueue();

    queue.process(function(job, jobDone){
      expect(job.data.foo).to.be.equal('bar');
      jobDone(jobError);
    });

    queue.add({foo: 'bar'}).then(function(job){
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
    var jobError = new Error("Job Failed");

    queue = buildQueue();

    queue.process(function(job, jobDone){
      expect(job.data.foo).to.be.equal('bar');
      throw jobError;
    });

    queue.add({foo: 'bar'}).then(function(job){
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

  it('retry a job that fails', function(done){
    var called = 0
    var messages = 0;
    var failedOnce = false;

    var queue = buildQueue('retry-test-queue');
    var client = redis.createClient(6379, '127.0.0.1', {});

    client.select(0);

    client.on('ready', function () {
      client.on("message", function(channel, message) {
        expect(channel).to.be.equal(queue.toKey("jobs"));
        expect(parseInt(message, 10)).to.be.a('number');
        messages++;
      });
      client.subscribe(queue.toKey("jobs"));

      queue.add({foo: 'bar'}).then(function(job){
        expect(job.jobId).to.be.ok();
        expect(job.data.foo).to.be('bar');
      });
    });

    queue.process(function(job, jobDone){
      called++;
      if (called % 2 !== 0){
        throw new Error("Not even!")
      }
      jobDone();
    });

    queue.once('failed', function(job, err){
      expect(job.jobId).to.be.ok();
      expect(job.data.foo).to.be('bar');
      expect(err.message).to.be.eql("Not even!");
      failedOnce = true
      queue.retryJob(job);
    });

    queue.once('completed', function(){
      expect(failedOnce).to.be(true);
      expect(messages).to.eql(2);
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
      if(counter == maxJobs) done();
      counter++;
    });

    for(var i=1; i<=maxJobs; i++){
      queue.add({foo: 'bar', num: i});
    }
  });

  it('count added, unprocessed jobs', function(){
    var counter = 1;
    var maxJobs = 100;
    var added = [];

    queue = buildQueue();

    for(var i=1; i<=maxJobs; i++){
      added.push(queue.add({foo: 'bar', num: i}));
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
    var ispaused = false, counter = 2;

    queue = buildQueue();

    queue.process(function(job, jobDone){
      expect(ispaused).to.be(false);
      expect(job.data.foo).to.be.equal('paused');
      jobDone();
      counter--;
      if(counter === 0) done();
    });

    queue.pause();

    ispaused = true;

    queue.add({foo: 'paused'});
    queue.add({foo: 'paused'});

    setTimeout(function(){
      ispaused = false;
      queue.resume();
    }, 100); // We hope that this was enough to trigger a process if
    // we were not paused.
  });

  it('paused a running queue', function(done){
    var ispaused = false, isresumed = true, first = true;

    queue = buildQueue();

    queue.process(function(job, jobDone){
      expect(ispaused).to.be(false);
      expect(job.data.foo).to.be.equal('paused');
      jobDone();

      if(first){
        first = false;
        queue.pause();
        ispaused = true;
      }else{
        expect(isresumed).to.be(true);
        done();
      }
    });

    queue.add({foo: 'paused'});
    queue.add({foo: 'paused'});

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
    var currentValue = 0, first = true;
    queue = Queue('test lifo');

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
      queue.add({'count': 0}).then(function(){
        queue.pause().then(function(){
          // Add a series of jobs in a predictable order
          var fn = function(cb){
            queue.add({'count': ++currentValue}, {'lifo': true}).then(cb);
          };
          fn(fn(fn(fn(function(){
            queue.resume();
          }))));
        });
      });
    });
  });

  it('should publish a message when a new message is added to the queue', function(done) {
    var client = redis.createClient(6379, '127.0.0.1', {});
    client.select(0);
    queue = Queue('test pub sub');
    client.on('ready', function () {
      client.on("message", function(channel, message) {
        expect(channel).to.be.equal(queue.toKey("jobs"));
        expect(parseInt(message, 10)).to.be.a('number');
        done();
      });
      client.subscribe(queue.toKey("jobs"));
      queue.add({test: "stuff"});
    });
  });

  describe("Delayed jobs", function(){
    it("should process a delayed job only after delayed time", function(done){
      var delay = 500;
      queue = Queue("delayed queue simple");
      var timestamp = Date.now();
      
      queue.process(function(job, jobDone){
        jobDone();

        expect(Date.now() > timestamp + delay);
        
        queue.getWaiting().then(function(jobs){
          expect(jobs.length).to.be.equal(0);
        }).then(function(){
          return queue.getActive().then(function(jobs){
            expect(jobs.length).to.be.equal(0);
          })
        }).then(function(){
          return queue.getDelayed().then(function(jobs){
            expect(jobs.length).to.be.equal(0);
          })
        }).then(function(){
          return queue.getCompleted().then(function(jobs){
            //expect(jobs.length).to.be.equal(1);
            //console.log("COMPLETED", jobs)
          })
        }).then(function(){
          return queue.getFailed().then(function(jobs){
            expect(jobs.length).to.be.equal(0);
          })
        }).then(function(){
          return queue.empty();
        }).then(done)
      });
      return queue.add({delayed: 'foobar'}, {delay: delay}).then(function(job){
        expect(job.jobId).to.be.ok()
        expect(job.data.delayed).to.be('foobar')
        expect(job.delay).to.be(delay)
      })
    });

    it("should process delayed jobs in correct order", function(done){
      var order = 0;
      queue = Queue("delayed queue multiple");

      queue.process(function(job, jobDone){        
        expect(order).to.be.below(job.data.order);
        order = job.data.order;

        jobDone();
        if(order === 10){
          done();
        }
      });

      queue.add({order: 1}, {delay: 100});
      queue.add({order: 6}, {delay: 600});
      queue.add({order: 10}, {delay: 1000});
      queue.add({order: 2}, {delay: 200});
      queue.add({order: 9}, {delay: 900});
      queue.add({order: 5}, {delay: 500});
      queue.add({order: 3}, {delay: 300});
      queue.add({order: 7}, {delay: 700});
      queue.add({order: 4}, {delay: 400});
      queue.add({order: 8}, {delay: 800});
      
    })
  });

  describe("Jobs getters", function(){
    it('should get waitting jobs', function(done){
      queue = buildQueue();
      Promise.join(queue.add({foo: 'bar'}), queue.add({baz: 'qux'})).then(function(){
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
      var counter = 2;

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

      queue.add({foo: 'bar'});
    });

    it('should get a specific job', function(done){
      var data = {foo: 'sup!'};

      queue = buildQueue();
      queue.add(data).then(function(job) {
        queue.getJob(job.jobId).then(function(returnedJob) {
          expect(returnedJob.data).to.eql(data);
          expect(returnedJob.jobId).to.be(job.jobId);
          done();
        });
      })
    });

    it('should get completed jobs', function(){
      var counter = 2;

      queue = buildQueue();
      queue.process(function(job, jobDone){
        jobDone();
      });

      queue.on('completed', function(){
        counter --;

        if(counter === 0){
          queue.getCompleted().then(function(jobs){
            expect(jobs).to.be.a('array');
            // We need a "empty completed" kind of function.
            //expect(jobs.length).to.be.equal(2);
            done();
          });
        }
      });

      queue.add({foo: 'bar'});
      queue.add({baz: 'qux'});
    });

    it('should get failed jobs', function(done){
      var counter = 2;

      queue = buildQueue();

      queue.process(function(job, jobDone){
        jobDone(Error("Forced error"));
      });

      queue.on('failed', function(){
        counter --;

        if(counter === 0){
          queue.getFailed().then(function(jobs){
            expect(jobs).to.be.a('array');
            done();
          });
        }
      });

      queue.add({foo: 'bar'});
      queue.add({baz: 'qux'});
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

      queue.add({some: 'data'}, {
        timeout: 100
      });
    });
  });
});
