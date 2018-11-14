/*eslint-env node */
'use strict';

var expect = require('chai').expect;
var utils = require('./utils');
var redis = require('ioredis');
var _ = require('lodash');

describe('Rate limiter', function() {
  var queue;
  var client;

  beforeEach(function() {
    client = new redis();
    return client.flushdb().then(function() {
      queue = utils.buildQueue('test rate limiter', {
        limiter: {
          max: 1,
          duration: 1000
        }
      });
      return queue;
    });
  });

  afterEach(function() {
    return queue.close().then(function() {
      return client.quit();
    });
  });

  it('should throw exception if missing duration option', function(done) {
    try {
      utils.buildQueue('rate limiter fail', {
        limiter: {
          max: 5
        }
      });
      expect.fail('Should not allow missing `duration` option');
    } catch (err) {
      done();
    }
  });

  it('should throw exception if missing max option', function(done) {
    try {
      utils.buildQueue('rate limiter fail', {
        limiter: {
          duration: 5000
        }
      });
      expect.fail('Should not allow missing `max`option');
    } catch (err) {
      done();
    }
  });

  it('should obey the rate limit', function(done) {
    var startTime = new Date().getTime();
    var numJobs = 4;

    queue.process(function() {
      return Promise.resolve();
    });

    for (var i = 0; i < numJobs; i++) {
      queue.add({});
    }

    queue.on(
      'completed',
      // after every job has been completed
      _.after(numJobs, function() {
        try {
          var timeDiff = new Date().getTime() - startTime;
          expect(timeDiff).to.be.above((numJobs - 1) * 1000);
          done();
        } catch (err) {
          done(err);
        }
      })
    );

    queue.on('failed', function(err) {
      done(err);
    });
  });

  it('should put a job into the delayed queue when limit is hit', function() {
    var newQueue = utils.buildQueue('test rate limiter', {
      limiter: {
        max: 1,
        duration: 1000
      }
    });

    queue.on('failed', function(e) {
      assert.fail(e);
    });

    return Promise.all([
      newQueue.add({}),
      newQueue.add({}),
      newQueue.add({}),
      newQueue.add({})
    ]).then(function() {
      Promise.all([
        newQueue.getNextJob({}),
        newQueue.getNextJob({}),
        newQueue.getNextJob({}),
        newQueue.getNextJob({})
      ]).then(function() {
        return queue.getDelayedCount().then(function(delayedCount) {
          expect(delayedCount).to.eq(3);
        });
      });
    });
  });

  it('should not put a job into the delayed queue when discard is true', function() {
    var newQueue = utils.buildQueue('test rate limiter', {
      limiter: {
        max: 1,
        duration: 1000,
        bounceBack: true
      }
    });

    newQueue.on('failed', function(e) {
      assert.fail(e);
    });
    return Promise.all([
      newQueue.add({}),
      newQueue.add({}),
      newQueue.add({}),
      newQueue.add({})
    ]).then(function() {
      Promise.all([
        newQueue.getNextJob({}),
        newQueue.getNextJob({}),
        newQueue.getNextJob({}),
        newQueue.getNextJob({})
      ]).then(function() {
        return newQueue.getDelayedCount().then(function(delayedCount) {
          expect(delayedCount).to.eq(0);
          return newQueue.getActiveCount().then(function(waitingCount) {
            expect(waitingCount).to.eq(1);
          });
        });
      });
    });
  });
});
