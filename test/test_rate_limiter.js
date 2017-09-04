/*eslint-env node */
'use strict';

var expect = require('chai').expect;
var utils = require('./utils');
var redis = require('ioredis');
var _ = require('lodash');

describe('Rate limiter', function () {
  var queue;

  beforeEach(function(){
    var client = new redis();
    return client.flushdb().then(function(){
      queue = utils.buildQueue('test rate limiter', {
        limiter: {
          max: 1,
          duration: 1000
        }
      });
    });
  });

  afterEach(function(){
    return queue.close();
  });

  it('should obey the rate limit', function(done) {
    var startTime = new Date().getTime();
    var nbProcessed = 0;

    queue.process(function() {
      return Promise.resolve();
    });

    queue.add({});
    queue.add({});
    queue.add({});
    queue.add({});

    queue.on('completed', _.after(4, function() {
      try {
        expect(new Date().getTime() - startTime).to.be.above(3000);
        done();
      } catch (e) {
        done(e);
      }
    }));

    queue.on('failed', done);
  });

});
