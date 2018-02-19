/*eslint-env node */
'use strict';

var Queue = require('../');

var expect = require('chai').expect;
var Promise = require('bluebird');
var redis = require('ioredis');
var utils = require('./utils');

describe('.pause', function() {
  beforeEach(function() {
    var client = new redis();
    return client.flushdb();
  });

  it('should pause a queue until resumed', function() {
    var ispaused = false,
      counter = 2;

    return utils.newQueue().then(function(queue) {
      var resultPromise = new Promise(function(resolve) {
        queue.process(function(job, jobDone) {
          expect(ispaused).to.be.eql(false);
          expect(job.data.foo).to.be.equal('paused');
          jobDone();
          counter--;
          if (counter === 0) {
            resolve(queue.close());
          }
        });
      });

      return Promise.join(
        queue
          .pause()
          .then(function() {
            ispaused = true;
            return queue.add({ foo: 'paused' });
          })
          .then(function() {
            return queue.add({ foo: 'paused' });
          })
          .then(function() {
            ispaused = false;
            return queue.resume();
          }),
        resultPromise
      );
    });
  });

  it('should be able to pause a running queue and emit relevant events', function(done) {
    var ispaused = false,
      isresumed = true,
      first = true;

    utils.newQueue().then(function(queue) {
      queue.process(function(job) {
        expect(ispaused).to.be.eql(false);
        expect(job.data.foo).to.be.equal('paused');

        if (first) {
          first = false;
          ispaused = true;
          return queue.pause();
        } else {
          expect(isresumed).to.be.eql(true);
          queue.close().then(done, done);
        }
      });

      queue.add({ foo: 'paused' });
      queue.add({ foo: 'paused' });

      queue.on('paused', function() {
        ispaused = false;
        queue.resume().catch(function(/*err*/) {
          // Swallow error.
        });
      });

      queue.on('resumed', function() {
        isresumed = true;
      });
    });
  });

  it('should pause the queue locally', function(done) {
    var counter = 2;

    var queue = utils.buildQueue();

    queue
      .pause(true /* Local */)
      .tap(function() {
        // Add the worker after the queue is in paused mode since the normal behavior is to pause
        // it after the current lock expires. This way, we can ensure there isn't a lock already
        // to test that pausing behavior works.
        queue
          .process(function(job, jobDone) {
            expect(queue.paused).not.to.be.ok;
            jobDone();
            counter--;
            if (counter === 0) {
              queue.close().then(done);
            }
          })
          .catch(done);
      })
      .then(function() {
        return queue.add({ foo: 'paused' });
      })
      .then(function() {
        return queue.add({ foo: 'paused' });
      })
      .then(function() {
        expect(counter).to.be.eql(2);
        expect(queue.paused).to.be.ok; // Parameter should exist.
        return queue.resume(true /* Local */);
      })
      .catch(done);
  });

  it('should wait until active jobs are finished before resolving pause', function(done) {
    var queue = utils.buildQueue();
    var startProcessing = new Promise(function(resolve) {
      queue.process(function(/*job*/) {
        resolve();
        return Promise.delay(200);
      });
    });

    queue.isReady().then(function() {
      var jobs = [];
      for (var i = 0; i < 10; i++) {
        jobs.push(queue.add(i));
      }
      //
      // Add start processing so that we can test that pause waits for this job to be completed.
      //
      jobs.push(startProcessing);
      Promise.all(jobs)
        .then(function() {
          return queue
            .pause(true)
            .then(function() {
              var active = queue
                .getJobCountByTypes(['active'])
                .then(function(count) {
                  expect(count).to.be.eql(0);
                  expect(queue.paused).to.be.ok;
                  return null;
                });

              // One job from the 10 posted above will be processed, so we expect 9 jobs pending
              var paused = queue
                .getJobCountByTypes(['delayed', 'wait'])
                .then(function(count) {
                  expect(count).to.be.eql(9);
                  return null;
                });
              return Promise.all([active, paused]);
            })
            .then(function() {
              return queue.add({});
            })
            .then(function() {
              var active = queue
                .getJobCountByTypes(['active'])
                .then(function(count) {
                  expect(count).to.be.eql(0);
                  return null;
                });

              var paused = queue
                .getJobCountByTypes(['paused', 'wait', 'delayed'])
                .then(function(count) {
                  expect(count).to.be.eql(10);
                  return null;
                });

              return Promise.all([active, paused]);
            })
            .then(function() {
              return queue.close().then(done, done);
            });
        })
        .catch(done);
    });
  });

  it('should pause the queue locally when more than one worker is active', function() {
    var queue1 = utils.buildQueue('pause-queue');
    var queue1IsProcessing = new Promise(function(resolve) {
      queue1.process(function(job, jobDone) {
        resolve();
        setTimeout(jobDone, 200);
      });
    });

    var queue2 = utils.buildQueue('pause-queue');
    var queue2IsProcessing = new Promise(function(resolve) {
      queue2.process(function(job, jobDone) {
        resolve();
        setTimeout(jobDone, 200);
      });
    });

    queue1.add(1);
    queue1.add(2);
    queue1.add(3);
    queue1.add(4);

    return Promise.all([queue1IsProcessing, queue2IsProcessing]).then(
      function() {
        return Promise.all([
          queue1.pause(true /* local */),
          queue2.pause(true /* local */)
        ]).then(function() {
          var active = queue1
            .getJobCountByTypes(['active'])
            .then(function(count) {
              expect(count).to.be.eql(0);
            });

          var pending = queue1
            .getJobCountByTypes(['wait'])
            .then(function(count) {
              expect(count).to.be.eql(2);
            });

          var completed = queue1
            .getJobCountByTypes(['completed'])
            .then(function(count) {
              expect(count).to.be.eql(2);
            });

          return Promise.all([active, pending, completed]).then(function() {
            return Promise.all([queue1.close(), queue2.close()]);
          });
        });
      }
    );
  });

  it('should wait for blocking job retrieval to complete before pausing locally', function() {
    var queue = utils.buildQueue();

    var startsProcessing = new Promise(function(resolve) {
      queue.process(function(/*job*/) {
        resolve();
        return Promise.delay(200);
      });
    });

    return queue
      .add(1)
      .then(function() {
        return startsProcessing;
      })
      .then(function() {
        return queue.pause(true);
      })
      .then(function() {
        return queue.add(2);
      })
      .then(function() {
        var active = queue.getJobCountByTypes(['active']).then(function(count) {
          expect(count).to.be.eql(0);
        });

        var pending = queue.getJobCountByTypes(['wait']).then(function(count) {
          expect(count).to.be.eql(1);
        });

        var completed = queue
          .getJobCountByTypes(['completed'])
          .then(function(count) {
            expect(count).to.be.eql(1);
          });

        return Promise.all([active, pending, completed]).then(function() {
          return queue.close();
        });
      });
  });

  it('pauses fast when queue is drained', function(done) {
    this.timeout(10000);
    var queue = new Queue('test');

    queue.process(function(/*job*/) {
      Promise.resolve();
    });

    queue.on('drained', function() {
      Promise.delay(500).then(function() {
        var start = new Date().getTime();
        return queue.pause(true).finally(function() {
          var finish = new Date().getTime();
          expect(finish - start).to.be.lt(1000);
          queue.close().then(done, done);
        });
      });
    });
  });
});
