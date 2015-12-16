/*eslint-env node */
/*global Promise:true */
'use strict';

var Job = require('../lib/job');
var Queue = require('../lib/queue');
var expect = require('expect.js');
var redis = require('redis');
var Promise = require('bluebird');
var uuid = require('node-uuid');

describe('Job', function(){
  var queue;

  before(function(done){
    queue = new Queue('test', 6379, '127.0.0.1');
    queue.client.keys(queue.toKey('*'), function(err, keys){
      if(keys.length){
        queue.client.del(keys, function(err2){
          done(err2);
        });
      }else{
        done(err);
      }
    });
  });

  beforeEach(function() {
    queue = new Queue('test-' + uuid(), 6379, '127.0.0.1');
  });

  describe('.create', function () {
    var job;
    var data;
    var opts;

    beforeEach(function () {
      data = {foo: 'bar'};
      opts = {testOpt: 'enabled'};

      return Job.create(queue, 1, data, opts)
        .then(function(createdJob){
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
  });

  describe('.remove', function () {
    it('removes the job from redis', function(){
      return Job.create(queue, 1, {foo: 'bar'})
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

    it('emits removed event', function (cb) {
      queue.once('removed', function (job) {
        expect(job.data.foo).to.be.equal('bar');
        cb();
      });
      Job.create(queue, 1, {foo: 'bar'}).then(function(job){
        job.remove();
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
      return Job.create(queue, id, {foo: 'bar'})
        .then(function(createdJob){
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
      return Job.create(queue, 2, {foo: 'bar'}).then(function(job){
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
      return Job.create(queue, 3, {foo: 'bar'}).then(function(job){
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
      return Job.create(queue, 4, {foo: 'bar'}).then(function(job){
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
      return Job.create(queue, 5, {foo: 'bar'}, {attempts: 3}).then(function(job){
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
      return Job.create(queue, 6, {foo: 'bar'}, {attempts: 1}).then(function(job){
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
      return Job.create(queue, 7, {foo: 'bar'}, {attempts: 3, backoff: 300}).then(function(job){
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
      return Job.create(queue, 8, {foo: 'bar'}, {delay: 1500}).then(function(job){
        var delay = job.timestamp + job.delay;
        return job._addToDelayed(delay).then(function() {
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
    });

    it('should not promote a job that is not delayed', function() {
      return Job.create(queue, 9, {foo: 'bar'}).then(function(job){
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

  it('get job status', function() {
    var client = Promise.promisifyAll(redis.createClient());
    return Job.create(queue, 100, {foo: 'baz'}).then(function(job) {
      return job.isStuck().then(function(yes) {
        expect(yes).to.be(true);
        return job.getState();
      }).then(function(state) {
        expect(state).to.be('stuck');
        return job.moveToCompleted();
      }).then(function (){
        return job.isCompleted();
      }).then(function (yes) {
        expect(yes).to.be(true);
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
      }).then(function (yes) {
        expect(yes).to.be(true);
        return job.getState();
      }).then(function(state) {
        expect(state).to.be('failed');
        return client.sremAsync(queue.toKey('failed'), job.jobId);
      }).then(function(res) {
        expect(res).to.be(1);
        return job.getState();
      }).then(function(state) {
        expect(state).to.be('stuck');
        return client.lpushAsync(queue.toKey('paused'), job.jobId);
      }).then(function() {
        return job.isPaused();
      }).then(function (yes) {
        expect(yes).to.be(true);
        return job.getState();
      }).then(function(state) {
        expect(state).to.be('paused');
        return client.rpopAsync(queue.toKey('paused'));
      }).then(function() {
        return client.lpushAsync(queue.toKey('wait'), job.jobId);
      }).then(function() {
        return job.isWaiting();
      }).then(function (yes) {
        expect(yes).to.be(true);
        return job.getState();
      }).then(function(state) {
        expect(state).to.be('waiting');
      });
    });
  });

});
