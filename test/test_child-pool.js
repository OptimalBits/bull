'use strict';

const expect = require('chai').expect;
const childPool = require('../lib/process/child-pool');

describe('Child pool', () => {
  let pool;

  beforeEach(() => {
    pool = new childPool();
  });

  afterEach(() => {
    pool.clean();
  });

  it('should return same child if free', () => {
    const processor = __dirname + '/fixtures/fixture_processor_bar.js';
    let child;
    return pool
      .retain(processor)
      .then(_child => {
        expect(_child).to.be.ok;
        child = _child;
        pool.release(child);

        expect(pool.retained).to.be.empty;

        return pool.retain(processor);
      })
      .then(newChild => {
        expect(child).to.be.eql(newChild);
      });
  });

  it('should return a new child if reused the last free one', () => {
    const processor = __dirname + '/fixtures/fixture_processor_bar.js';
    let child;
    return pool
      .retain(processor)
      .then(_child => {
        expect(_child).to.be.ok;
        child = _child;
        pool.release(child);

        expect(pool.retained).to.be.empty;

        return pool.retain(processor);
      })
      .then(newChild => {
        expect(child).to.be.eql(newChild);
        child = newChild;
        return pool.retain(processor);
      })
      .then(newChild => {
        expect(child).not.to.be.eql(newChild);
      });
  });

  it('should return a new child if none free', () => {
    const processor = __dirname + '/fixtures/fixture_processor_bar.js';
    let child;
    return pool
      .retain(processor)
      .then(_child => {
        expect(_child).to.be.ok;
        child = _child;

        expect(pool.retained).not.to.be.empty;

        return pool.retain(processor);
      })
      .then(newChild => {
        expect(child).to.not.be.eql(newChild);
      });
  });

  it('should return a new child if killed', () => {
    const processor = __dirname + '/fixtures/fixture_processor_bar.js';
    let child;
    return pool
      .retain(processor)
      .then(_child => {
        expect(_child).to.be.ok;
        child = _child;

        pool.kill(child);

        expect(pool.retained).to.be.empty;

        return pool.retain(processor);
      })
      .then(newChild => {
        expect(child).to.not.be.eql(newChild);
      });
  });

  it('should return a new child if many retained and none free', () => {
    const processor = __dirname + '/fixtures/fixture_processor_bar.js';
    let children;

    return Promise.all([
      pool.retain(processor),
      pool.retain(processor),
      pool.retain(processor),
      pool.retain(processor),
      pool.retain(processor),
      pool.retain(processor)
    ])
      .then(_children => {
        children = _children;
        expect(children).to.have.length(6);
        return pool.retain(processor);
      })
      .then(child => {
        expect(children).not.to.include(child);
      });
  });

  it('should return an old child if many retained and one free', () => {
    const processor = __dirname + '/fixtures/fixture_processor_bar.js';
    let children;

    return Promise.all([
      pool.retain(processor),
      pool.retain(processor),
      pool.retain(processor),
      pool.retain(processor),
      pool.retain(processor),
      pool.retain(processor)
    ])
      .then(_children => {
        children = _children;
        expect(children).to.have.length(6);

        pool.release(_children[0]);

        return pool.retain(processor);
      })
      .then(child => {
        expect(children).to.include(child);
      });
  });

  it('should kill child after processing is finished and not retain it', function() {
    const processor = __dirname + '/fixtures/fixture_processor_bar.js';

    pool.setReuseProcesses(false);

    return pool.retain(processor).then(_child => {
      expect(_child).to.be.ok;
      pool.release(_child);

      expect(pool.retained).to.be.empty;
      expect(pool.free[processor]).to.be.empty;
    });
  });
});
