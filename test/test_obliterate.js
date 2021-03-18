'use strict';

const expect = require('chai').expect;
const redis = require('ioredis');
const _ = require('lodash');
const uuid = require('uuid');
const utils = require('./utils');
const delay = require('delay');

describe('Obliterate', () => {
  let queue;

  beforeEach(() => {
    queue = utils.buildQueue('cleaner' + uuid.v4());
  });

  afterEach(function() {
    this.timeout(
      queue.settings.stalledInterval * (1 + queue.settings.maxStalledCount)
    );
    return queue.close();
  });

  it.only('should obliterate an empty queue', async () => {
    await queue.obliterate();

    const client = await queue.client;
    const keys = await client.keys(`bull:${queue.name}*`);

    expect(keys.length).to.be.eql(0);
  });

  it('should obliterate a queue with jobs in different statuses', async () => {
    await queue.add({ foo: 'bar' });
    await queue.add({ foo: 'bar2' });
    await queue.add({ foo: 'bar3' }, { delay: 5000 });
    const job = await queue.add({ qux: 'baz' });

    let first = true;
    queue.process(async job => {
      if (first) {
        first = false;
        throw new Error('failed first');
      }
      return delay(250);
    });

    await job.finished();

    await queue.obliterate();
    const client = await queue.client;
    const keys = await client.keys(`bull:${queue.name}*`);
    expect(keys.length).to.be.eql(0);
  });

  it('should raise exception if queue has active jobs', async () => {
    await queue.add({ foo: 'bar' });
    const job = await queue.add({ qux: 'baz' });

    await queue.add({ foo: 'bar2' });
    await queue.add({ foo: 'bar3' }, { delay: 5000 });

    let first = true;
    queue.process(async job => {
      if (first) {
        first = false;
        throw new Error('failed first');
      }
      return delay(250);
    });

    await job.finished();

    try {
      await queue.obliterate();
    } catch (err) {
      const client = await queue.client;
      const keys = await client.keys(`bull:${queue.name}*`);
      expect(keys.length).to.be.not.eql(0);
      return;
    }

    throw new Error('Should raise an exception if there are active jobs');
  });

  it('should obliterate if queue has active jobs using "force"', async () => {
    await queue.add({ foo: 'bar' });
    const job = await queue.add({ qux: 'baz' });

    await queue.add({ foo: 'bar2' });
    await queue.add({ foo: 'bar3' }, { delay: 5000 });

    let first = true;
    queue.process(async job => {
      if (first) {
        first = false;
        throw new Error('failed first');
      }
      return delay(250);
    });

    await job.finished();
    await queue.obliterate({ force: true });
    const client = await queue.client;
    const keys = await client.keys(`bull:${queue.name}*`);
    expect(keys.length).to.be.eql(0);
  });
});
