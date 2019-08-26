'use strict';

const expect = require('chai').expect;
const utils = require('./utils');
const redis = require('ioredis');
const _ = require('lodash');
const assert = require('assert');

describe('Rate limiter', () => {
  let queue;
  let client;

  beforeEach(() => {
    client = new redis();
    return client.flushdb().then(() => {
      queue = utils.buildQueue('test rate limiter', {
        limiter: {
          max: 1,
          duration: 1000
        }
      });
      return queue;
    });
  });

  afterEach(() => {
    return queue.close().then(() => {
      return client.quit();
    });
  });

  it('should throw exception if missing duration option', done => {
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

  it('should throw exception if missing max option', done => {
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

  it('should obey the rate limit', done => {
    const startTime = new Date().getTime();
    const numJobs = 4;

    queue.process(() => {
      return Promise.resolve();
    });

    for (let i = 0; i < numJobs; i++) {
      queue.add({});
    }

    queue.on(
      'completed',
      // after every job has been completed
      _.after(numJobs, () => {
        try {
          const timeDiff = new Date().getTime() - startTime;
          expect(timeDiff).to.be.above((numJobs - 1) * 1000);
          done();
        } catch (err) {
          done(err);
        }
      })
    );

    queue.on('failed', err => {
      done(err);
    });
  });

  it('should put a job into the delayed queue when limit is hit', () => {
    const newQueue = utils.buildQueue('test rate limiter', {
      limiter: {
        max: 1,
        duration: 1000
      }
    });

    queue.on('failed', e => {
      assert.fail(e);
    });

    return Promise.all([
      newQueue.add({}),
      newQueue.add({}),
      newQueue.add({}),
      newQueue.add({})
    ]).then(() => {
      Promise.all([
        newQueue.getNextJob({}),
        newQueue.getNextJob({}),
        newQueue.getNextJob({}),
        newQueue.getNextJob({})
      ]).then(() => {
        return queue.getDelayedCount().then(
          delayedCount => {
            expect(delayedCount).to.eq(3);
          },
          () => {
            /*ignore error*/
          }
        );
      });
    });
  });

  it('should not put a job into the delayed queue when discard is true', () => {
    const newQueue = utils.buildQueue('test rate limiter', {
      limiter: {
        max: 1,
        duration: 1000,
        bounceBack: true
      }
    });

    newQueue.on('failed', e => {
      assert.fail(e);
    });
    return Promise.all([
      newQueue.add({}),
      newQueue.add({}),
      newQueue.add({}),
      newQueue.add({})
    ]).then(() => {
      Promise.all([
        newQueue.getNextJob({}),
        newQueue.getNextJob({}),
        newQueue.getNextJob({}),
        newQueue.getNextJob({})
      ]).then(() => {
        return newQueue.getDelayedCount().then(delayedCount => {
          expect(delayedCount).to.eq(0);
          return newQueue.getActiveCount().then(waitingCount => {
            expect(waitingCount).to.eq(1);
          });
        });
      });
    });
  });
});
