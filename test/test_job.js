/*eslint-env node */
'use strict';

var Job = require('../lib/job');
var Queue = require('../lib/queue');
var expect = require('expect.js');
var redis = require('redis');
var Promise = require('bluebird');
var uuid = require('node-uuid');

Promise.promisifyAll(redis.RedisClient.prototype);
Promise.promisifyAll(redis.Multi.prototype);

describe('Job', function(){
  var queue;

  beforeEach(function(){
    var client = redis.createClient();
    return client.flushdbAsync();
  });

  beforeEach(function(){
    queue = new Queue('test-' + uuid(), 6379, '127.0.0.1');
  });

  afterEach(function(){
    return queue.close();
  });

  describe('.create', function () {
    var job;
    var data;
    var opts;

    beforeEach(function () {
      data = {foo: 'bar'};
      opts = {testOpt: 'enabled'};

      return Job.create(queue, data, opts).then(function(createdJob){
        job = createdJob;
      });
    });

    it('returns a promise for the job', function () {
      expect(job).to.have.property('jobId');
      expect(job).to.have.property('data');
    });

    it('saves the job in redis', function () {
      return Job.fromId(queue, job.jobId).then(function(storedJob){
        expect(storedJob).to.have.property('jobId');
        expect(storedJob).to.have.property('data');

        expect(storedJob.data.foo).to.be.equal('bar');
        expect(storedJob.opts).to.be.a(Object);
        expect(storedJob.opts.testOpt).to.be('enabled');
      });
    });

    it('should use the custom jobId if one is provided', function() {
      var customJobId = 'customjob';
      return Job.create(queue, data, { jobId: customJobId }).then(function(createdJob){
        expect(createdJob.jobId).to.be.equal(customJobId);
      });
    });

    it('should process jobs with custom jobIds', function(done) {
      var customJobId = 'customjob';
      queue.process(function () {
        return Promise.resolve();
      });

      queue.add({ foo: 'bar' }, { jobId: customJobId });

      queue.on('completed', function(job) {
        if (job.opts.jobId == customJobId) {
          done();
        }
      });
    });
  });

  describe('.remove', function () {
    it('removes the job from redis', function(){
      return Job.create(queue, {foo: 'bar'})
        .tap(function(job){
          return job.remove();
        })
        .then(function(job){
          return Job.fromId(queue, job.jobId);
        })
        .then(function(storedJob){
          expect(storedJob).to.be(null);
        });
    });

    it('fails to remove a locked job', function() {
      var token = uuid();
      return Job.create(queue, 1, {foo: 'bar'}).then(function(job) {
        return job.takeLock(token).then(function(lock) {
          expect(lock).to.be(true);
        }).then(function() {
          return job.remove(token);
        }).then(function() {
          throw new Error('Should not be able to remove a locked job');
        }).catch(function(err) {
          expect(err.message).to.equal('Could not get lock for job: ' + job.jobId + '. Cannot remove job.');
        });
      });
    });

    it('removes any job from active set', function() {
      return queue.add({ foo: 'bar' }).then(function(job) {
        // Simulate a job in active state but not locked
        return queue.moveJob('wait', 'active').then(function() {
          return job.isActive().then(function(isActive) {
            expect(isActive).to.be(true);
            return job.remove();
          });
        }).then(function() {
          return Job.fromId(queue, job.jobId);
        }).then(function(stored) {
          expect(stored).to.be(null);
          return job.getState();
        }).then(function(state) {
          // This check is a bit of a hack. A job that is not found in any list will return the state
          // stuck.
          expect(state).to.equal('stuck');
        });
      });
    });

    it('emits removed event', function (cb) {
      queue.once('removed', function (job) {
        expect(job.data.foo).to.be.equal('bar');
        cb();
      });
      Job.create(queue, {foo: 'bar'}).then(function(job){
        job.remove();
      });
    });

    it('a succesful job should be removable', function(done) {
      queue.process(function () {
        return Promise.resolve();
      });

      queue.add({ foo: 'bar' });

      queue.on('completed', function(job) {
        job.remove().then(done).catch(done);
      });
    });

    it('a failed job should be removable', function(done) {
      queue.process(function () {
        throw new Error();
      });

      queue.add({ foo: 'bar' });

      queue.on('failed', function(job) {
        job.remove().then(done).catch(done);
      });
    });
  });

  describe('.retry', function () {
    it('emits waiting event', function (cb) {
      queue.add({foo: 'bar'});
      queue.process(function (job, done) {
        done(new Error('the job failed'));
      });
      queue.once('failed', function (job) {
        queue.once('waiting', function (job2) {
          expect(job2.data.foo).to.be.equal('bar');
          cb();
        });
        job.retry();
      });
    });
  });

  describe('Locking', function(){
    var id = 1000;
    var job;

    beforeEach(function () {
      id++;
      return Job.create(queue, {foo: 'bar'}).then(function(createdJob){
        job = createdJob;
      });
    });

    it('can take a lock', function(){
      return job.takeLock('423').then(function(lockTaken){
        expect(lockTaken).to.be(true);
      }).then(function(){
        return job.releaseLock('321').then(function(lockReleased){
          expect(lockReleased).to.be(false);
        });
      });
    });

    it('cannot take an already taken lock', function(){
      return job.takeLock('1234').then(function(lockTaken){
        expect(lockTaken).to.be(true);
      }).then(function(){
        return job.takeLock('1234').then(function(lockTaken){
          expect(lockTaken).to.be(false);
        });
      });
    });

    it('can renew a previously taken lock', function(){
      return job.takeLock('1235').then(function(lockTaken){
        expect(lockTaken).to.be(true);
      }).then(function(){
        return job.renewLock('1235').then(function(lockRenewed){
          expect(lockRenewed).to.be(true);
        });
      });
    });

    it('can release a lock', function(){
      return job.takeLock('1237').then(function(lockTaken){
        expect(lockTaken).to.be(true);
      }).then(function(){
        return job.releaseLock('321').then(function(lockReleased){
          expect(lockReleased).to.be(false);
        });
      }).then(function(){
        return job.releaseLock('1237').then(function(lockReleased){
          expect(lockReleased).to.be(true);
        });
      });
    });
  });

  describe('.progress', function () {
    it('can set and get progress', function () {
      return Job.create(queue, {foo: 'bar'}).then(function(job){
        return job.progress(42).then(function(){
          return Job.fromId(queue, job.jobId).then(function(storedJob){
            expect(storedJob.progress()).to.be(42);
          });
        });
      });
    });
  });

  describe('.moveToCompleted', function () {
    it('marks the job as completed', function(){
      return Job.create(queue, {foo: 'bar'}).then(function(job){
        return job.isCompleted().then(function(isCompleted){
          expect(isCompleted).to.be(false);
        }).then(function(){
          return job.moveToCompleted('succeeded');
        }).then(function(){
          return job.isCompleted().then(function(isCompleted){
            expect(isCompleted).to.be(true);
            expect(job.returnvalue).to.be('succeeded');
          });
        });
      });
    });
  });

  describe('.moveToFailed', function () {
    it('marks the job as failed', function(){
      return Job.create(queue, {foo: 'bar'}).then(function(job){
        return job.isFailed().then(function(isFailed){
          expect(isFailed).to.be(false);
        }).then(function(){
          return job.moveToFailed(new Error('test error'));
        }).then(function(){
          return job.isFailed().then(function(isFailed){
            expect(isFailed).to.be(true);
            expect(job.stacktrace).not.be(null);
            expect(job.stacktrace.length).to.be(1);
          });
        });
      });
    });

    it('moves the job to wait for retry if attempts are given', function() {
      return Job.create(queue, {foo: 'bar'}, {attempts: 3}).then(function(job){
        return job.isFailed().then(function(isFailed){
          expect(isFailed).to.be(false);
        }).then(function(){
          return job.moveToFailed(new Error('test error'));
        }).then(function(){
          return job.isFailed().then(function(isFailed){
            expect(isFailed).to.be(false);
            expect(job.stacktrace).not.be(null);
            expect(job.stacktrace.length).to.be(1);
            return job.isWaiting().then(function(isWaiting){
              expect(isWaiting).to.be(true);
            });
          });
        });
      });
    });

    it('marks the job as failed when attempts made equal to attempts given', function() {
      return Job.create(queue, {foo: 'bar'}, {attempts: 1}).then(function(job){
        return job.isFailed().then(function(isFailed){
          expect(isFailed).to.be(false);
        }).then(function(){
          return job.moveToFailed(new Error('test error'));
        }).then(function(){
          return job.isFailed().then(function(isFailed){
            expect(isFailed).to.be(true);
            expect(job.stacktrace).not.be(null);
            expect(job.stacktrace.length).to.be(1);
          });
        });
      });
    });

    it('moves the job to delayed for retry if attempts are given and backoff is non zero', function() {
      return Job.create(queue, {foo: 'bar'}, {attempts: 3, backoff: 300}).then(function(job){
        return job.isFailed().then(function(isFailed){
          expect(isFailed).to.be(false);
        }).then(function(){
          return job.moveToFailed(new Error('test error'));
        }).then(function(){
          return job.isFailed().then(function(isFailed){
            expect(isFailed).to.be(false);
            expect(job.stacktrace).not.be(null);
            expect(job.stacktrace.length).to.be(1);
            return job.isDelayed().then(function(isDelayed){
              expect(isDelayed).to.be(true);
            });
          });
        });
      });
    });

  });

  describe('.promote', function() {

    it('can promote a delayed job to be executed immediately', function() {
      return Job.create(queue, {foo: 'bar'}, {delay: 1500}).then(function(job){
        return job.isDelayed().then(function(isDelayed) {
          expect(isDelayed).to.be(true);
        }).then(function() {
          return job.promote();
        }).then(function() {
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
      return Job.create(queue, {foo: 'bar'}).then(function(job){
        return job.isDelayed().then(function(isDelayed) {
          expect(isDelayed).to.be(false);
        }).then(function() {
          return job.promote();
        }).then(function() {
          throw new Error('Job should not be promoted!');
        }).catch(function(err) {
          expect(err).to.be.ok();
        });
      });
    });

  });

  // TODO:
  // Divide into several tests
  //
  it('get job status', function() {
    this.timeout(12000);

    var client = Promise.promisifyAll(redis.createClient());
    return Job.create(queue, {foo: 'baz'}).then(function(job) {
      return job.isStuck().then(function(isStuck) {
        expect(isStuck).to.be(false);
        return job.getState();
      }).then(function(state) {
        expect(state).to.be('waiting');
        return job.move('wait', 'completed');
      }).then(function (){
        return job.isCompleted();
      }).then(function (isCompleted) {
        expect(isCompleted).to.be(true);
        return job.getState();
      }).then(function(state) {
        expect(state).to.be('completed');
        return client.sremAsync(queue.toKey('completed'), job.jobId);
      }).then(function(){
        return job.moveToDelayed(Date.now() + 10000);
      }).then(function (){
        return job.isDelayed();
      }).then(function (yes) {
        expect(yes).to.be(true);
        return job.getState();
      }).then(function(state) {
        expect(state).to.be('delayed');
        return client.zremAsync(queue.toKey('delayed'), job.jobId);
      }).then(function() {
        return job.moveToFailed(new Error('test'));
      }).then(function (){
        return job.isFailed();
      }).then(function (isFailed) {
        expect(isFailed).to.be(true);
        return job.getState();
      }).then(function(state) {
        expect(state).to.be('failed');
        return client.sremAsync(queue.toKey('failed'), job.jobId);
      }).then(function(res) {
        expect(res).to.be(1);
        return job.getState();
      }).then(function(state) {
        expect(state).to.be('stuck');
        return client.rpopAsync(queue.toKey('wait'));
      }).then(function(){
        return client.lpushAsync(queue.toKey('paused'), job.jobId);
      }).then(function() {
        return job.isPaused();
      }).then(function (isPaused) {
        expect(isPaused).to.be(true);
        return job.getState();
      }).then(function(state) {
        expect(state).to.be('paused');
        return client.rpopAsync(queue.toKey('paused'));
      }).then(function() {
        return client.lpushAsync(queue.toKey('wait'), job.jobId);
      }).then(function() {
        return job.isWaiting();
      }).then(function (isWaiting) {
        expect(isWaiting).to.be(true);
        return job.getState();
      }).then(function(state) {
        expect(state).to.be('waiting');
      });
    });
  });

  describe('.finished', function() {
    it('should resolve when the job has been completed', function(done){
      queue.process(function () {
        return Promise.resolve();
      });
      queue.add({ foo: 'bar' }).then(function(job){
        return job.finished();
      }).then(function(){
        done();
      }, done);
    });

    it('should reject when the job has been completed', function(done){
      queue.process(function () {
        return Promise.reject(Error('test error'));
      });
      queue.add({ foo: 'bar' }).then(function(job){
        return job.finished();
      }).then(function(){
        done(Error('should have been rejected'));
      }, function(err){
        expect(err.message).equal('test error');
        done();
      });
    });

    it('should resolve directly if already processed', function(done){
      queue.process(function () {
        return Promise.resolve();
      });
      queue.add({ foo: 'bar' }).then(function(job){
        return Promise.delay(1500).then(function(){
          return job.finished();
        })
      }).then(function(){
        done();
      }, done);
    });

    it('should reject directly if already processed', function(done){
      queue.process(function () {
        return Promise.reject(Error('test error'));
      });
      queue.add({ foo: 'bar' }).then(function(job){
        return Promise.delay(1500).then(function(){
          return job.finished();
        });
      }).then(function(){
        done(Error('should have been rejected'));
      }, function(err){
        expect(err.message).equal('test error');
        done();
      });
    });

    it.skip('should resolve using the watchdog if pubsub was lost');
    it.skip('should reject using the watchdog if pubsub was lost');

  });
});
