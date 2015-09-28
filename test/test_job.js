/*eslint-env node */
/*global Promise:true */
'use strict';

var Job = require('../lib/job');
var expect = require('expect.js');
var uuid = require('node-uuid');
var helper = require('./helper');

var prefix = 'bull-test-job';

describe('Job', function(){
  var queue;

  before(function(done){
    helper.removeTestKeys(prefix).then(function() {
      done();
    });
  });

  beforeEach(function(done) {
    queue = helper.buildQueue('test-' + uuid(), { prefix: prefix });
    queue.once('ready', function() {
      done();
    });
  });

  after(function(done) {
    helper.removeTestKeys(prefix).then(function() {
      done();
    });
  });

  describe('.create', function () {
    var job;
    var data;
    var opts;

    beforeEach(function (done) {
      data = {foo: 'bar'};
      opts = {testOpt: 'enabled'};

      return Job.create(queue, 1, data, opts)
        .then(function(createdJob){
          job = createdJob;
          done();
        }).catch(done);
    });

    it('returns a promise for the job', function () {
      expect(job).to.have.property('jobId');
      expect(job).to.have.property('data');
    });

    it('saves the job in redis', function (done) {
      return Job.fromId(queue, job.jobId).then(function(storedJob){
        expect(storedJob).to.have.property('jobId');
        expect(storedJob).to.have.property('data');

        expect(storedJob.data.foo).to.be.equal('bar');
        expect(storedJob.opts).to.be.a(Object);
        expect(storedJob.opts.testOpt).to.be('enabled');
        done();
      }).catch(done);
    });
  });

  describe('.remove', function () {
    it('removes the job from redis', function(done){
      return Job.create(queue, 1, {foo: 'bar'})
        .tap(function(job){
          return job.remove();
        })
        .then(function(job){
          return Job.fromId(queue, job.jobId);
        })
        .then(function(storedJob){
          expect(storedJob).to.be(null);
          done();
        }).catch(done);
    });

    it('emits removed event', function (done) {
      queue.once('removed', function (job) {
        expect(job.data.foo).to.be.equal('bar');
        done();
      });
      Job.create(queue, 1, {foo: 'bar'}).then(function(job){
        job.remove();
      }).catch(done);
    });
  });

  describe('.retry', function () {
    it('emits waiting event', function (done) {
      queue.add({foo: 'bar'}).catch(done);
      queue.process(function (job, jobDone) {
        jobDone(new Error('the job failed'));
      });
      queue.once('failed', function (job) {
        queue.once('waiting', function (job2) {
          expect(job2.data.foo).to.be.equal('bar');
          done();
        });
        job.retry().catch(done);
      });
    });
  });

  describe('Locking', function(){
    var id = 1000;
    var job;

    beforeEach(function (done) {
      id++;
      return Job.create(queue, id, {foo: 'bar'})
        .then(function(createdJob){
          job = createdJob;
          done();
        }).catch(done);
    });

    it('can take a lock', function(done){
      return job.takeLock('423').then(function(lockTaken){
        expect(lockTaken).to.be(true);
        return job.releaseLock('321');
      }).then(function(lockReleased){
        expect(lockReleased).to.be(false);
        done();
      }).catch(done);
    });

    it('cannot take an already taken lock', function(done){
      return job.takeLock('1234').then(function(lockTaken){
        expect(lockTaken).to.be(true);
        return job.takeLock('1234');
      }).then(function(lockTaken){
        expect(lockTaken).to.be(false);
        done();
      }).catch(done);
    });

    it('can renew a previously taken lock', function(done){
      return job.takeLock('1235').then(function(lockTaken){
        expect(lockTaken).to.be(true);
        return job.renewLock('1235');
      }).then(function(lockRenewed){
        expect(lockRenewed).to.be(true);
        done();
      }).catch(done);
    });

    it('can release a lock', function(done){
      return job.takeLock('1237').then(function(lockTaken){
        expect(lockTaken).to.be(true);
        return job.releaseLock('321');
      }).then(function(lockReleased){
        expect(lockReleased).to.be(false);
        return job.releaseLock('1237');
      }).then(function(lockReleased){
        expect(lockReleased).to.be(true);
        done();
      }).catch(done);
    });
  });

  describe('.progress', function () {
    it('can set and get progress', function (done) {
      var job = null;
      return Job.create(queue, 2, {foo: 'bar'}).then(function(result){
        job = result;
        expect(job).to.not.be(null);
        return job.progress(42);
      }).then(function(){
        return Job.fromId(queue, job.jobId);
      }).then(function(storedJob){
        expect(storedJob.progress()).to.be(42);
        done();
      }).catch(done);
    });
  });

  describe('.moveToCompleted', function () {
    it('marks the job as completed', function(done){
      var job = null;
      return Job.create(queue, 3, {foo: 'bar'}).then(function(result){
        job = result;
        expect(job).to.not.be(null);
        return job.isCompleted();
      }).then(function(isCompleted){
        expect(isCompleted).to.be(false);
        return job.moveToCompleted();
      }).then(function(){
        return job.isCompleted();
      }).then(function(isCompleted){
        expect(isCompleted).to.be(true);
        done();
      }).catch(done);
    });
  });

  describe('.moveToFailed', function () {
    it('marks the job as failed', function(done){
      var job = null;
      return Job.create(queue, 4, {foo: 'bar'}).then(function(result){
        job = result;
        expect(job).to.not.be(null);
        return job.isFailed();
      }).then(function(isFailed){
        expect(isFailed).to.be(false);
        return job.moveToFailed(new Error('test error'));
      }).then(function(){
        return job.isFailed();
      }).then(function(isFailed){
        expect(isFailed).to.be(true);
        expect(job.stacktrace).not.be(null);
        done();
      }).catch(done);
    });
  });

  describe('.getState', function() {
    it('get job status', function(done) {
      var job = null;
      return Job.create(queue, 100, {foo: 'baz'}).then(function(result) {
        job = result;
        expect(job).to.not.be(null);
        return job.isStuck();
      }).then(function(yes) {
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
        return queue.client.sremAsync(queue.toKey('completed'), job.jobId);
      }).then(function(){
        return job.moveToDelayed(Date.now() + 10000);
      }).then(function (){
        return job.isDelayed();
      }).then(function (yes) {
        expect(yes).to.be(true);
        return job.getState();
      }).then(function(state) {
        expect(state).to.be('delayed');
        return queue.client.zremAsync(queue.toKey('delayed'), job.jobId);
      }).then(function() {
        return job.moveToFailed(new Error('test'));
      }).then(function (){
        return job.isFailed();
      }).then(function (yes) {
        expect(yes).to.be(true);
        return job.getState();
      }).then(function(state) {
        expect(state).to.be('failed');
        return queue.client.sremAsync(queue.toKey('failed'), job.jobId);
      }).then(function(res) {
        expect(res).to.be(1);
        return job.getState();
      }).then(function(state) {
        expect(state).to.be('stuck');
        return queue.client.lpushAsync(queue.toKey('paused'), job.jobId);
      }).then(function() {
        return job.isPaused();
      }).then(function (yes) {
        expect(yes).to.be(true);
        return job.getState();
      }).then(function(state) {
        expect(state).to.be('paused');
        return queue.client.rpopAsync(queue.toKey('paused'));
      }).then(function() {
        return queue.client.lpushAsync(queue.toKey('wait'), job.jobId);
      }).then(function() {
        return job.isWaiting();
      }).then(function (yes) {
        expect(yes).to.be(true);
        return job.getState();
      }).then(function(state) {
        expect(state).to.be('waiting');
        done();
      }).catch(done);
    });
  });

});
