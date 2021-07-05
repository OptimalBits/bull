import { expect } from 'chai';
import redis from 'ioredis';
import path from 'path';
import utils from './utils.js';

describe('sandboxed CJS process from ESM', () => {
  let queue;
  let client;

  beforeEach(() => {
    client = new redis();
    return client.flushdb().then(() => {
      queue = utils.buildQueue('test process', {
        settings: {
          guardInterval: 300000,
          stalledInterval: 300000
        }
      });
      return queue;
    });
  });

  afterEach(() => {
    return queue
      .close()
      .then(() => {
        return client.flushall();
      })
      .then(() => {
        return client.quit();
      });
  });

  it('should process and complete', done => {
    const processFile = path.resolve() + '/test/fixtures/fixture_processor_cjs.cjs';
    queue.process(processFile);

    queue.on('completed', (job, value) => {
      try {
        expect(job.data).to.be.eql({ foo: 'bar' });
        expect(value).to.be.eql(42);
        expect(Object.keys(queue.childPool.retained)).to.have.lengthOf(0);
        expect(queue.childPool.free[processFile]).to.have.lengthOf(1);
        done();
      } catch (err) {
        done(err);
      }
    });

    queue.add({ foo: 'bar' });

  });

});
