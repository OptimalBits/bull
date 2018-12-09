/**
 * A processor file to be used in tests.
 *
 */

require('../../lib/promise');

module.exports = function(job, done) {
  Promise.delay(500).then(function() {
    done(null, 42);
  });
};
