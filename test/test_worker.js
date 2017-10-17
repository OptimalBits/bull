/*eslint-env node */
'use strict';

var expect = require('chai').expect;
var utils = require('./utils');
var redis = require('ioredis');

describe('workers', function () {
  var queue;

  beforeEach(function(){
    var client = new redis();
    return client.flushdb().then(function(){
      queue = utils.buildQueue('test workers', {settings: {
        guardInterval: Number.MAX_VALUE,
        stalledInterval: Number.MAX_VALUE
      }});
      return queue;
    });
  });

  afterEach(function(){
    return queue.close();
  });

  it('should get all workers for this queue', function (done) {
    queue.process(function(){});

    queue.getWorkers().then(function(workers){
      expect(workers).to.have.length(1);
      done();
    });
  });
});
