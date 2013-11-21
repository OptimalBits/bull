var Job = require('../lib/job');
var Queue = require('../');
var expect = require('expect.js');

describe('Queue', function(){
  var queue;
  
  before(function(done){
    queue = Queue('test queue', 6379, '127.0.0.1');
    done()
  });
  
  it('create job', function(done){
    queue.createJob('test job', {foo: 'bar'}).then(function(job){
      expect(job.jobId).to.be.ok()
      expect(job.name).to.be('test job')
      done();
    }).otherwise(function(err){
      done(err);
    });
  });
  
  it('process a job', function(done){
    queue.process('test job type 2', function(job, jobDone){
      expect(job.data.foo).to.be.equal('bar')
      jobDone();
      done();
    })
    
    queue.createJob('test job type 2', {foo: 'bar'}).then(function(job){
      expect(job.jobId).to.be.ok()
      expect(job.name).to.be('test job type 2')
    }).otherwise(function(err){
      done(err);
    });
  });
  
  it('process a job that updates progress', function(done){
    queue.process('test job progress', function(job, jobDone){
      expect(job.data.foo).to.be.equal('bar')
      job.progress(42);
      jobDone();
    });
    
    queue.createJob('test job progress', {foo: 'bar'}).then(function(job){
      expect(job.jobId).to.be.ok()
      expect(job.name).to.be('test job progress');
    }).otherwise(function(err){
      done(err);
    });
    
    queue.on('progress', function(job, progress){
      expect(job).to.be.ok();
      expect(progress).to.be.eql(42);
      done();
    });
  });
  
  it('process a job that fails', function(done){
    var jobError = new Error("Job Failed");
    queue.process('test job fails', function(job, jobDone){
      expect(job.data.foo).to.be.equal('bar')
      jobDone(jobError);
    })
    
    queue.createJob('test job fails', {foo: 'bar'}).then(function(job){
      expect(job.jobId).to.be.ok()
      expect(job.name).to.be('test job fails')
    }).otherwise(function(err){
      done(err);
    });
    
    queue.once('failed', function(job, err){
      expect(job.jobId).to.be.ok()
      expect(job.name).to.be('test job fails')
      expect(err).to.be.eql(jobError);
      done();
    });
  });
  
  it('process a job that throws an exception', function(done){
    var jobError = new Error("Job Failed");
    queue.process('test job throws exception', function(job, jobDone){
      expect(job.data.foo).to.be.equal('bar')
      throw jobError;
    });
    
    queue.createJob('test job throws exception', {foo: 'bar'}).then(function(job){
      expect(job.jobId).to.be.ok()
      expect(job.name).to.be('test job throws exception')
    }).otherwise(function(err){
      done(err);
    });
    
    queue.once('failed', function(job, err){
      expect(job.jobId).to.be.ok()
      expect(job.name).to.be('test job throws exception')
      expect(err).to.be.eql(jobError);
      done();
    });
  });
  
  it.skip('retry a job that fails', function(done){
    var jobError = new Error("Job Failed");
    queue.process('test job fails retry', function(job, jobDone){
      expect(job.data.foo).to.be.equal('bar')
      jobDone(jobError);
    })
    
    queue.createJob('test job fails retry', {foo: 'bar'}).then(function(job){
      expect(job.jobId).to.be.ok()
      expect(job.name).to.be('test job fails retry')
    }).otherwise(function(err){
      done(err);
    });
    
    queue.once('failed', function(job, err){
      expect(job.jobId).to.be.ok()
      expect(job.name).to.be('test job fails retry')
      expect(err).to.be.eql(jobError);
      done();
    });
  });
  
  it('process several jobs serially', function(done){
    var counter = 1;
    var maxJobs = 100;
    queue.process('serial job', function(job, jobDone){
      expect(job.data.num).to.be.equal(counter);
      expect(job.data.foo).to.be.equal('bar');
      jobDone();
      if(counter == maxJobs) done();
      counter++;
    });
    
    for(var i=1; i<=maxJobs; i++){
      queue.createJob('serial job', {foo: 'bar', num: i});
    }
  });
  
});
