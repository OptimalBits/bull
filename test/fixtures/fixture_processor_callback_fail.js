/**
 * A processor file to be used in tests.
 *
 */

var delay = require('delay');

module.exports = function(job, done) {
  delay(500).then(function() {
    done(new Error('Manually failed processor'));
  });
};
