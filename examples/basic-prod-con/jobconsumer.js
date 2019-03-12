'use strict';
const Queue = require('../../');
const myFirstQueue = new Queue('delayedJobs', 'redis://127.0.0.1:6379');
const minProgressUpdatePeriodMs = 1000;

myFirstQueue.process('delayedJobRunner', (job, done) => {
  // console.log(`Obtained job's ID is: ${job.id} with data as: ${job.data}`);
  return randomDelayedGreeting(job, done);
});

myFirstQueue.on('completed', jobId => {
  // console.log(`Job : ${jobId} completed`);
});

function getRandomInt(max) {
  const mRandom = Math.random();
  if (mRandom != 0) {
    return Math.floor(Math.random() * Math.floor(max));
  } else {
    // console.log('random got zero itself! going recursive!');
    getRandomInt(max);
  }
}

function randomDelayedGreeting(mjob, done) {
  const mydelay = getRandomInt(20);
  // console.log(`random delay selected: ${mydelay}`);
  let progPercent = 100 / mydelay;
  // console.log(`random delay selected: ${mydelay}`);
  const progressUpdater = setInterval(() => {
    progPercent += 100 / mydelay;
    // console.log(`    sending progress udpate => ${progPercent}`);
    mjob.progress(progPercent);
  }, minProgressUpdatePeriodMs);

  setTimeout(() => {
    // console.log('Delay thing over finally!!');
    // console.log(`Secret data sent was ${mjob.data}`);
    clearInterval(progressUpdater);
    done();
  }, mydelay * 1000);
}
