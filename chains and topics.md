
https://github.com/OptimalBits/bull/issues/120

# Process chains

workerOne.process(2, workerTwo)

workerA
  .chain(workerB)
  .chain(workerC)
  .chain(workerD)
  .bus('topicName', [workerE, workerF, workerG], workerH)
  .chain(workerI)

Bull
  .chain(workerB)
  .chain()




  muxer, demuxer

muxer( chainA, chainB, chainC )
demux( chainA ) -> chainB, chainC, chainD


```javascript
// New type of queue that has two "process" handlers: a regular worker
// and a handler that is called when all child jobs have completed
var GroupQueue = require('bull/lib/group-queue');
var Queue = require('bull');

var listUserQueue = Queue('list-user', 6379, '127.0.0.1');
var fetchMultipleUsersQueue = GroupQueue('fetch-multiple-user', 6379, '127.0.0.1');

listUserQueue.add({ url: '/list-users' });

listUserQueue.process(function(job, chain) {
  return request(job.data.url).then(function(userUrls) {
    var groupJob = fetchMultipleUsersQueue.add(userUrls);
    // chain: new concept that makes this job dependant of another job
    // I _really_ have no idea if that can be done in a sane way.
    chain(groupJob);
  });
});

fetchMultipleUsersQueue.process({
  // Called to process a single job
  unit: function(job) {
    return request(job.data.url).then(function(user) {
      return user.interestingInfos;
    });
  },

  // Called when all single jobs have completed for this group
  group: function(jobs) {
      var result = jobs.reduce(function(sum, job) {
        return job.data.salary + sum;
      }, 0);

      // Do something with result, save it to the database or something
      return result;
    });
  }
});
```