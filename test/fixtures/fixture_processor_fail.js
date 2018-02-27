/**
 * A processor file to be used in tests.
 *
 */

var Promise = require('bluebird');

module.exports = function(/*job*/) {
  return Promise.delay(500).then(function() {
    throw new Error('Manually failed processor');
  });
};
