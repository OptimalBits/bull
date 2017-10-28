/*eslint-env node */
'use strict';

var Promise = require('bluebird');
var expect = require('chai').expect;
var utils = require('./utils');
var redis = require('ioredis');
var sinon = require('sinon');
var _ = require('lodash');

describe('sandboxed process', function () {
  var queue;

  beforeEach(function(){
    var client = new redis();
    return client.flushdb().then(function(){
      queue = utils.buildQueue('test process', {settings: {
        guardInterval: Number.MAX_VALUE,
        stalledInterval: Number.MAX_VALUE
      }});
      return queue;
    });
  });

  afterEach(function(){
    return queue.close(true)
      .then(function(){
        var client = new redis();
        return client.flushall();
      });
  });

  it('should process and complete', function (done) {
    queue.process(__dirname + '/fixtures/fixture_processor.js');

    queue.on('completed', function(job, value){
      try {
        expect(job.data).to.be.eql({foo:'bar'});
        expect(value).to.be.eql(42);
        expect(queue.childPool.pool.borrowed).to.equal(0);
        expect(queue.childPool.pool.available).to.equal(1);
        done();
      } catch (err) {
        done(err);
      }
    });

    queue.add({foo:'bar'});
  });

  it('should process and complete using done', function (done) {
    queue.process(__dirname + '/fixtures/fixture_processor_callback.js');

    queue.on('completed', function(job, value){
      try {
        expect(job.data).to.be.eql({foo:'bar'});
        expect(value).to.be.eql(42);
        expect(queue.childPool.pool.borrowed).to.equal(0);
        expect(queue.childPool.pool.available).to.equal(1);
        done();
      } catch (err) {
        done(err);
      }
    });

    queue.add({foo:'bar'});
  });

  it('should process and update progress', function (done) {
    queue.process(__dirname + '/fixtures/fixture_processor_progress.js');

    queue.on('completed', function(job, value){
      try {
        expect(job.data).to.be.eql({foo:'bar'});
        expect(value).to.be.eql(37);
        expect(job.progress()).to.be.eql(100);
        expect(progresses).to.be.eql([10, 27, 78, 100]);
        expect(queue.childPool.pool.borrowed).to.equal(0);
        expect(queue.childPool.pool.available).to.equal(1);
        done();
      } catch (err) {
        done(err);
      }
    });

    var progresses = [];
    queue.on('progress', function(job, progress){
      progresses.push(progress);
    });

    queue.add({foo:'bar'});
  });

  it('should process and fail', function (done) {
    queue.process(__dirname + '/fixtures/fixture_processor_fail.js');

    queue.on('failed', function(job, err){
      try {
        expect(job.data).eql({foo:'bar'});
        expect(job.failedReason).eql('Manually failed processor');
        expect(err.message).eql('Manually failed processor');
        expect(queue.childPool.pool.borrowed).to.equal(0);
        expect(queue.childPool.pool.available).to.equal(1);
        done();
      } catch (err) {
        done(err);
      }
    });

    queue.add({foo:'bar'});
  });

  it('should process and fail', function (done) {
    queue.process(__dirname + '/fixtures/fixture_processor_callback_fail.js');

    queue.on('failed', function(job, err){
      try {
        expect(job.data).eql({foo:'bar'});
        expect(job.failedReason).eql('Manually failed processor');
        expect(err.message).eql('Manually failed processor');
        expect(queue.childPool.pool.borrowed).to.equal(0);
        expect(queue.childPool.pool.available).to.equal(1);
        done();
      } catch (err) {
        done(err);
      }
    });

    queue.add({foo:'bar'});
  });

  it('should remove exited process', function (done) {
    queue.process(__dirname + '/fixtures/fixture_processor_exit.js');

    queue.on('completed', function(){
      try {
        expect(queue.childPool.pool.borrowed).to.equal(0);
        expect(queue.childPool.pool.available).to.equal(1);
        Promise.delay(500).then(function(){
          expect(queue.childPool.pool.borrowed).to.equal(0);
          expect(queue.childPool.pool.available).to.equal(0);
        })
          .asCallback(done);
      } catch (err) {
        done(err);
      }
    });

    queue.add({foo:'bar'});
  });

  it('process will not leak memory with killOnComplete: true', function () {
    queue.process(__dirname + '/fixtures/fixture_processor_leaky.js', true);

    var completed = sinon.spy();
    queue.on('completed', completed);

    _.times(5, queue.add.bind(queue, {foo:'bar'}));

    return Promise.delay(2000).then(function(){
      expect(completed.callCount).to.equal(5);
      expect(completed.getCall(4).args[1]).to.equal(0);
    });
  });

  it('process will leak memory with killOnComplete: false', function () {
    queue.process(__dirname + '/fixtures/fixture_processor_leaky.js');

    var completed = sinon.spy();
    queue.on('completed', completed);

    _.times(5, queue.add.bind(queue, {foo:'bar'}));

    return Promise.delay(2000).then(function(){
      expect(completed.callCount).to.equal(5);
      expect(completed.getCall(4).args[1]).to.equal(4);
    });
  });

  it('should process after exit with killOnComplete: true', function () {
    queue.process(__dirname + '/fixtures/fixture_processor_exit.js', true);

    var completed = sinon.spy();
    queue.on('completed', completed);

    _.times(5, queue.add.bind(queue, {foo:'bar'}));

    return Promise.delay(4000).then(function(){
      expect(completed.callCount).to.equal(5);
    });
  });

  it('should fail to process after exit with killOnComplete: false', function () {
    queue.process(__dirname + '/fixtures/fixture_processor_exit.js');

    var completed = sinon.spy();
    var failed = sinon.spy();

    queue.on('completed', completed);
    queue.on('failed', failed);

    _.times(2, queue.add.bind(queue, {foo:'bar'}));

    return Promise.delay(4000).then(function(){
      expect(completed.callCount).to.equal(1);
      expect(failed.callCount).to.equal(1);
    });
  });

  it('should respect concurrency option with killOnComplete: true', function () {
    queue.process(5, __dirname + '/fixtures/fixture_processor.js', true);

    var completed = sinon.spy();
    queue.on('completed', completed);

    _.times(15, queue.add.bind(queue, {foo:'bar'}));

    return Promise.delay(1000).then(function(){
      expect(completed.callCount).to.equal(5);
    }).delay(1000).then(function(){
      expect(completed.callCount).to.equal(10);
    }).delay(1000).then(function(){
      expect(completed.callCount).to.equal(15);
    });
  });
});
