/**
 * A processor file to be used in tests.
 *
 */

var delay = require('delay');

module.exports = function(/*job*/) {
  return delay(500).then(function() {
    throw new Error('Manually failed processor');
  });
};
