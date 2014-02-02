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

  it('create', function(done){
    Job.create(queue, 1, {foo: 'bar'}).then(function(job){
      expect(job).to.have.property('jobId');
      expect(job).to.have.property('data');
    
      expect(job.data.foo).to.be.equal('bar');
      
      Job.fromId(queue, job.jobId).then(function(storedJob){
        expect(storedJob).to.have.property('jobId');
        expect(storedJob).to.have.property('data');
    
        expect(storedJob.data.foo).to.be.equal('bar');
        done();
      }, function(err){
        console.log(err);
        done(err);
      })
    }, function(err){
      console.log(err);
      done(err);
    });
  });
  
  it('remove', function(done){
    Job.create(queue, 1, {foo: 'bar'}).then(function(job){
      expect(job).to.have.property('jobId');
      expect(job).to.have.property('data');
    
      expect(job.data.foo).to.be.equal('bar');
      
      job.remove().then(function(){
        Job.fromId(queue, job.jobId).then(function(storedJob){
          expect(storedJob).to.be(null);
          done();
        }, function(err){
          done(err);
        });
      }, function(err){
        done(err);
      });
    }, function(err){
      done(err);
    });
  })
  
  
  describe('Locking', function(){
    it('take a lock', function(done){
      Job.create(queue, 1, {foo: 'bar'}).then(function(job){
        expect(job).to.have.property('jobId');
        expect(job).to.have.property('data');
        
        return job.takeLock('123').then(function(lockTaken){
          expect(lockTaken).to.be(true);
        });
      }).then(done, function(err){
        console.log(err);
        done(err);
      });
    });
    
    it('take an already taken lock', function(done){
      Job.create(queue, 2, {foo: 'bar'}).then(function(job){
        expect(job).to.have.property('jobId');
        expect(job).to.have.property('data');
        
        return job.takeLock('123').then(function(lockTaken){
          expect(lockTaken).to.be(true);
        }).then(function(){
          return job.takeLock('123').then(function(lockTaken){
            expect(lockTaken).to.be(false);
          });
        })
      }).then(done, function(err){
        console.log(err);
        done(err);
      });
    });
    
    it('renew a taken lock', function(done){
      Job.create(queue, 3, {foo: 'bar'}).then(function(job){
        expect(job).to.have.property('jobId');
        expect(job).to.have.property('data');
        
        return job.takeLock('123').then(function(lockTaken){
          expect(lockTaken).to.be(true);
        }).then(function(){
          return job.renewLock('123').then(function(lockRenewed){
            expect(lockRenewed).to.be(true);
          });
        });
      }).then(done, function(err){
        console.log(err);
        done(err);
      });
    });
    
    it('release a lock', function(done){
      Job.create(queue, 4, {foo: 'bar'}).then(function(job){
        expect(job).to.have.property('jobId');
        expect(job).to.have.property('data');
        
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
      }).then(done, function(err){
        console.log(err);
        done(err);
      });
    });
  })
  
  
  it('report progress', function(done){
    Job.create(queue, 2, {foo: 'bar'}).then(function(job){
      expect(job).to.have.property('jobId');
      expect(job).to.have.property('data');

      expect(job.data.foo).to.be.equal('bar');
      expect(job.progress()).to.be(0);

      return job.progress(42).then(function(){
        return Job.fromId(queue, job.jobId).then(function(storedJob){
          expect(storedJob.progress()).to.be(42);
          done();
        });
      });
    }, function(err){
      console.log(err);
      done(err);
    });
  });
  
  it('completed', function(done){
    Job.create(queue, 3, {foo: 'bar'}).then(function(job){
      return job.isCompleted().then(function(isCompleted){
        expect(isCompleted).to.be(false);
      }).then(function(){
        return job.completed();
      }).then(function(){
        return job.isCompleted().then(function(isCompleted){
          expect(isCompleted).to.be(true);
          done();
        });
      });
    }, function(err){
      done(err);
    });
  });
  
  it('failed', function(done){
    Job.create(queue, 4, {foo: 'bar'}).then(function(job){
      return job.isFailed().then(function(isFailed){
        expect(isFailed).to.be(false);
      }).then(function(){
        return job.failed(Error("test error"));
      }).then(function(){
        return job.isFailed().then(function(isFailed){
          expect(isFailed).to.be(true);
          done();
        });
      });
    }, function(err){
      done(err);
    });
    
  });
});

