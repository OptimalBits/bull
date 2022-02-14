'use strict';

const expect = require('expect.js');
const utils = require('./utils');
const { isRedisReady } = require('../lib/utils');
const redis = require('ioredis');
const Queue = require('../lib/queue');

describe('connection', () => {
  let queue;
  let client;

  beforeEach(() => {
    client = new redis();
    return client.flushdb().then(() => {
      queue = utils.buildQueue();
      return queue;
    });
  });

  afterEach(() => {
    return client.quit();
  });

  it('should fail if reusing connections with invalid options', () => {
    const errMsg = Queue.ErrorMessages.MISSING_REDIS_OPTS;
    {
      try {
        const client = new redis();

        const opts = {
          createClient(type) {
            switch (type) {
              case 'client':
                return client;
              default:
                return new redis();
            }
          }
        };
        utils.buildQueue('external connections', opts);
        throw new Error('should fail with invalid redis options');
      } catch (err) {
        expect(err.message).to.be.equal(errMsg);
      }
    }
    {
      const subscriber = new redis();

      const opts = {
        createClient(type) {
          switch (type) {
            case 'subscriber':
              return subscriber;
            default:
              return new redis({
                maxRetriesPerRequest: null,
                enableReadyCheck: false
              });
          }
        }
      };

      const testQueue = utils.buildQueue('external connections', opts);

      try {
        testQueue.on('global:completed', () => {});
      } catch (err) {
        expect(err.message).to.be.equal(errMsg);
        testQueue.close();
      }
    }
  });

  it('should recover from a connection loss', async () => {
    queue.on('error', () => {
      // error event has to be observed or the exception will bubble up
    });

    const done = new Promise((resolve, reject) => {
      queue
        .process((job, jobDone) => {
          expect(job.data.foo).to.be.equal('bar');
          jobDone();
          queue.close();
        })
        .then(() => {
          resolve();
        })
        .catch(reject);
    });

    // Simulate disconnect
    await queue.isReady();
    await isRedisReady(queue.client);
    queue.client.stream.end();
    queue.client.emit('error', new Error('ECONNRESET'));

    // add something to the queue
    await queue.add({ foo: 'bar' });

    await done;
  });

  it('should handle jobs added before and after a redis disconnect', done => {
    let count = 0;
    queue
      .process((job, jobDone) => {
        if (count == 0) {
          expect(job.data.foo).to.be.equal('bar');
          jobDone();
        } else {
          jobDone();
          queue.close().then(done, done);
        }
        count++;
      })
      .catch(done);

    queue.on('completed', () => {
      if (count === 1) {
        queue.client.stream.end();
        queue.client.emit('error', new Error('ECONNRESET'));
      }
    });

    queue.isReady().then(() => {
      queue.add({ foo: 'bar' });
    });

    queue.on('error', (/*err*/) => {
      if (count === 1) {
        queue.add({ foo: 'bar' });
      }
    });
  });

  it('should not close external connections', () => {
    const redisOpts = {
      maxRetriesPerRequest: null,
      enableReadyCheck: false
    };

    const client = new redis(redisOpts);
    const subscriber = new redis(redisOpts);

    const opts = {
      createClient(type) {
        switch (type) {
          case 'client':
            return client;
          case 'subscriber':
            return subscriber;
          default:
            return new redis();
        }
      }
    };

    const testQueue = utils.buildQueue('external connections', opts);

    return new Promise(resolve => {
      if (subscriber.status === 'ready') {
        return resolve();
      }
      subscriber.once('ready', resolve);
    })
      .then(() => {
        return testQueue.isReady();
      })
      .then(() => {
        return testQueue.add({ foo: 'bar' });
      })
      .then(() => {
        expect(testQueue.client).to.be.eql(client);
        expect(testQueue.eclient).to.be.eql(subscriber);

        return testQueue.close();
      })
      .then(() => {
        expect(client.status).to.be.eql('ready');
        expect(subscriber.status).to.be.eql('ready');
        return Promise.all([client.quit(), subscriber.quit()]);
      });
  });

  it('should fail if redis connection fails and does not reconnect', done => {
    queue = utils.buildQueue('connection fail', {
      redis: {
        host: 'localhost',
        port: 1234,
        retryStrategy: () => false
      }
    });

    isRedisReady(queue.client).then(
      () => {
        done(new Error('Did not fail connecting to invalid redis instance'));
      },
      err => {
        expect(err.code).to.be.eql('ECONNREFUSED');
        queue.close().then(done, done);
      }
    );
  });

  it('should close cleanly if redis connection fails', async () => {
    queue = utils.buildQueue('connection fail', {
      redis: {
        host: 'localhost',
        port: 1234,
        retryStrategy: () => false
      }
    });

    await queue.close();
  });
});
