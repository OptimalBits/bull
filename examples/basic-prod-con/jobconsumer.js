'use strict';
const Queue = require('../../');
const myFirstQueue = new Queue('delayedJobs', 'redis://127.0.0.1:6379');
const minProgressUpdatePeriodMs = 1000;

myFirstQueue.process('delayedJobRunner', (job, done) => {
  // console.log("Obtained job is:",job);
  // console.log('Obtained data is:', job.data);
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
  // console.log(`from randomDelayed Greeting No: ${mjob.id}, data sent was ${mjob.data}`);
  const mydelay = getRandomInt(20);
  // console.log(`random delay selected: ${mydelay}`);
  const progressUpdater = setInterval(() => {
    const progPercent = 100 / mydelay;
    mjob.progress(progPercent);
  }, minProgressUpdatePeriodMs);

  setTimeout(() => {
    // console.log('Delay thing over finally!!');
    // console.log(`Secret data sent was ${mjob.data}`);
    clearInterval(progressUpdater);
    done();
  }, mydelay * 1000);
}
