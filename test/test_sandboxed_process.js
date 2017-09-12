/*eslint-env node */
'use strict';

var expect = require('chai').expect;
var utils = require('./utils');
var redis = require('ioredis');

describe('sandboxed process', function () {
  var queue;

  beforeEach(function(){
    var client = new redis();
    return client.flushdb().then(function(){
      queue = utils.buildQueue('test process', {settings: {
        guardInterval: Number.MAX_VALUE,
        stalledInterval: Number.MAX_VALUE
      }});
    });
  });

  afterEach(function(){
    return queue.close().then(function(){
      var client = new redis();
      return client.flushall();
    });
  });

  it('should process and complete', function (done) {
    queue.process(__dirname + '/fixtures/fixture_processor.js');

    queue.on('completed', function(job, value){
      expect(job.data).to.be.eql({foo:'bar'});
      expect(value).to.be.eql(42);
      done();
    });

    queue.add({foo:'bar'});
  });

  it('should process and complete using done', function (done) {
    queue.process(__dirname + '/fixtures/fixture_processor_callback.js');

    queue.on('completed', function(job, value){
      expect(job.data).to.be.eql({foo:'bar'});
      expect(value).to.be.eql(42);
      done();
    });

    queue.add({foo:'bar'});
  });

  it('should process and update progress', function (done) {
    queue.process(__dirname + '/fixtures/fixture_processor_progress.js');

    queue.on('completed', function(job, value){
      expect(job.data).to.be.eql({foo:'bar'});
      expect(value).to.be.eql(37);
      expect(job.progress()).to.be.eql(100);
      expect(progresses).to.be.eql([10, 27, 78, 100]);
      done();
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
      expect(job.data).eql({foo:'bar'});
      expect(job.failedReason).eql('Manually failed processor');
      expect(err.message).eql('Manually failed processor');
      done();
    });

    queue.add({foo:'bar'});
  });

  it('should process and fail', function (done) {
    queue.process(__dirname + '/fixtures/fixture_processor_callback_fail.js');

    queue.on('failed', function(job, err){
      expect(job.data).eql({foo:'bar'});
      expect(job.failedReason).eql('Manually failed processor');
      expect(err.message).eql('Manually failed processor');
      done();
    });

    queue.add({foo:'bar'});
  });
});
