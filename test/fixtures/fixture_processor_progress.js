/**
 * A processor file to be used in tests.
 *
 */

var delay = require('delay');

module.exports = function(job) {
  return delay(50)
    .then(function() {
      job.progress(10);
      return delay(100);
    })
    .then(function() {
      job.progress(27);
      return delay(150);
    })
    .then(function() {
      job.progress(78);
      return delay(100);
    })
    .then(function() {
      return job.progress(100);
    })
    .then(function() {
      return 37;
    });
};
