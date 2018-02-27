/**
 * A processor file to be used in tests.
 *
 */

var Promise = require('bluebird');

module.exports = function(/*job*/) {
  return Promise.delay(500).then(function() {
    Promise.delay(100).then(function() {
      process.exit(0);
    });
  });
};
