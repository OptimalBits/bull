/**
 * A processor file to be used in tests.
 *
 */

require('../../lib/promise');

module.exports = function(/*job*/) {
  return Promise.delay(500).then(function() {
    Promise.delay(100).then(function() {
      process.exit(0);
    });
  });
};
