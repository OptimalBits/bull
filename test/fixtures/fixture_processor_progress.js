/**
 * A processor file to be used in tests.
 *
 */

var Promise = require('bluebird');

module.exports = function(job) {
  return Promise.delay(50)
    .then(function() {
      job.progress(10);
      return Promise.delay(100);
    })
    .then(function() {
      job.progress(27);
      return Promise.delay(150);
    })
    .then(function() {
      job.progress(78);
      return Promise.delay(100);
    })
    .then(function() {
      return job.progress(100);
    })
    .then(function() {
      return 37;
    });
};
