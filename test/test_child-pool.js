/*eslint-env node */
'use strict';

var expect = require('chai').expect;
var redis = require('ioredis');
var childPool = require('../lib/process/child-pool');

describe('Child pool', function() {
  var pool;

  beforeEach(function() {
    pool = new childPool();
  });

  afterEach(function() {
    pool.clean();
  });

  it('should return same child if free', function() {
    var processor = __dirname + '/fixtures/fixture_processor_bar.js';
    var child;
    return pool
      .retain(processor)
      .then(function(_child) {
        expect(_child).to.be.ok;
        child = _child;
        pool.release(child);

        expect(pool.retained).to.be.empty;

        return pool.retain(processor);
      })
      .then(function(newChild) {
        expect(child).to.be.eql(newChild);
      });
  });

  it('should return a new child if reused the last free one', function() {
    var processor = __dirname + '/fixtures/fixture_processor_bar.js';
    var child;
    return pool
      .retain(processor)
      .then(function(_child) {
        expect(_child).to.be.ok;
        child = _child;
        pool.release(child);

        expect(pool.retained).to.be.empty;

        return pool.retain(processor);
      })
      .then(function(newChild) {
        expect(child).to.be.eql(newChild);
        child = newChild;
        return pool.retain(processor);
      })
      .then(function(newChild) {
        expect(child).not.to.be.eql(newChild);
      });
  });

  it('should return a new child if none free', function() {
    var processor = __dirname + '/fixtures/fixture_processor_bar.js';
    var child;
    return pool
      .retain(processor)
      .then(function(_child) {
        expect(_child).to.be.ok;
        child = _child;

        expect(pool.retained).not.to.be.empty;

        return pool.retain(processor);
      })
      .then(function(newChild) {
        expect(child).to.not.be.eql(newChild);
      });
  });

  it('should return a new child if killed', function() {
    var processor = __dirname + '/fixtures/fixture_processor_bar.js';
    var child;
    return pool
      .retain(processor)
      .then(function(_child) {
        expect(_child).to.be.ok;
        child = _child;

        pool.kill(child);

        expect(pool.retained).to.be.empty;

        return pool.retain(processor);
      })
      .then(function(newChild) {
        expect(child).to.not.be.eql(newChild);
      });
  });

  it('should return a new child if many retained and none free', function() {
    var processor = __dirname + '/fixtures/fixture_processor_bar.js';
    var children;

    return Promise.all([
      pool.retain(processor),
      pool.retain(processor),
      pool.retain(processor),
      pool.retain(processor),
      pool.retain(processor),
      pool.retain(processor)
    ])
      .then(function(_children) {
        children = _children;
        expect(children).to.have.length(6);
        return pool.retain(processor);
      })
      .then(function(child) {
        expect(children).not.to.include(child);
      });
  });

  it('should return an old child if many retained and one free', function() {
    var processor = __dirname + '/fixtures/fixture_processor_bar.js';
    var children;

    return Promise.all([
      pool.retain(processor),
      pool.retain(processor),
      pool.retain(processor),
      pool.retain(processor),
      pool.retain(processor),
      pool.retain(processor)
    ])
      .then(function(_children) {
        children = _children;
        expect(children).to.have.length(6);

        pool.release(_children[0]);

        return pool.retain(processor);
      })
      .then(function(child) {
        expect(children).to.include(child);
      });
  });
});
