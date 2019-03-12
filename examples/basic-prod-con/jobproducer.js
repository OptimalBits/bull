'use strict';
const Queue = require('../../');
const myFirstQueue = new Queue('delayedJobs', 'redis://127.0.0.1:6379');

const mytasklist = [
  { a: 'apple' },
  { b: 'boy' },
  { c: 'cat' },
  { d: 'dog' },
  { e: 'elephant' }
];

mytasklist.forEach(obj => {
  // console.log('adding job for: ', obj);
  myFirstQueue.add('delayedJobRunner', obj);
});

// console.log('following up random things to print');
