(function() {
  'use strict';
  var Queue = require('bull');
  const myFirstQueue = new Queue('delayedJobs', 'redis://127.0.0.1:6379');
  const min_progress_update_period_ms = 1000;

  myFirstQueue.process('delayedJobRunner', async (job, done) => {
    // console.log("Obtained job is:",job);
    console.log('Obtained data is:', job.data);
    return randomDelayedGreeting(job, done);
  });

  myFirstQueue.on('completed', jobId => {
    console.log(`Job : ${jobId} completed`);
  });

  function getRandomInt(max) {
    var m_random = Math.random();
    if (m_random != 0) {
      return Math.floor(Math.random() * Math.floor(max));
    } else {
      console.log('random got zero itself! going recursive!');
      getRandomInt(max);
    }
  }

  function randomDelayedGreeting(mjob, done) {
    console.log(
      `from randomDelayed Greeting No: ${mjob.id}, data sent was ${mjob.data}`
    );
    var mydelay = getRandomInt(20);
    console.log('random delay selected:', mydelay);
    var progressUpdater = setInterval(function() {
      let progPercent = 100 / mydelay;
      mjob.progress(progPercent);
    }, min_progress_update_period_ms);

    setTimeout(function() {
      console.log('Delay thing over finally!!');
      console.log('Secret data sent was', mjob.data);
      clearInterval(progressUpdater);
      done();
    }, mydelay * 1000);
  }
})();
