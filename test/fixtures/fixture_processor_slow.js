/**
 * A processor file to be used in tests.
 *
 */

var delay = require('delay');

module.exports = function(/*job*/) {
  return delay(1000).then(function() {
    return 42;
  });
};
