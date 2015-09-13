/*eslint-env node */
/*global Promise:true */
'use strict';

var Job = require('../lib/job');
var Queue = require('../lib/queue');
var expect = require('expect.js');
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
          return job.moveToCompleted();
        }).then(function(){
          return job.isCompleted().then(function(isCompleted){
            expect(isCompleted).to.be(true);
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
          });
        });
      });
    });
  });


  describe('.promote', function() {
    var promoteQueue;

    beforeEach(function(done){
      promoteQueue = new Queue('promotequeue' + uuid(), 6379, '127.0.0.1');
      promoteQueue.once('ready', function() {
        promoteQueue.client.keys(promoteQueue.toKey('*'), function(err, keys){
          if(keys.length){
            promoteQueue.client.del(keys, function(err2){
              done(err2);
            });
          }else{
            done(err);
          }
        });
      });
    });

    it('promotes a delayed job to the waiting queue immediately', function(cb) {
      var delayTime = 5000;
      var firstJob;

      promoteQueue.client.once('message', function (channel, message) {
        expect(+message).to.be.a('number');

        expect(new Date(+message)).to.be.below(new Date(+new Date() + delayTime + 1));
        expect(new Date(+message)).to.be.above(new Date(+new Date() - 50));

        firstJob.promote();
      });

      promoteQueue.client.subscribe(promoteQueue.toKey('delayed'));

      promoteQueue.process(function (job, jobDone) {
        jobDone();
        cb();
      });

      promoteQueue.add({foo: 'bar'}, {delay: delayTime}).then(function(_job){
        firstJob = _job;
      });
    });


    it('delayed jobs scheduled after a promoted job should still execute', function(cb) {
      var delayTime = 1000;
      var secondJobOffset = 100;
      var jobsPromoted = 0;
      var jobsDone = 0;
      var firstJob;

      promoteQueue.client.once('message', function (channel, message) {
        expect(+message).to.be.a('number');

        expect(new Date(+message)).to.be.below(new Date(+new Date() + delayTime + 1));
        expect(new Date(+message)).to.be.above(new Date(+new Date() - 50));

        jobsPromoted += 1;
        expect(jobsPromoted).to.be(1);
        firstJob.promote();
      });

      promoteQueue.client.subscribe(promoteQueue.toKey('delayed'));

      promoteQueue.process(function (job, jobDone) {
        jobsDone++;
        jobDone();
        if(jobsDone >= 2){
          cb();
        }
      });

      promoteQueue.add({foo: 'bar'}, {delay: delayTime}).then(function(_job) {
        firstJob = _job;
      });

      promoteQueue.add({foo: 'bar2'}, {delay: delayTime + secondJobOffset});
    });
  });

});
