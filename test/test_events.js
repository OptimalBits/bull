
/*eslint-env node */
'use strict';

var utils = require('./utils');
var redis = require('ioredis');

describe('events', function () {
  var queue;

  beforeEach(function(){
    var client = new redis();
    return client.flushdb().then(function(){
      queue = utils.buildQueue('test events', {settings: {
        stalledInterval: 100,
        lockDuration: 50
      }});
    });
  });

  afterEach(function(){
    return queue.close();
  });

  it('should emit waiting when a job has been added', function(done){
    queue.on('waiting', function(){
      done();
    });

    queue.on('registered:waiting', function(){
      queue.add({ foo: 'bar' });
    });
  });

  it('should emit global:waiting when a job has been added', function(done){
    queue.on('global:waiting', function(){
      done();
    });

    queue.on('registered:global:waiting', function(){
      queue.add({ foo: 'bar' });
    });
  });

  it('should emit stalled when a job has been stalled', function (done) {
    queue.on('completed', function (/*job*/) {
      done(new Error('should not have completed'));
    });

    queue.process(function (/*job*/) {
      return Promise.delay(250);
    });

    queue.add({ foo: 'bar' });

    var queue2 = utils.buildQueue('test events', {settings: {
      stalledInterval: 100
    }});

    queue2.on('stalled', function (/*job*/) {
      queue2.close().then(done);
    });

    queue.on('active', function(){
      queue2.startMoveUnlockedJobsToWait();
      queue.close(true);
    });
  });

  it('should emit global:stalled when a job has been stalled', function (done) {
    queue.on('completed', function (/*job*/) {
      done(new Error('should not have completed'));
    });

    queue.process(function (/*job*/) {
      return Promise.delay(250);
    });

    queue.add({ foo: 'bar' });

    var queue2 = utils.buildQueue('test events', {settings: {
      stalledInterval: 100
    }});

    queue2.on('global:stalled', function (/*job*/) {
      queue2.close().then(done);
    });

    queue.on('active', function(){
      queue2.startMoveUnlockedJobsToWait();
      queue.close(true);
    });
  });
});
