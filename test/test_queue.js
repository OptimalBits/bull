var Job = require('../lib/job');
var Queue = require('../lib/queue');
var expect = require('expect.js');

describe('Queue', function(){
  var queue;
  
  before(function(done){
    queue = new Queue('test queue', 6379, '127.0.0.1');
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
      expect(job.foo).to.be.equal('bar')
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
  
  it('process several jobs serially', function(done){
    var counter = 1;
    var maxJobs = 100;
    queue.process('serial job', function(job, jobDone){
      expect(job.num).to.be.equal(counter);
      expect(job.foo).to.be.equal('bar');
      jobDone();
      if(counter == maxJobs) done();
      counter++;
    });
    
    for(var i=1; i<=maxJobs; i++){
      queue.createJob('serial job', {foo: 'bar', num: i});
    }
  });

});
