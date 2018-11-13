/**
 * A processor file to be used in tests.
 *
 */

var Promise = require('bluebird');

module.exports = function(job) {
  setTimeout(function() {
    if (typeof job.data.exitCode !== 'number') {
      throw new Error('boom!');
    }
    process.exit(job.data.exitCode);
  }, 100);

  return new Promise(function() {});
};
