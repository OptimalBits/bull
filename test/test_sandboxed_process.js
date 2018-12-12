/*eslint-env node */
'use strict';

var expect = require('chai').expect;
var utils = require('./utils');
var redis = require('ioredis');
var _ = require('lodash');
var delay = require('delay');
var pReflect = require('p-reflect');

describe('sandboxed process', function() {
  var queue;
  var client;

  beforeEach(function() {
    client = new redis();
    return client.flushdb().then(function() {
      queue = utils.buildQueue('test process', {
        settings: {
          guardInterval: 300000,
          stalledInterval: 300000
        }
      });
      return queue;
    });
  });

  afterEach(function() {
    return queue
      .close()
      .then(function() {
        return client.flushall();
      })
      .then(function() {
        return client.quit();
      });
  });

  it('should process and complete', function(done) {
    var processFile = __dirname + '/fixtures/fixture_processor.js';
    queue.process(processFile);

    queue.on('completed', function(job, value) {
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

  it('should process with named processor', function(done) {
    var processFile = __dirname + '/fixtures/fixture_processor.js';
    queue.process('foobar', processFile);

    queue.on('completed', function(job, value) {
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

  it('should process with several named processors', function(done) {
    var processFileFoo = __dirname + '/fixtures/fixture_processor_foo.js';
    var processFileBar = __dirname + '/fixtures/fixture_processor_bar.js';

    queue.process('foo', processFileFoo);
    queue.process('bar', processFileBar);

    var count = 0;
    queue.on('completed', function(job, value) {
      var data, result, processFile, retainedLength;
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

    queue.add('foo', { foo: 'bar' }).then(function() {
      delay(500).then(function() {
        queue.add('bar', { bar: 'qux' });
      });
    });

    queue.on('error', function(err) {
      console.error(err);
    });
  });

  it('should process with concurrent processors', function(done) {
    var after = _.after(4, function() {
      expect(queue.childPool.getAllFree().length).to.eql(4);
      done();
    });
    queue.on('completed', function(job, value) {
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
    ]).then(function() {
      queue.process(4, __dirname + '/fixtures/fixture_processor_slow.js');
    });
  });

  it('should reuse process with single processors', function(done) {
    var after = _.after(4, function() {
      expect(queue.childPool.getAllFree().length).to.eql(1);
      done();
    });
    queue.on('completed', function(job, value) {
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
    ]).then(function() {
      queue.process(__dirname + '/fixtures/fixture_processor_slow.js');
    });
  });

  it('should process and complete using done', function(done) {
    queue.process(__dirname + '/fixtures/fixture_processor_callback.js');

    queue.on('completed', function(job, value) {
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

  it('should process and update progress', function(done) {
    queue.process(__dirname + '/fixtures/fixture_processor_progress.js');

    queue.on('completed', function(job, value) {
      try {
        expect(job.data).to.be.eql({ foo: 'bar' });
        expect(value).to.be.eql(37);
        expect(job.progress()).to.be.eql(100);
        expect(progresses).to.be.eql([10, 27, 78, 100]);
        expect(Object.keys(queue.childPool.retained)).to.have.lengthOf(0);
        expect(queue.childPool.getAllFree()).to.have.lengthOf(1);
        done();
      } catch (err) {
        done(err);
      }
    });

    var progresses = [];
    queue.on('progress', function(job, progress) {
      progresses.push(progress);
    });

    queue.add({ foo: 'bar' });
  });

  it('should process and fail', function(done) {
    queue.process(__dirname + '/fixtures/fixture_processor_fail.js');

    queue.on('failed', function(job, err) {
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

  it('should error if processor file is missing', function(done) {
    try {
      queue.process(__dirname + '/fixtures/missing_processor.js');
      done(new Error('did not throw error'));
    } catch (err) {
      done();
    }
  });

  it('should process and fail using callback', function(done) {
    queue.process(__dirname + '/fixtures/fixture_processor_callback_fail.js');

    queue.on('failed', function(job, err) {
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

  it('should fail if the process crashes', function() {
    queue.process(__dirname + '/fixtures/fixture_processor_crash.js');

    return queue
      .add({})
      .then(function(job) {
        return pReflect(Promise.resolve(job.finished()));
      })
      .then(function(inspection) {
        expect(inspection.isRejected).to.be.eql(true);
        expect(inspection.reason.message).to.be.eql('boom!');
      });
  });

  it('should fail if the process exits 0', function() {
    queue.process(__dirname + '/fixtures/fixture_processor_crash.js');

    return queue
      .add({ exitCode: 0 })
      .then(function(job) {
        return pReflect(Promise.resolve(job.finished()));
      })
      .then(function(inspection) {
        expect(inspection.isRejected).to.be.eql(true);
        expect(inspection.reason.message).to.be.eql('Unexpected exit code: 0');
      });
  });

  it('should fail if the process exits non-0', function() {
    queue.process(__dirname + '/fixtures/fixture_processor_crash.js');

    return queue
      .add({ exitCode: 1 })
      .then(function(job) {
        return pReflect(Promise.resolve(job.finished()));
      })
      .then(function(inspection) {
        expect(inspection.isRejected).to.be.eql(true);
        expect(inspection.reason.message).to.be.eql('Unexpected exit code: 1');
      });
  });

  it('should remove exited process', function(done) {
    queue.process(__dirname + '/fixtures/fixture_processor_exit.js');

    queue.on('completed', function() {
      try {
        expect(Object.keys(queue.childPool.retained)).to.have.lengthOf(0);
        expect(queue.childPool.getAllFree()).to.have.lengthOf(1);
        delay(500)
          .then(function() {
            expect(Object.keys(queue.childPool.retained)).to.have.lengthOf(0);
            expect(queue.childPool.getAllFree()).to.have.lengthOf(0);
          })
          .then(function() {
            done();
          }, done);
      } catch (err) {
        done(err);
      }
    });

    queue.add({ foo: 'bar' });
  });
});
