/**
 * A processor file to be used in tests.
 *
 */

var delay = require('delay');

module.exports = function(/*job*/) {
  return delay(500).then(function() {
    delay(100).then(function() {
      process.exit(0);
    });
  });
};
