/*eslint-env node */
'use strict';

var redis = require('ioredis');

var utils = require('./utils');
var expect = require('chai').expect;
var Promise = require('bluebird');

var _ = require('lodash');

describe('Jobs getters', function() {
  this.timeout(12000);
  var queue;

  beforeEach(function() {
    var client = new redis();
    return client.flushdb();
  });

  beforeEach(function() {
    queue = utils.buildQueue();
  });

  afterEach(function() {
    this.timeout(
      queue.settings.stalledInterval * (1 + queue.settings.maxStalledCount)
    );
    return queue.clean(1000).then(function() {
      return queue.close();
    });
  });

  it('should get waiting jobs', function() {
    return Promise.join(
      queue.add({ foo: 'bar' }),
      queue.add({ baz: 'qux' })
    ).then(function() {
      return queue.getWaiting().then(function(jobs) {
        expect(jobs).to.be.a('array');
        expect(jobs.length).to.be.equal(2);
        expect(jobs[0].data.foo).to.be.equal('bar');
        expect(jobs[1].data.baz).to.be.equal('qux');
      });
    });
  });

  it('should get paused jobs', function() {
    return queue.pause().then(function() {
      return Promise.join(
        queue.add({ foo: 'bar' }),
        queue.add({ baz: 'qux' })
      ).then(function() {
        return queue.getWaiting().then(function(jobs) {
          expect(jobs).to.be.a('array');
          expect(jobs.length).to.be.equal(2);
          expect(jobs[0].data.foo).to.be.equal('bar');
          expect(jobs[1].data.baz).to.be.equal('qux');
        });
      });
    });
  });

  it('should get active jobs', function(done) {
    queue.process(function(job, jobDone) {
      queue.getActive().then(function(jobs) {
        expect(jobs).to.be.a('array');
        expect(jobs.length).to.be.equal(1);
        expect(jobs[0].data.foo).to.be.equal('bar');
        done();
      });
      jobDone();
    });

    queue.add({ foo: 'bar' });
  });

  it('should get a specific job', function(done) {
    var data = { foo: 'sup!' };
    queue.add(data).then(function(job) {
      queue.getJob(job.id).then(function(returnedJob) {
        expect(returnedJob.data).to.eql(data);
        expect(returnedJob.id).to.be.eql(job.id);
        done();
      });
    });
  });

  it('should get completed jobs', function(done) {
    var counter = 2;

    queue.process(function(job, jobDone) {
      jobDone();
    });

    queue.on('completed', function() {
      counter--;

      if (counter === 0) {
        queue.getCompleted().then(function(jobs) {
          expect(jobs).to.be.a('array');
          // We need a "empty completed" kind of function.
          //expect(jobs.length).to.be.equal(2);
          done();
        });
      }
    });

    queue.add({ foo: 'bar' });
    queue.add({ baz: 'qux' });
  });

  it('should get failed jobs', function(done) {
    var counter = 2;

    queue.process(function(job, jobDone) {
      jobDone(new Error('Forced error'));
    });

    queue.on('failed', function() {
      counter--;

      if (counter === 0) {
        queue.getFailed().then(function(jobs) {
          expect(jobs).to.be.a('array');
          done();
        });
      }
    });

    queue.add({ foo: 'bar' });
    queue.add({ baz: 'qux' });
  });

  it('fails jobs that exceed their specified timeout', function(done) {
    queue.process(function(job, jobDone) {
      setTimeout(jobDone, 150);
    });

    queue.on('failed', function(job, error) {
      expect(error.message).to.be.eql('operation timed out');
      done();
    });

    queue.on('completed', function() {
      var error = new Error('The job should have timed out');
      done(error);
    });

    queue.add(
      { some: 'data' },
      {
        timeout: 100
      }
    );
  });

  it('should return all completed jobs when not setting start/end', function(done) {
    queue.process(function(job, completed) {
      completed();
    });

    queue.on(
      'completed',
      _.after(3, function() {
        queue
          .getJobs('completed')
          .then(function(jobs) {
            expect(jobs)
              .to.be.an('array')
              .that.have.length(3);
            expect(jobs[0]).to.have.property('finishedOn');
            expect(jobs[1]).to.have.property('finishedOn');
            expect(jobs[2]).to.have.property('finishedOn');

            expect(jobs[0]).to.have.property('processedOn');
            expect(jobs[1]).to.have.property('processedOn');
            expect(jobs[2]).to.have.property('processedOn');
            done();
          })
          .catch(done);
      })
    );

    queue.add({ foo: 1 });
    queue.add({ foo: 2 });
    queue.add({ foo: 3 });
  });

  it('should return all failed jobs when not setting start/end', function(done) {
    queue.process(function(job, completed) {
      completed(new Error('error'));
    });

    queue.on(
      'failed',
      _.after(3, function() {
        queue
          .getJobs('failed')
          .then(function(jobs) {
            expect(jobs)
              .to.be.an('array')
              .that.has.length(3);
            expect(jobs[0]).to.have.property('finishedOn');
            expect(jobs[1]).to.have.property('finishedOn');
            expect(jobs[2]).to.have.property('finishedOn');

            expect(jobs[0]).to.have.property('processedOn');
            expect(jobs[1]).to.have.property('processedOn');
            expect(jobs[2]).to.have.property('processedOn');
            done();
          })
          .catch(done);
      })
    );

    queue.add({ foo: 1 });
    queue.add({ foo: 2 });
    queue.add({ foo: 3 });
  });

  it('should return subset of jobs when setting positive range', function(done) {
    queue.process(function(job, completed) {
      completed();
    });

    queue.on(
      'completed',
      _.after(3, function() {
        queue
          .getJobs('completed', 1, 2, true)
          .then(function(jobs) {
            expect(jobs)
              .to.be.an('array')
              .that.has.length(2);
            expect(jobs[0].data.foo).to.be.eql(2);
            expect(jobs[1].data.foo).to.be.eql(3);
            expect(jobs[0]).to.have.property('finishedOn');
            expect(jobs[1]).to.have.property('finishedOn');
            expect(jobs[0]).to.have.property('processedOn');
            expect(jobs[1]).to.have.property('processedOn');
            done();
          })
          .catch(done);
      })
    );

    queue
      .add({ foo: 1 })
      .then(function() {
        return queue.add({ foo: 2 });
      })
      .then(function() {
        return queue.add({ foo: 3 });
      });
  });

  it('should return subset of jobs when setting a negative range', function(done) {
    queue.process(function(job, completed) {
      completed();
    });

    queue.on(
      'completed',
      _.after(3, function() {
        queue
          .getJobs('completed', -3, -1, true)
          .then(function(jobs) {
            expect(jobs)
              .to.be.an('array')
              .that.has.length(3);
            expect(jobs[0].data.foo).to.be.equal(1);
            expect(jobs[1].data.foo).to.be.eql(2);
            expect(jobs[2].data.foo).to.be.eql(3);
            done();
          })
          .catch(done);
      })
    );

    queue.add({ foo: 1 });
    queue.add({ foo: 2 });
    queue.add({ foo: 3 });
  });

  it('should return subset of jobs when range overflows', function(done) {
    queue.process(function(job, completed) {
      completed();
    });

    queue.on(
      'completed',
      _.after(3, function() {
        queue
          .getJobs('completed', -300, 99999, true)
          .then(function(jobs) {
            expect(jobs)
              .to.be.an('array')
              .that.has.length(3);
            expect(jobs[0].data.foo).to.be.equal(1);
            expect(jobs[1].data.foo).to.be.eql(2);
            expect(jobs[2].data.foo).to.be.eql(3);
            done();
          })
          .catch(done);
      })
    );

    queue.add({ foo: 1 });
    queue.add({ foo: 2 });
    queue.add({ foo: 3 });
  });

  it('should return jobs for multiple types', function(done) {
    var counter = 0;
    queue.process(function(job) {
      counter++;
      if (counter == 2) {
        return queue.pause();
      }
    });

    queue.on(
      'completed',
      _.after(2, function() {
        queue
          .getJobs(['completed', 'paused'])
          .then(function(jobs) {
            expect(jobs).to.be.an('array');
            expect(jobs).to.have.length(3);
            done();
          })
          .catch(done);
      })
    );

    queue.add({ foo: 1 });
    queue.add({ foo: 2 });
    queue.add({ foo: 3 });
  });
});
