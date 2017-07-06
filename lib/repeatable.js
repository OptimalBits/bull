//
// This code will be called everytime a job is going to be processed if the job has a repeat option. (from delay -> active).
//
var _ = require('lodash');
var parser = require('cron-parser');
var Job = require('./job');

function nextJob(queue, name, data, opts, isRepeat){
  var repeat = opts.repeat;
  if(!isRepeat && opts.jobId){
    opts.repeat.jobId = opts.jobId;
  }
  var repeatJobId = opts.repeat.jobId ? opts.repeat.jobId + ':' : '';
  var repeatKey = queue.toKey('repeat') + ':' + name + ':' + repeatJobId + repeat.cron;

  //
  // Get millis for this repeatable job.
  // Only use `millis` from the `repeatKey` when the job is a repeat, otherwise, we want
  // `Date.now()` to ensure we try to add the next iteration only
  //
  return (isRepeat ? queue.client.get(repeatKey) : Promise.resolve(Date.now())).then(function(millis){
    if(millis){
      return parseInt(millis);
    }else{
      return Date.now();
    }
  }).then(function(millis){
    var interval = parser.parseExpression(repeat.cron, _.defaults({
      currentDate: new Date(millis)
    }, repeat));
    var nextMillis;
    try{
      nextMillis = interval.next();
    } catch(e){
      // Ignore error
    }

    if(nextMillis){
      nextMillis = nextMillis.getTime();
      var delay = nextMillis - Date.now();

      //
      // Generate unique job id for this iteration.
      //
      var customId = 'repeat:' + name + ':' + repeatJobId + nextMillis;

      //
      // Set key and add job should be atomic.
      //
      return queue.client.set(repeatKey, nextMillis).then(function(){
        return Job.create(queue, name, data, _.extend(_.clone(opts), {
          jobId: customId,
          delay: delay < 0 ? 0 : delay,
          timestamp: Date.now()
        }));
      });
    }
  });
};

module.exports.nextJob = nextJob;