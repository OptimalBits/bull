/*eslint-env node */
'use strict';

var expect = require('expect.js');
var utils = require('./utils');
var sinon = require('sinon');
var redis = require('ioredis');


describe('connection', function () {
  var sandbox = sinon.sandbox.create();
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
    }).process(function (job, jobDone) {
      expect(job.data.foo).to.be.equal('bar');
      jobDone();
      queue.close();
    }).then(function() {
      done();
    }).catch(function(err){
      console.error(err);
    });

    // Simulate disconnect
    queue.on('ready', function(){
      queue.bclient.stream.end();
      queue.bclient.emit('error', new Error('ECONNRESET'));

      // add something to the queue
      queue.add({ 'foo': 'bar' });
    });
  });

  //
  // This test is not relevant since ioredis keeps reconnects for us transparently.
  //
  it.skip('should reconnect when the blocking client triggers an "end" event', function (done) {
    var runSpy = sandbox.spy(queue, 'run');
    queue.process(function (job, jobDone) {
      expect(runSpy.callCount).to.be(2);
      jobDone();
      // We do not wait since this close is expected to fail...
      queue.close();
      done();
    });

    expect(runSpy.callCount).to.be(1);

    queue.add({ 'foo': 'bar' });
    queue.bclient.emit('end');
  });

  it.skip('should not try to reconnect when the blocking client triggers an "end" event and no process have been called', function (done) {
    var runSpy = sandbox.spy(queue, 'run');

    queue.bclient.emit('end');

    setTimeout(function () {
      expect(runSpy.callCount).to.be(0);
      queue.close(done());
    }, 100);
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
    }).catch(function(err){
      console.error(err);
    });

    queue.on('completed', function(){
      if(count === 1){
        queue.bclient.stream.end();
        queue.bclient.emit('error', new Error('ECONNRESET'));
      }
    });

    queue.on('ready', function(){
      queue.add({ 'foo': 'bar' });
    });

    queue.on('error', function (err) {
      if(count === 1) {
        queue.add({ 'foo': 'bar' });
      }
    });
  });

});
