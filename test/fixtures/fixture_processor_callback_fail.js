/**
 * A processor file to be used in tests.
 *
 */

var Promise = require('bluebird');

module.exports = function(job, done) {
  Promise.delay(500).then(function() {
    done(new Error('Manually failed processor'));
  });
};
