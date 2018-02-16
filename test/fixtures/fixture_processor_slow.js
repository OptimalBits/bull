/**
 * A processor file to be used in tests.
 *
 */

var Promise = require('bluebird');

module.exports = function(/*job*/) {
  return Promise.delay(1000).then(function() {
    return 42;
  });
};
