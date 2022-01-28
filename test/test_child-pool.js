'use strict';

const expect = require('chai').expect;
const childPool = require('../lib/process/child-pool');
const { ChildProcess } = require('child_process')

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

  it('should returned a shared child pool is isSharedChildPool is true', () => {
    expect(childPool(true)).to.be.equal(new childPool(true));
  });

  it('should return a different childPool if isSharedChildPool is false', () => {
    expect(childPool()).to.not.be.equal(childPool());
  });

  it('should not overwrite the the childPool singleton when isSharedChildPool is false', () => {
    const childPoolA = new childPool(true)
    const childPoolB = new childPool(false)
    const childPoolC = new childPool(true);

    expect(childPoolA).to.be.equal(childPoolC)
    expect(childPoolB).to.not.be.equal(childPoolA)
    expect(childPoolB).to.not.be.equal(childPoolC)
  });

  it('should initialize a free child to be forked', async () => {
    const processor = __dirname + '/fixtures/fixture_processor_bar.js';

    const child = await pool.addFreeChild(processor);

    expect(child).to.be.instanceof(ChildProcess);
    expect(pool.getFree(processor)).to.not.be.empty;
    expect(pool.retained).to.be.empty;
    expect({}).to.be.empty
  });

  it('should reuse the same child forked from addFreeChild', async () => {
    const processor = __dirname + '/fixtures/fixture_processor_bar.js';

    const child = await pool.addFreeChild(processor);
    const _child = await pool.retain(processor);

    expect(child).to.be.ok;
    expect(_child).to.be.ok;
    expect(pool.getFree(processor)).to.be.empty;
    expect(child).to.be.equal(_child)
  });

  it('should reuse the same child from addFreeChild forked after retaining', async () => {
    const processor = __dirname + '/fixtures/fixture_processor_bar.js';

    const childA = await pool.addFreeChild(processor);
    const childB = await pool.retain(processor);
    pool.release(childB);

    expect(pool.retained).to.be.empty;
    const childC = await pool.retain(processor);

    expect(pool.getFree(processor)).to.be.empty;
    expect(childA === childB && childB === childC).to.be.true;
  });


});
