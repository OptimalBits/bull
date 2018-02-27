/*eslint-env node */
'use strict';

var Job = require('../lib/job');
var Queue = require('../lib/queue');
var expect = require('expect.js');
var redis = require('ioredis');
var Promise = require('bluebird');
var uuid = require('uuid');

describe('Job', function() {
  var queue;

  beforeEach(function() {
    var client = new redis();
    return client.flushdb();
  });

  beforeEach(function() {
    queue = new Queue('test-' + uuid(), {
      redis: { port: 6379, host: '127.0.0.1' }
    });
  });

  afterEach(function() {
    this.timeout(
      queue.settings.stalledInterval * (1 + queue.settings.maxStalledCount)
    );
    return queue.close();
  });

  describe('.create', function() {
    var job;
    var data;
    var opts;

    beforeEach(function() {
      data = { foo: 'bar' };
      opts = { testOpt: 'enabled' };

      return Job.create(queue, data, opts).then(function(createdJob) {
        job = createdJob;
      });
    });

    it('returns a promise for the job', function() {
      expect(job).to.have.property('id');
      expect(job).to.have.property('data');
    });

    it('should not modify input options', function() {
      expect(opts).not.to.have.property('jobId');
    });

    it('saves the job in redis', function() {
      return Job.fromId(queue, job.id).then(function(storedJob) {
        expect(storedJob).to.have.property('id');
        expect(storedJob).to.have.property('data');

        expect(storedJob.data.foo).to.be.equal('bar');
        expect(storedJob.opts).to.be.a(Object);
        expect(storedJob.opts.testOpt).to.be('enabled');
      });
    });

    it('should use the custom jobId if one is provided', function() {
      var customJobId = 'customjob';
      return Job.create(queue, data, { jobId: customJobId }).then(function(
        createdJob
      ) {
        expect(createdJob.id).to.be.equal(customJobId);
      });
    });

    it('should process jobs with custom jobIds', function(done) {
      var customJobId = 'customjob';
      queue.process(function() {
        return Promise.resolve();
      });

      queue.add({ foo: 'bar' }, { jobId: customJobId });

      queue.on('completed', function(job) {
        if (job.id == customJobId) {
          done();
        }
      });
    });
  });

  describe('.update', function() {
    it('should allow updating job data', function() {
      return Job.create(queue, { foo: 'bar' })
        .then(function(job) {
          return job.update({ baz: 'qux' }).then(function() {
            return job;
          });
        })
        .then(function(job) {
          return Job.fromId(queue, job.id).then(function(job) {
            expect(job.data).to.be.eql({ baz: 'qux' });
          });
        });
    });
  });

  describe('.remove', function() {
    it('removes the job from redis', function() {
      return Job.create(queue, { foo: 'bar' })
        .tap(function(job) {
          return job.remove();
        })
        .then(function(job) {
          return Job.fromId(queue, job.id);
        })
        .then(function(storedJob) {
          expect(storedJob).to.be(null);
        });
    });

    it('fails to remove a locked job', function() {
      return Job.create(queue, 1, { foo: 'bar' }).then(function(job) {
        return job
          .takeLock()
          .then(function(lock) {
            expect(lock).to.be.truthy;
          })
          .then(function() {
            return Job.fromId(queue, job.id).then(function(job) {
              return job.remove();
            });
          })
          .then(function() {
            throw new Error('Should not be able to remove a locked job');
          })
          .catch(function(/*err*/) {
            // Good!
          });
      });
    });

    it('removes any job from active set', function() {
      return queue.add({ foo: 'bar' }).then(function(job) {
        // Simulate a job in active state but not locked
        return queue
          .getNextJob()
          .then(function() {
            return job
              .isActive()
              .then(function(isActive) {
                expect(isActive).to.be(true);
                return job.releaseLock();
              })
              .then(function() {
                return job.remove();
              });
          })
          .then(function() {
            return Job.fromId(queue, job.id);
          })
          .then(function(stored) {
            expect(stored).to.be(null);
            return job.getState();
          })
          .then(function(state) {
            // This check is a bit of a hack. A job that is not found in any list will return the state
            // stuck.
            expect(state).to.equal('stuck');
          });
      });
    });

    it('emits removed event', function(cb) {
      queue.once('removed', function(job) {
        expect(job.data.foo).to.be.equal('bar');
        cb();
      });
      Job.create(queue, { foo: 'bar' }).then(function(job) {
        job.remove();
      });
    });

    it('a succesful job should be removable', function(done) {
      queue.process(function() {
        return Promise.resolve();
      });

      queue.add({ foo: 'bar' });

      queue.on('completed', function(job) {
        job
          .remove()
          .then(done)
          .catch(done);
      });
    });

    it('a failed job should be removable', function(done) {
      queue.process(function() {
        throw new Error();
      });

      queue.add({ foo: 'bar' });

      queue.on('failed', function(job) {
        job
          .remove()
          .then(done)
          .catch(done);
      });
    });
  });

  describe('.retry', function() {
    it('emits waiting event', function(cb) {
      queue.add({ foo: 'bar' });
      queue.process(function(job, done) {
        done(new Error('the job failed'));
      });

      queue.once('failed', function(job) {
        queue.once('global:waiting', function(jobId2) {
          Job.fromId(queue, jobId2).then(function(job2) {
            expect(job2.data.foo).to.be.equal('bar');
            cb();
          });
        });
        queue.once('registered:global:waiting', function() {
          job.retry();
        });
      });
    });
  });

  describe('Locking', function() {
    var job;

    beforeEach(function() {
      return Job.create(queue, { foo: 'bar' }).then(function(createdJob) {
        job = createdJob;
      });
    });

    it('can take a lock', function() {
      return job
        .takeLock()
        .then(function(lockTaken) {
          expect(lockTaken).to.be.truthy;
        })
        .then(function() {
          return job.releaseLock().then(function(lockReleased) {
            expect(lockReleased).to.not.exist;
          });
        });
    });

    it('take an already taken lock', function() {
      return job
        .takeLock()
        .then(function(lockTaken) {
          expect(lockTaken).to.be.truthy;
        })
        .then(function() {
          return job.takeLock().then(function(lockTaken) {
            expect(lockTaken).to.be.truthy;
          });
        });
    });

    it('can release a lock', function() {
      return job
        .takeLock()
        .then(function(lockTaken) {
          expect(lockTaken).to.be.truthy;
        })
        .then(function() {
          return job.releaseLock().then(function(lockReleased) {
            expect(lockReleased).to.not.exist;
          });
        });
    });
  });

  describe('.progress', function() {
    it('can set and get progress', function() {
      return Job.create(queue, { foo: 'bar' }).then(function(job) {
        return job.progress(42).then(function() {
          return Job.fromId(queue, job.id).then(function(storedJob) {
            expect(storedJob.progress()).to.be(42);
          });
        });
      });
    });
  });

  describe('.moveToCompleted', function() {
    it('marks the job as completed', function() {
      return Job.create(queue, { foo: 'bar' }).then(function(job) {
        return job
          .isCompleted()
          .then(function(isCompleted) {
            expect(isCompleted).to.be(false);
          })
          .then(function() {
            return job.moveToCompleted('succeeded', true);
          })
          .then(function(/*moved*/) {
            return job.isCompleted().then(function(isCompleted) {
              expect(isCompleted).to.be(true);
              expect(job.returnvalue).to.be('succeeded');
            });
          });
      });
    });
  });

  describe('.moveToFailed', function() {
    it('marks the job as failed', function() {
      return Job.create(queue, { foo: 'bar' }).then(function(job) {
        return job
          .isFailed()
          .then(function(isFailed) {
            expect(isFailed).to.be(false);
          })
          .then(function() {
            return job.moveToFailed(new Error('test error'), true);
          })
          .then(function() {
            return job.isFailed().then(function(isFailed) {
              expect(isFailed).to.be(true);
              expect(job.stacktrace).not.be(null);
              expect(job.stacktrace.length).to.be(1);
            });
          });
      });
    });

    it('moves the job to wait for retry if attempts are given', function() {
      return Job.create(queue, { foo: 'bar' }, { attempts: 3 }).then(function(
        job
      ) {
        return job
          .isFailed()
          .then(function(isFailed) {
            expect(isFailed).to.be(false);
          })
          .then(function() {
            return job.moveToFailed(new Error('test error'), true);
          })
          .then(function() {
            return job.isFailed().then(function(isFailed) {
              expect(isFailed).to.be(false);
              expect(job.stacktrace).not.be(null);
              expect(job.stacktrace.length).to.be(1);
              return job.isWaiting().then(function(isWaiting) {
                expect(isWaiting).to.be(true);
              });
            });
          });
      });
    });

    it('marks the job as failed when attempts made equal to attempts given', function() {
      return Job.create(queue, { foo: 'bar' }, { attempts: 1 }).then(function(
        job
      ) {
        return job
          .isFailed()
          .then(function(isFailed) {
            expect(isFailed).to.be(false);
          })
          .then(function() {
            return job.moveToFailed(new Error('test error'), true);
          })
          .then(function() {
            return job.isFailed().then(function(isFailed) {
              expect(isFailed).to.be(true);
              expect(job.stacktrace).not.be(null);
              expect(job.stacktrace.length).to.be(1);
            });
          });
      });
    });

    it('moves the job to delayed for retry if attempts are given and backoff is non zero', function() {
      return Job.create(
        queue,
        { foo: 'bar' },
        { attempts: 3, backoff: 300 }
      ).then(function(job) {
        return job
          .isFailed()
          .then(function(isFailed) {
            expect(isFailed).to.be(false);
          })
          .then(function() {
            return job.moveToFailed(new Error('test error'), true);
          })
          .then(function() {
            return job.isFailed().then(function(isFailed) {
              expect(isFailed).to.be(false);
              expect(job.stacktrace).not.be(null);
              expect(job.stacktrace.length).to.be(1);
              return job.isDelayed().then(function(isDelayed) {
                expect(isDelayed).to.be(true);
              });
            });
          });
      });
    });

    it('applies stacktrace limit on failure', function() {
      var stackTraceLimit = 1;
      return Job.create(
        queue,
        { foo: 'bar' },
        { stackTraceLimit: stackTraceLimit }
      ).then(function(job) {
        return job
          .isFailed()
          .then(function(isFailed) {
            expect(isFailed).to.be(false);
          })
          .then(function() {
            return job.moveToFailed(new Error('test error'), true);
          })
          .then(function() {
            return job
              .moveToFailed(new Error('test error'), true)
              .then(function() {
                return job.isFailed().then(function(isFailed) {
                  expect(isFailed).to.be(true);
                  expect(job.stacktrace).not.be(null);
                  expect(job.stacktrace.length).to.be(stackTraceLimit);
                });
              });
          });
      });
    });
  });

  describe('.promote', function() {
    it('can promote a delayed job to be executed immediately', function() {
      return Job.create(queue, { foo: 'bar' }, { delay: 1500 }).then(function(
        job
      ) {
        return job
          .isDelayed()
          .then(function(isDelayed) {
            expect(isDelayed).to.be(true);
          })
          .then(function() {
            return job.promote();
          })
          .then(function() {
            return job.isDelayed().then(function(isDelayed) {
              expect(isDelayed).to.be(false);
              return job.isWaiting().then(function(isWaiting) {
                expect(isWaiting).to.be(true);
                return;
              });
            });
          });
      });
    });

    it('should not promote a job that is not delayed', function() {
      return Job.create(queue, { foo: 'bar' }).then(function(job) {
        return job
          .isDelayed()
          .then(function(isDelayed) {
            expect(isDelayed).to.be(false);
          })
          .then(function() {
            return job.promote();
          })
          .then(function() {
            throw new Error('Job should not be promoted!');
          })
          .catch(function(err) {
            expect(err).to.be.ok();
          });
      });
    });
  });

  // TODO:
  // Divide into several tests
  //
  var scripts = require('../lib/scripts');
  it('get job status', function() {
    this.timeout(12000);

    var client = new redis();
    return Job.create(queue, { foo: 'baz' }).then(function(job) {
      return job
        .isStuck()
        .then(function(isStuck) {
          expect(isStuck).to.be(false);
          return job.getState();
        })
        .then(function(state) {
          expect(state).to.be('waiting');
          return scripts.moveToActive(queue).then(function() {
            return job.moveToCompleted();
          });
        })
        .then(function() {
          return job.isCompleted();
        })
        .then(function(isCompleted) {
          expect(isCompleted).to.be(true);
          return job.getState();
        })
        .then(function(state) {
          expect(state).to.be('completed');
          return client.zrem(queue.toKey('completed'), job.id);
        })
        .then(function() {
          return job.moveToDelayed(Date.now() + 10000, true);
        })
        .then(function() {
          return job.isDelayed();
        })
        .then(function(yes) {
          expect(yes).to.be(true);
          return job.getState();
        })
        .then(function(state) {
          expect(state).to.be('delayed');
          return client.zrem(queue.toKey('delayed'), job.id);
        })
        .then(function() {
          return job.moveToFailed(new Error('test'), true);
        })
        .then(function() {
          return job.isFailed();
        })
        .then(function(isFailed) {
          expect(isFailed).to.be(true);
          return job.getState();
        })
        .then(function(state) {
          expect(state).to.be('failed');
          return client.zrem(queue.toKey('failed'), job.id);
        })
        .then(function(res) {
          expect(res).to.be(1);
          return job.getState();
        })
        .then(function(state) {
          expect(state).to.be('stuck');
          return client.rpop(queue.toKey('wait'));
        })
        .then(function() {
          return client.lpush(queue.toKey('paused'), job.id);
        })
        .then(function() {
          return job.isPaused();
        })
        .then(function(isPaused) {
          expect(isPaused).to.be(true);
          return job.getState();
        })
        .then(function(state) {
          expect(state).to.be('paused');
          return client.rpop(queue.toKey('paused'));
        })
        .then(function() {
          return client.lpush(queue.toKey('wait'), job.id);
        })
        .then(function() {
          return job.isWaiting();
        })
        .then(function(isWaiting) {
          expect(isWaiting).to.be(true);
          return job.getState();
        })
        .then(function(state) {
          expect(state).to.be('waiting');
        });
    });
  });

  describe('.finished', function() {
    it('should resolve when the job has been completed', function(done) {
      queue.process(function() {
        return Promise.delay(500);
      });
      queue
        .add({ foo: 'bar' })
        .then(function(job) {
          return job.finished();
        })
        .then(done, done);
    });

    it('should resolve when the job has been completed and return object', function(done) {
      queue.process(function(/*job*/) {
        return Promise.delay(500).then(function() {
          return { resultFoo: 'bar' };
        });
      });
      queue
        .add({ foo: 'bar' })
        .then(function(job) {
          return job.finished();
        })
        .then(function(jobResult) {
          expect(jobResult).to.be.an('object');
          expect(jobResult.resultFoo).equal('bar');
          done();
        });
    });

    it('should resolve when the job has been delayed and completed and return object', function(done) {
      queue.process(function(/*job*/) {
        return Promise.delay(300).then(function() {
          return { resultFoo: 'bar' };
        });
      });
      queue
        .add({ foo: 'bar' })
        .then(function(job) {
          return Promise.delay(600).then(function() {
            return job.finished();
          });
        })
        .then(function(jobResult) {
          expect(jobResult).to.be.an('object');
          expect(jobResult.resultFoo).equal('bar');
          done();
        });
    });

    it('should resolve when the job has been completed and return string', function(done) {
      queue.process(function(/*job*/) {
        return Promise.delay(500).then(function() {
          return 'a string';
        });
      });
      queue
        .add({ foo: 'bar' })
        .then(function(job) {
          return Promise.delay(600).then(function() {
            return job.finished();
          });
        })
        .then(function(jobResult) {
          expect(jobResult).to.be.an('string');
          expect(jobResult).equal('a string');
          done();
        });
    });

    it('should resolve when the job has been delayed and completed and return string', function(done) {
      queue.process(function(/*job*/) {
        return Promise.delay(300).then(function() {
          return 'a string';
        });
      });
      queue
        .add({ foo: 'bar' })
        .then(function(job) {
          return job.finished();
        })
        .then(function(jobResult) {
          expect(jobResult).to.be.an('string');
          expect(jobResult).equal('a string');
          done();
        });
    });

    it('should reject when the job has been failed', function(done) {
      queue.process(function() {
        return Promise.delay(500).then(function() {
          return Promise.reject(Error('test error'));
        });
      });
      queue
        .add({ foo: 'bar' })
        .then(function(job) {
          return job.finished();
        })
        .then(
          function() {
            done(Error('should have been rejected'));
          },
          function(err) {
            expect(err.message).equal('test error');
            done();
          }
        );
    });

    it('should resolve directly if already processed', function(done) {
      queue.process(function() {
        return Promise.resolve();
      });
      queue
        .add({ foo: 'bar' })
        .then(function(job) {
          return Promise.delay(500).then(function() {
            return job.finished();
          });
        })
        .then(function() {
          done();
        }, done);
    });

    it('should reject directly if already processed', function(done) {
      queue.process(function() {
        return Promise.reject(Error('test error'));
      });
      queue
        .add({ foo: 'bar' })
        .then(function(job) {
          return Promise.delay(500).then(function() {
            return job.finished();
          });
        })
        .then(
          function() {
            done(Error('should have been rejected'));
          },
          function(err) {
            expect(err.message).equal('test error');
            done();
          }
        );
    });
  });
});
