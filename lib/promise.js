/*eslint-env node */
'use strict';

// Add `finally()` to `Promise.prototype`
Promise.prototype.finally = function(onFinally) {
  return this.then(
    /* onFulfilled */
    function(res) {
      return Promise.resolve(onFinally()).then(function() {
        return res;
      });
    },
    /* onRejected */
    function(err) {
      return Promise.resolve(onFinally()).then(function() {
        throw err;
      });
    }
  );
};

// Add `.timeout()` to `Promise.prototype`
Promise.prototype.timeout = function(ms) {
  // Create a promise that rejects in <ms> milliseconds
  let timeout = new Promise((resolve, reject) => {
    let id = setTimeout(() => {
      clearTimeout(id);
      reject('Timed out in ' + ms + 'ms.');
    }, ms);
  });

  // Returns a race between our timeout and the passed in promise
  return Promise.race([this, timeout]);
};

Promise.prototype.filter = function(filterer) {
  return this.then(function(res) {
    if (!Array.isArray(res)) {
      res = [res];
    }

    return Promise.resolve(res.filter(filterer));
  });
};

Promise.prototype.map = function(mapper) {
  return this.then(function(res) {
    if (!Array.isArray(res)) {
      res = [res];
    }

    return Promise.all(res.map(mapper));
  });
};

Promise.prototype.each = function(forEach) {
  return this.then(function(res) {
    if (!Array.isArray(res)) {
      res = [res];
    }

    return res
      .reduce(function(prev, curr, i) {
        return prev.then(function() {
          return forEach(curr, i, res.length);
        });
      }, Promise.resolve())
      .then(function() {
        return res;
      });
  });
};

Promise.prototype.delay = function(ms) {
  return this.then(function() {
    return Promise.delay(ms);
  });
};

Promise.delay = function(ms) {
  return new Promise(function(resolve) {
    setTimeout(function() {
      resolve();
    }, ms);
  });
};

Promise.prototype.reduce = function(reducer, start) {
  return this.then(function(res) {
    if (!Array.isArray(res)) {
      res = [res];
    }

    const length = res.length;

    return res.reduce(function(promise, curr, index, arr) {
      return promise.then(function(prev) {
        if (prev === undefined && length === 1) {
          return curr;
        }

        return reducer(prev, curr, index, arr);
      });
    }, Promise.resolve(start));
  });
};

Promise.prototype.asCallback = function(callback) {
  return this.then(
    value => {
      callback(null, value);
    },
    err => {
      callback(err);
    }
  );
};
