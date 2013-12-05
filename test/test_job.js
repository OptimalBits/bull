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
      }).otherwise(function(err){
        console.log(err);
        done(err);
      })
    }).otherwise(function(err){
      console.log(err);
      done(err);
    });
  });
  
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
    }).otherwise(function(err){
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
    }).otherwise(function(err){
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
    }).otherwise(function(err){
      done(err);
    });
    
  });
});

