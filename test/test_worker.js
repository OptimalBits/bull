/*eslint-env node */
'use strict';

var expect = require('chai').expect;
var utils = require('./utils');
var redis = require('ioredis');

describe('workers', function() {
  var queue;
  var client;

  beforeEach(function() {
    client = new redis();
    return client.flushdb().then(function() {
      queue = utils.buildQueue('test workers', {
        settings: {
          guardInterval: 300000,
          stalledInterval: 300000
        }
      });
      return queue;
    });
  });

  afterEach(function() {
    return queue.close().then(function() {
      return client.quit();
    });
  });

  it('should get all workers for this queue', function() {
    queue.process(function() {});

    return queue.getWorkers().then(function(workers) {
      expect(workers).to.have.length(1);
    });
  });
});
