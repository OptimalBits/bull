'use strict';
var Queue = require('../../');
const myFirstQueue = new Queue('delayedJobs', 'redis://127.0.0.1:6379');

var mytasklist = [
  { a: 'apple' },
  { b: 'boy' },
  { c: 'cat' },
  { d: 'dog' },
  { e: 'elephant' }
];

mytasklist.forEach(function(obj) {
  console.log('adding job for: ', obj);
  const job = myFirstQueue.add('delayedJobRunner', obj);
});

console.log('following up random things to print');
