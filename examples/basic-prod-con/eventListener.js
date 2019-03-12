(async function() {
  'use strict';
  var Queue = require('../../');
  const myFirstQueue = new Queue('delayedJobs', 'redis://127.0.0.1:6379');

  myFirstQueue.on('global: completed', jobId => {
    console.log(`Job : ${jobId} completed`);
  });

  myFirstQueue.on('completed', jobId => {
    console.log(`Job : ${jobId} completed`);
  });

  console.log('random shit to print');
})();
