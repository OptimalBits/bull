'use strict';

const expect = require('expect.js');
const utils = require('./utils');
const redis = require('ioredis');

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

  it('should recover from a connection loss', done => {
    queue.on('error', () => {
      // error event has to be observed or the exception will bubble up
    });

    queue
      .process((job, jobDone) => {
        expect(job.data.foo).to.be.equal('bar');
        jobDone();
        queue.close();
      })
      .then(() => {
        done();
      })
      .catch(done);

    // Simulate disconnect
    queue.isReady().then(() => {
      queue.client.stream.end();
      queue.client.emit('error', new Error('ECONNRESET'));

      // add something to the queue
      queue.add({ foo: 'bar' });
    });
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
    const client = new redis();
    const subscriber = new redis();

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

    return testQueue
      .isReady()
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

  it('should fail if redis connection fails', done => {
    queue = utils.buildQueue('connection fail', {
      redis: {
        host: 'localhost',
        port: 1234
      }
    });

    queue.isReady().then(
      () => {
        done(new Error('Did not fail connecting to invalid redis instance'));
      },
      err => {
        expect(err.code).to.be.eql('ECONNREFUSED');
        queue.close().then(done, done);
      }
    );
  });
});
