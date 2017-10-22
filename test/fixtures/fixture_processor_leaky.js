/**
 * A processor file to be used in tests.
 *
 */

var Promise = require('bluebird');

var count = 0;

module.exports = function(/*job*/){
  return Promise.delay(100).then(function(){
    return count++;
  });
};
