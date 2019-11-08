'use strict';

const expect = require('chai').expect;
const redis = require('ioredis');
const utils = require('./utils');
const delay = require('delay');
const sinon = require('sinon');

describe('.whenCurrentJobsFinished', () => {
  let client;
  beforeEach(() => {
    client = new redis();
    return client.flushdb();
  });

  afterEach(async () => {
    sinon.restore();
    await utils.cleanupQueues();
    await client.flushdb();
    return client.quit();
  });

  it('should handle queue with no processor', async () => {
    const queue = await utils.newQueue();
    expect(await queue.whenCurrentJobsFinished()).to.equal(undefined);
  });

  it('should handle queue with no jobs', async () => {
    const queue = await utils.newQueue();
    queue.process(() => Promise.resolve());
    expect(await queue.whenCurrentJobsFinished()).to.equal(undefined);
  });

  it('should wait for job to complete', async () => {
    const queue = await utils.newQueue();
    await queue.add({});

    let finishJob;

    // wait for job to be active
    await new Promise(resolve => {
      queue.process(() => {
        resolve();

        return new Promise(resolve => {
          finishJob = resolve;
        });
      });
    });

    let isFulfilled = false;
    const finished = queue.whenCurrentJobsFinished().then(() => {
      isFulfilled = true;
    });

    await delay(100);
    expect(isFulfilled).to.equal(false);

    finishJob();
    expect(await finished).to.equal(
      undefined,
      'whenCurrentJobsFinished should resolve once jobs are finished'
    );
  });

  it('should wait for job to fail', async () => {
    const queue = await utils.newQueue();
    await queue.add({});

    let rejectJob;

    // wait for job to be active
    await new Promise(resolve => {
      queue.process(() => {
        resolve();

        return new Promise((resolve, reject) => {
          rejectJob = reject;
        });
      });
    });

    let isFulfilled = false;
    const finished = queue.whenCurrentJobsFinished().then(() => {
      isFulfilled = true;
    });

    await delay(100);
    expect(isFulfilled).to.equal(false);

    rejectJob();
    expect(await finished).to.equal(
      undefined,
      'whenCurrentJobsFinished should resolve once jobs are finished'
    );
  });
});
