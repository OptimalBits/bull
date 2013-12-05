var Job = require('../lib/job');
var Queue = require('../');
var expect = require('expect.js');

describe('Queue', function(){
  var queue;
  
  beforeEach(function(done){
    queue = Queue('test queue 2', 6379, '127.0.0.1');
    done();
  });
  
  afterEach(function(done){
    queue.close();
    done();
  })

  it('process a job', function(done){
    queue.process(function(job, jobDone){
      expect(job.data.foo).to.be.equal('bar')
      jobDone();
      done();
    })
    
    queue.add({foo: 'bar'}).then(function(job){
      expect(job.jobId).to.be.ok()
      expect(job.data.foo).to.be('bar')
    }).otherwise(function(err){
      done(err);
    });
  });
  
  it('process a job that updates progress', function(done){
    queue.process(function(job, jobDone){
      expect(job.data.foo).to.be.equal('bar')
      job.progress(42);
      jobDone();
    });
    
    queue.add({foo: 'bar'}).then(function(job){
      expect(job.jobId).to.be.ok()
      expect(job.data.foo).to.be('bar');
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
    var jobError = Error("Job Failed");
    queue.process(function(job, jobDone){
      expect(job.data.foo).to.be.equal('bar')
      jobDone(jobError);
    })
    
    queue.add({foo: 'bar'}).then(function(job){
      expect(job.jobId).to.be.ok()
      expect(job.data.foo).to.be('bar')
    }).otherwise(function(err){
      done(err);
    });
    
    queue.once('failed', function(job, err){
      expect(job.jobId).to.be.ok()
      expect(job.data.foo).to.be('bar')
      expect(err).to.be.eql(jobError);
      done();
    });
  });
  
  it('process a job that throws an exception', function(done){
    var jobError = new Error("Job Failed");
    queue.process(function(job, jobDone){
      expect(job.data.foo).to.be.equal('bar')
      throw jobError;
    });
    
    queue.add({foo: 'bar'}).then(function(job){
      expect(job.jobId).to.be.ok()
      expect(job.data.foo).to.be('bar')
    }).otherwise(function(err){
      done(err);
    });
    
    queue.once('failed', function(job, err){
      expect(job.jobId).to.be.ok()
      expect(job.data.foo).to.be('bar')
      expect(err).to.be.eql(jobError);
      done();
    });
  });
  
  it.skip('retry a job that fails', function(done){
    var jobError = new Error("Job Failed");
    queue.process(function(job, jobDone){
      expect(job.data.foo).to.be.equal('bar')
      jobDone(jobError);
    })
    
    queue.add({foo: 'bar'}).then(function(job){
      expect(job.jobId).to.be.ok()
      expect(job.data.foo).to.be('bar')
    }).otherwise(function(err){
      done(err);
    });
    
    queue.once('failed', function(job, err){
      expect(job.jobId).to.be.ok()
      expect(job.data.foo).to.be('bar')
      expect(err).to.be.eql(jobError);
      done();
    });
  });
  
  it('process several jobs serially', function(done){
    var counter = 1;
    var maxJobs = 100;
    queue.process(function(job, jobDone){
      expect(job.data.num).to.be.equal(counter);
      expect(job.data.foo).to.be.equal('bar');
      jobDone();
      if(counter == maxJobs) done();
      counter++;
    });
    
    for(var i=1; i<=maxJobs; i++){
      queue.add({foo: 'bar', num: i});
    }
  });
  
  it('add a job to a paused queue', function(done){
    var ispaused = false;
    
    queue.process(function(job, jobDone){
      expect(ispaused).to.be(false);
      expect(job.data.foo).to.be.equal('paused');
      jobDone();
      done();
    });
    
    queue.pause();
    ispaused = true;
    
    queue.add({foo: 'paused'});
    
    setTimeout(function(){
      console.log("papagayo")
      ispaused = false;
      queue.resume();
    }, 1000); // We hope that this was enough to trigger a process if
    // we were not paused.
    
  });
  
});
