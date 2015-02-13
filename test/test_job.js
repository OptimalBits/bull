var Job = require('../lib/job');
var Queue = require('../lib/queue');
var expect = require('expect.js');


describe('Job', function(){
  var queue;

  before(function(done){
    queue = new Queue('test', 6379, '127.0.0.1');
    queue.client.keys(queue.toKey('*'), function(err, keys){
      if(keys.length){
        queue.client.del(keys, function(err){
          done(err);
        });
      }else{
        done();
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
          job = createdJob
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
            return Job.fromId(queue, job.jobId)
          })
          .then(function(storedJob){
            expect(storedJob).to.be(null);
          });
      })

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
        queue.once('waiting', function (job) {
          expect(job.data.foo).to.be.equal('bar');
          cb();
        });
        job.retry();
      });
    });
  });

  describe('Locking', function(){
    var id = 0;
    var job;

    beforeEach(function () {
      id++;
      return Job.create(queue, id, {foo: 'bar'})
        .then(function(createdJob){
          job = createdJob;
        });
    });

    it('can take a lock', function(){
      return job.takeLock('123').then(function(lockTaken){
        expect(lockTaken).to.be(true);
      });
    });

    it('cannot take an already taken lock', function(){
      return job.takeLock('123').then(function(lockTaken){
        expect(lockTaken).to.be(true);
      }).then(function(){
        return job.takeLock('123').then(function(lockTaken){
          expect(lockTaken).to.be(false);
        });
      });
    });

    it('can renew a previously taken lock', function(){
      return job.takeLock('123').then(function(lockTaken){
        expect(lockTaken).to.be(true);
      }).then(function(){
        return job.renewLock('123').then(function(lockRenewed){
          expect(lockRenewed).to.be(true);
        });
      });
    });

    it('can release a lock', function(){
      return job.takeLock('123').then(function(lockTaken){
        expect(lockTaken).to.be(true);
      }).then(function(){
        return job.releaseLock('321').then(function(lockReleased){
          expect(lockReleased).to.be(false);
        });
      }).then(function(){
        return job.releaseLock('123').then(function(lockReleased){
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
            return job.moveToFailed(Error("test error"));
          }).then(function(){
            return job.isFailed().then(function(isFailed){
              expect(isFailed).to.be(true);
              expect(job.stacktrace).not.be(null);
            });
          });
        });
      });
  });

});
