/*eslint-env node */
'use strict';

var utils = require('./utils');
var redis = require('ioredis');

var Queue = require('../');
var Job = require('../lib/job');
var expect = require('chai').expect;

var _ = require('lodash');

describe('events', function() {
  var queue;

  beforeEach(function() {
    var client = new redis();
    return client.flushdb().then(function() {
      queue = utils.buildQueue('test events', {
        settings: {
          stalledInterval: 100,
          lockDuration: 50
        }
      });
      return queue;
    });
  });

  afterEach(function() {
    return queue.close();
  });

  it('should emit waiting when a job has been added', function(done) {
    queue.on('waiting', function() {
      done();
    });

    queue.on('registered:waiting', function() {
      queue.add({ foo: 'bar' });
    });
  });

  it('should emit global:waiting when a job has been added', function(done) {
    queue.on('global:waiting', function() {
      done();
    });

    queue.on('registered:global:waiting', function() {
      queue.add({ foo: 'bar' });
    });
  });

  it('should emit stalled when a job has been stalled', function(done) {
    queue.on('completed', function(/*job*/) {
      done(new Error('should not have completed'));
    });

    queue.process(function(/*job*/) {
      return Promise.delay(250);
    });

    queue.add({ foo: 'bar' });

    var queue2 = utils.buildQueue('test events', {
      settings: {
        stalledInterval: 100
      }
    });

    queue2.on('stalled', function(/*job*/) {
      queue2.close().then(done);
    });

    queue.on('active', function() {
      queue2.startMoveUnlockedJobsToWait();
      queue.close(true);
    });
  });

  it('should emit global:stalled when a job has been stalled', function(done) {
    queue.on('completed', function(/*job*/) {
      done(new Error('should not have completed'));
    });

    queue.process(function(/*job*/) {
      return Promise.delay(250);
    });

    queue.add({ foo: 'bar' });

    var queue2 = utils.buildQueue('test events', {
      settings: {
        stalledInterval: 100
      }
    });

    queue2.on('global:stalled', function(/*job*/) {
      queue2.close().then(done);
    });

    queue.on('active', function() {
      queue2.startMoveUnlockedJobsToWait();
      queue.close(true);
    });
  });

  it('emits waiting event when a job is added', function(done) {
    var queue = utils.buildQueue();

    queue.once('waiting', function(jobId) {
      Job.fromId(queue, jobId).then(function(job) {
        expect(job.data.foo).to.be.equal('bar');
        queue.close().then(done);
      });
    });
    queue.once('registered:waiting', function() {
      queue.add({ foo: 'bar' });
    });
  });

  it('emits drained and global:drained event when all jobs have been processed', function(done) {
    var queue = utils.buildQueue('event drained', {
      settings: { drainDelay: 1 }
    });

    queue.process(function(job, done) {
      done();
    });

    var drainedCallback = _.after(2, function() {
      queue.getJobCountByTypes('completed').then(function(completed) {
        expect(completed).to.be.equal(2);
        return queue.close().then(done);
      });
    });

    queue.once('drained', drainedCallback);
    queue.once('global:drained', drainedCallback);

    queue.add({ foo: 'bar' });
    queue.add({ foo: 'baz' });
  });

  it('should emit an event when a new message is added to the queue', function(done) {
    var client = new redis(6379, '127.0.0.1', {});
    client.select(0);
    var queue = new Queue('test pub sub');
    queue.on('waiting', function(jobId) {
      expect(parseInt(jobId, 10)).to.be.eql(1);
      done();
    });
    queue.once('registered:waiting', function() {
      queue.add({ test: 'stuff' });
    });
  });

  it('should emit an event when a job becomes active', function(done) {
    var queue = utils.buildQueue();
    queue.process(function(job, jobDone) {
      jobDone();
    });
    queue.add({});
    queue.once('active', function() {
      queue.once('completed', function() {
        queue.close().then(done);
      });
    });
  });

  it('should listen to global events', function(done) {
    var queue1 = utils.buildQueue();
    var queue2 = utils.buildQueue();
    queue1.process(function(job, jobDone) {
      jobDone();
    });

    var state;
    queue2.on('global:waiting', function() {
      expect(state).to.be.undefined;
      state = 'waiting';
    });
    queue2.once('registered:global:waiting', function() {
      queue2.once('global:active', function() {
        expect(state).to.be.equal('waiting');
        state = 'active';
      });
    });
    queue2.once('registered:global:active', function() {
      queue2.once('global:completed', function() {
        expect(state).to.be.equal('active');
        queue1.close().then(function() {
          queue2.close().then(done);
        });
      });
    });

    queue2.once('registered:global:completed', function() {
      queue1.add({});
    });
  });
});
