/**
 * A processor file with CJS extension to be used in ES module tests.
 *
 */
 'use strict';

 const delay = require('delay');

 module.exports = function(/*job*/) {
   return delay(500).then(() => {
     return 42;
   });
 };
