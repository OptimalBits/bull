'use strict';

const expect = require('chai').expect;
const utils = require('./utils');
const redis = require('ioredis');
const _ = require('lodash');
const delay = require('delay');
const pReflect = require('p-reflect');

describe('sandboxed process', () => {
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
    const processFile = __dirname + '/fixtures/fixture_processor.js';
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

  it('should process with named processor', done => {
    const processFile = __dirname + '/fixtures/fixture_processor.js';
    queue.process('foobar', processFile);

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

    queue.add('foobar', { foo: 'bar' });
  });

  it('should process with several named processors', done => {
    const processFileFoo = __dirname + '/fixtures/fixture_processor_foo.js';
    const processFileBar = __dirname + '/fixtures/fixture_processor_bar.js';

    queue.process('foo', processFileFoo);
    queue.process('bar', processFileBar);

    let count = 0;
    queue.on('completed', (job, value) => {
      let data, result, processFile, retainedLength;
      count++;
      if (count == 1) {
        data = { foo: 'bar' };
        result = 'foo';
        processFile = processFileFoo;
        retainedLength = 1;
      } else {
        data = { bar: 'qux' };
        result = 'bar';
        processFile = processFileBar;
        retainedLength = 0;
      }

      try {
        expect(job.data).to.be.eql(data);
        expect(value).to.be.eql(result);
        expect(Object.keys(queue.childPool.retained)).to.have.lengthOf(
          retainedLength
        );
        expect(queue.childPool.free[processFile]).to.have.lengthOf(1);
        if (count === 2) {
          done();
        }
      } catch (err) {
        console.error(err);
        done(err);
      }
    });

    queue.add('foo', { foo: 'bar' }).then(() => {
      delay(500).then(() => {
        queue.add('bar', { bar: 'qux' });
      });
    });

    queue.on('error', err => {
      console.error(err);
    });
  });

  it('should process with concurrent processors', done => {
    const after = _.after(4, () => {
      expect(queue.childPool.getAllFree().length).to.eql(4);
      done();
    });
    queue.on('completed', (job, value) => {
      try {
        expect(value).to.be.eql(42);
        expect(
          Object.keys(queue.childPool.retained).length +
            queue.childPool.getAllFree().length
        ).to.eql(4);
        after();
      } catch (err) {
        done(err);
      }
    });

    Promise.all([
      queue.add({ foo: 'bar1' }),
      queue.add({ foo: 'bar2' }),
      queue.add({ foo: 'bar3' }),
      queue.add({ foo: 'bar4' })
    ]).then(() => {
      queue.process(4, __dirname + '/fixtures/fixture_processor_slow.js');
    });
  });

  it('should reuse process with single processors', done => {
    const after = _.after(4, () => {
      expect(queue.childPool.getAllFree().length).to.eql(1);
      done();
    });
    queue.on('completed', (job, value) => {
      try {
        expect(value).to.be.eql(42);
        expect(
          Object.keys(queue.childPool.retained).length +
            queue.childPool.getAllFree().length
        ).to.eql(1);
        after();
      } catch (err) {
        done(err);
      }
    });

    Promise.all([
      queue.add({ foo: 'bar1' }),
      queue.add({ foo: 'bar2' }),
      queue.add({ foo: 'bar3' }),
      queue.add({ foo: 'bar4' })
    ]).then(() => {
      queue.process(__dirname + '/fixtures/fixture_processor_slow.js');
    });
  });

  it('should process and complete using done', done => {
    queue.process(__dirname + '/fixtures/fixture_processor_callback.js');

    queue.on('completed', (job, value) => {
      try {
        expect(job.data).to.be.eql({ foo: 'bar' });
        expect(value).to.be.eql(42);
        expect(Object.keys(queue.childPool.retained)).to.have.lengthOf(0);
        expect(queue.childPool.getAllFree()).to.have.lengthOf(1);
        done();
      } catch (err) {
        done(err);
      }
    });

    queue.add({ foo: 'bar' });
  });

  it('should process and update progress', done => {
    queue.process(__dirname + '/fixtures/fixture_processor_progress.js');

    queue.on('completed', (job, value) => {
      try {
        expect(job.data).to.be.eql({ foo: 'bar' });
        expect(value).to.be.eql(37);
        expect(job.progress()).to.be.eql(100);
        expect(progresses).to.be.eql([10, 27, 78, 100]);
        expect(Object.keys(queue.childPool.retained)).to.have.lengthOf(0);
        expect(queue.childPool.getAllFree()).to.have.lengthOf(1);
        queue.getJobLogs(job.id).then(logs =>
          expect(logs).to.be.eql({
            logs: ['10', '27', '78', '100'],
            count: 4
          })
        );
        done();
      } catch (err) {
        done(err);
      }
    });

    const progresses = [];
    queue.on('progress', (job, progress) => {
      progresses.push(progress);
    });

    queue.add({ foo: 'bar' });
  });

  it('should process and fail', done => {
    queue.process(__dirname + '/fixtures/fixture_processor_fail.js');

    queue.on('failed', (job, err) => {
      try {
        expect(job.data).eql({ foo: 'bar' });
        expect(job.failedReason).eql('Manually failed processor');
        expect(err.message).eql('Manually failed processor');
        expect(err.stack).include('fixture_processor_fail.js');
        expect(Object.keys(queue.childPool.retained)).to.have.lengthOf(0);
        expect(queue.childPool.getAllFree()).to.have.lengthOf(1);
        done();
      } catch (err) {
        done(err);
      }
    });

    queue.add({ foo: 'bar' });
  });

  it('should error if processor file is missing', done => {
    try {
      queue.process(__dirname + '/fixtures/missing_processor.js');
      done(new Error('did not throw error'));
    } catch (err) {
      done();
    }
  });

  it('should process and fail using callback', done => {
    queue.process(__dirname + '/fixtures/fixture_processor_callback_fail.js');

    queue.on('failed', (job, err) => {
      try {
        expect(job.data).eql({ foo: 'bar' });
        expect(job.failedReason).eql('Manually failed processor');
        expect(err.message).eql('Manually failed processor');
        expect(Object.keys(queue.childPool.retained)).to.have.lengthOf(0);
        expect(queue.childPool.getAllFree()).to.have.lengthOf(1);
        done();
      } catch (err) {
        done(err);
      }
    });

    queue.add({ foo: 'bar' });
  });

  it('should fail if the process crashes', () => {
    queue.process(__dirname + '/fixtures/fixture_processor_crash.js');

    return queue
      .add({})
      .then(job => {
        return pReflect(Promise.resolve(job.finished()));
      })
      .then(inspection => {
        expect(inspection.isRejected).to.be.eql(true);
        expect(inspection.reason.message).to.be.eql('boom!');
      });
  });

  it('should fail if the process exits 0', () => {
    queue.process(__dirname + '/fixtures/fixture_processor_crash.js');

    return queue
      .add({ exitCode: 0 })
      .then(job => {
        return pReflect(Promise.resolve(job.finished()));
      })
      .then(inspection => {
        expect(inspection.isRejected).to.be.eql(true);
        expect(inspection.reason.message).to.be.eql(
          'Unexpected exit code: 0 signal: null'
        );
      });
  });

  it('should fail if the process exits non-0', () => {
    queue.process(__dirname + '/fixtures/fixture_processor_crash.js');

    return queue
      .add({ exitCode: 1 })
      .then(job => {
        return pReflect(Promise.resolve(job.finished()));
      })
      .then(inspection => {
        expect(inspection.isRejected).to.be.eql(true);
        expect(inspection.reason.message).to.be.eql(
          'Unexpected exit code: 1 signal: null'
        );
      });
  });

  it('should remove exited process', done => {
    queue.process(__dirname + '/fixtures/fixture_processor_exit.js');

    queue.on('completed', () => {
      try {
        expect(Object.keys(queue.childPool.retained)).to.have.lengthOf(0);
        expect(queue.childPool.getAllFree()).to.have.lengthOf(1);
        delay(500)
          .then(() => {
            expect(Object.keys(queue.childPool.retained)).to.have.lengthOf(0);
            expect(queue.childPool.getAllFree()).to.have.lengthOf(0);
          })
          .then(() => {
            done();
          }, done);
      } catch (err) {
        done(err);
      }
    });

    queue.add({ foo: 'bar' });
  });
});
