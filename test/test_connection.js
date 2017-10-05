/*eslint-env node */
'use strict';

var expect = require('expect.js');
var utils = require('./utils');
var redis = require('ioredis');


describe('connection', function () {
  var queue;

  beforeEach(function(){
    var client = new redis();
    return client.flushdb().then(function(){
      queue = utils.buildQueue();
    });
  });

  it('should recover from a connection loss', function (done) {
    queue.on('error', function () {
      // error event has to be observed or the exception will bubble up
    });

    queue.process(function (job, jobDone) {
      expect(job.data.foo).to.be.equal('bar');
      jobDone();
      queue.close();
    }).then(function() {
      done();
    }).catch(done);

    // Simulate disconnect
    queue.isReady().then(function(){
      queue.client.stream.end();
      queue.client.emit('error', new Error('ECONNRESET'));

      // add something to the queue
      queue.add({ 'foo': 'bar' });
    });
  });

  it('should handle jobs added before and after a redis disconnect', function(done){
    var count = 0;
    queue.process(function (job, jobDone) {
      if(count == 0){
        expect(job.data.foo).to.be.equal('bar');
        jobDone();
      } else {
        jobDone();
        queue.close().then(done, done);
      }
      count ++;
    }).catch(done);

    queue.on('completed', function(){
      if(count === 1){
        queue.client.stream.end();
        queue.client.emit('error', new Error('ECONNRESET'));
      }
    });

    queue.isReady().then(function(){
      queue.add({ 'foo': 'bar' });
    });

    queue.on('error', function (/*err*/) {
      if(count === 1) {
        queue.add({ 'foo': 'bar' });
      }
    });
  });

});
