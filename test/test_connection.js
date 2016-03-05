/*eslint-env node */
/*global Promise:true */
'use strict';

var expect = require('expect.js');
var utils = require('./utils');
var sinon = require('sinon');

describe('connection', function () {
  var sandbox = sinon.sandbox.create();

  it('should recover from a connection loss', function (done) {
    var queue = utils.buildQueue();

    queue.on('error', function () {
      // error event has to be observed or the exception will bubble up
    }).process(function (job, jobDone) {
      expect(job.data.foo).to.be.equal('bar');
      jobDone();
      queue.close().then(done);
    });

    // Simulate disconnect
    queue.bclient.stream.end();
    queue.bclient.emit('error', new Error('ECONNRESET'));

    // add something to the queue
    queue.add({ 'foo': 'bar' });
  });

  it('should reconnect when the blocking client triggers an "end" event', function (done) {
    var queue = utils.buildQueue();

    var runSpy = sandbox.spy(queue, 'run');
    queue.process(function (job, jobDone) {
      expect(runSpy.callCount).to.be(2);
      jobDone();
      queue.close().then(done);
    });

    expect(runSpy.callCount).to.be(1);

    queue.add({ 'foo': 'bar' });
    queue.bclient.emit('end');
  });

  it('should not try to reconnect when the blocking client triggers an "end" event and no process have been called', function (done) {
    var queue = utils.buildQueue();

    var runSpy = sandbox.spy(queue, 'run');

    queue.bclient.emit('end');

    setTimeout(function () {
      expect(runSpy.callCount).to.be(0);
      queue.close().then(done);
    }, 100);
  });
});
