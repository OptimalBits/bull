Bull Job Manager
================

[![Join the chat at https://gitter.im/OptimalBits/bull](https://badges.gitter.im/Join%20Chat.svg)](https://gitter.im/OptimalBits/bull?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)
[![npm](https://img.shields.io/npm/dm/bull.svg?maxAge=2592000)]()
[![BuildStatus](https://secure.travis-ci.org/OptimalBits/bull.png?branch=master)](http://travis-ci.org/OptimalBits/bull)
[![NPM version](https://badge.fury.io/js/bull.svg)](http://badge.fury.io/js/bull)
[![Percentage of issues still open](http://isitmaintained.com/badge/open/OptimalBits/bull.svg)](http://isitmaintained.com/project/OptimalBits/bull "Percentage of issues still open")
[![Average time to resolve an issue](http://isitmaintained.com/badge/resolution/OptimalBits/bull.svg)](http://isitmaintained.com/project/OptimalBits/bull "Average time to resolve an issue")


<img src="https://image.freepik.com/free-icon/strong-bull-side-view_318-52710.jpg" width="200" />

The fastest, most reliable Redis based queue for nodejs.
Carefully written for rock solid stability and atomicity.


Follow [manast](http://twitter.com/manast) for news and updates regarding this library.


Sponsors:
---------
<a href="http://mixmax.com">
<img src="https://mixmax.com/images/logo_confirmation.png" alt="Mixmax, Inc" width="100" />
</a>
<a href="http://optimalbits.com">
  <img src="http://optimalbits.com/images/logo.png" />
</a>

Are you developing bull sponsored by a company? Please, let us now!

Features:
---------

- Minimal CPU usage by poll-free design.
- Robust design based on Redis.
- Delayed jobs.
- Retries.
- Priority.
- Concurrency.
- Pause/resume (globally or locally).
- Automatic recovery from process crashes.

UIs:
----

There are a few third party UIs that can be used for easier administration of the queues (not in any particular order):

* [matador](https://github.com/ShaneK/Matador)
* [react-bull](https://github.com/kfatehi/react-bull)
* [toureiro](https://github.com/Epharmix/Toureiro)

Roadmap:
--------

- Multiple job types per queue.
- Scheduling jobs as a cron specification.
- Rate limiter for jobs.
- Parent-child jobs relationships.


Install:
--------

    npm install bull@2.x --save

Note that you need a Redis version higher or equal than 2.8.11 for bull to work properly.

**IMPORTANT**

We are in the progress of developing ```bull 3.0.0```, which means that the latest *unstable* version would be something like
bull-3.0.0-alpha.1. It is recommended that you stick to version 2.x until 3.0.0 stable is released. Some things to expect in  3.x: https://github.com/OptimalBits/bull/milestone/4

Quick Guide
-----------
```javascript
var Queue = require('bull');

var videoQueue = new Queue('video transcoding', 'redis://127.0.0.1:6379');
var audioQueue = new Queue('audio transcoding', {redis: {port: 6379, host: '127.0.0.1'}}); // Specify Redis connection using object
var imageQueue = new Queue('image transcoding');
var pdfQueue = new Queue('pdf transcoding');

videoQueue.process(function(job, done){

  // job.data contains the custom data passed when the job was created
  // job.jobId contains id of this job.

  // transcode video asynchronously and report progress
  job.progress(42);

  // call done when finished
  done();

  // or give a error if error
  done(Error('error transcoding'));

  // or pass it a result
  done(null, { framerate: 29.5 /* etc... */ });

  // If the job throws an unhandled exception it is also handled correctly
  throw new Error('some unexpected error');
});

audioQueue.process(function(job, done){
  // transcode audio asynchronously and report progress
  job.progress(42);

  // call done when finished
  done();

  // or give a error if error
  done(Error('error transcoding'));

  // or pass it a result
  done(null, { samplerate: 48000 /* etc... */ });

  // If the job throws an unhandled exception it is also handled correctly
  throw new Error('some unexpected error');
});

imageQueue.process(function(job, done){
  // transcode image asynchronously and report progress
  job.progress(42);

  // call done when finished
  done();

  // or give a error if error
  done(Error('error transcoding'));

  // or pass it a result
  done(null, { width: 1280, height: 720 /* etc... */ });

  // If the job throws an unhandled exception it is also handled correctly
  throw new Error('some unexpected error');
});

pdfQueue.process(function(job){
  // Processors can also return promises instead of using the done callback
  return pdfAsyncProcessor();
});

videoQueue.add({video: 'http://example.com/video1.mov'});
audioQueue.add({audio: 'http://example.com/audio1.mp3'});
imageQueue.add({image: 'http://example.com/image1.tiff'});
```

Alternatively, you can use return promises instead of using the `done` callback:

```javascript
videoQueue.process(function(job){ // don't forget to remove the done callback!
  // Simply return a promise
  return fetchVideo(job.data.url).then(transcodeVideo);

  // Handles promise rejection
  return Promise.reject(new Error('error transcoding'));

  // Passes the value the promise is resolved with to the "completed" event
  return Promise.resolve({ framerate: 29.5 /* etc... */ });

  // If the job throws an unhandled exception it is also handled correctly
  throw new Error('some unexpected error');
  // same as
  return Promise.reject(new Error('some unexpected error'));
});
```

A queue can be paused and resumed globally (pass `true` to pause processing for
just this worker):
```javascript
queue.pause().then(function(){
  // queue is paused now
});

queue.resume().then(function(){
  // queue is resumed now
})
```

A queue emits also some useful events:
```javascript
.on('ready', function() {
  // Queue ready for job
  // All Redis connections are done
})
.on('error', function(error) {
  // Error
})
.on('active', function(job, jobPromise){
  // Job started
  // You can use jobPromise.cancel() to abort this job.
})
.on('stalled', function(job){
  // Job that was considered stalled. Useful for debugging job workers that crash or pause the event loop.
})
.on('progress', function(job, progress){
  // Job progress updated!
})
.on('completed', function(job, result){
  // Job completed with output result!
})
.on('failed', function(job, err){
  // Job failed with reason err!
})
.on('paused', function(){
  // The queue has been paused
})
.on('resumed', function(job){
  // The queue has been resumed
})
.on('cleaned', function(jobs, type) {
  //jobs is an array of cleaned jobs
  //type is the type of job cleaned
  //see clean for details
});
```

Events are by default local, i.e., they only fire on the listeners that are registered on the given worker,
if you need to listen to events globally, just prefix the event with ```global:```:
```
// Local Event listener
queue.on('completed', listener):

// Global Event listener
queue.on('global:completed', listener);
```

Queues are cheap, so if you need many of them just create new ones with different
names:
```javascript
var userJohn = new Queue('john');
var userLisa = new Queue('lisa');
.
.
.
```

Queues are robust and can be run in parallel in several threads or processes
without any risk of hazards or queue corruption. Check this simple example
using cluster to parallelize jobs across processes:
```javascript
var
  Queue = require('bull'),
  cluster = require('cluster');

var numWorkers = 8;
var queue = new Queue("test concurrent queue");

if(cluster.isMaster){
  for (var i = 0; i < numWorkers; i++) {
    cluster.fork();
  }

  cluster.on('online', function(worker) {
    // Lets create a few jobs for the queue workers
    for(var i=0; i<500; i++){
      queue.add({foo: 'bar'});
    };
  });

  cluster.on('exit', function(worker, code, signal) {
    console.log('worker ' + worker.process.pid + ' died');
  });
}else{
  queue.process(function(job, jobDone){
    console.log("Job done by worker", cluster.worker.id, job.jobId);
    jobDone();
  });
}
```

Important Notes
---------------

The queue aims for "at most once" working strategy. When a worker is processing a job it will keep the job "locked" so other workers can't process it.

It's important to understand how locking works to prevent your jobs from losing their lock - becoming _stalled_ - and being restarted as a result. Locking is implemented internally by creating a lock for `lockDuration` on interval `lockRenewTime` (which is usually half `lockDuration`). If `lockDuration` elapses before the lock can be renewed, the job will be considered stalled and is automatically restarted; it will be __double processed__. This can happen when:
1. The Node process running your job processor unexpectedly terminates.
2. Your job processor was too CPU-intensive and stalled the Node event loop, and as a result, Bull couldn't renew the job lock (see #488 for how we might better detect this). You can fix this by breaking your job processor into smaller parts so that no single part can block the Node event loop. Alternatively, you can pass a larger value for the `lockDuration` setting (with the tradeoff being that it will take longer to recognize a real stalled job).

As such, you should always listen for the `stalled` event and log this to your error monitoring system, as this means your jobs are likely getting double-processed.

As a safeguard so problematic jobs won't get restarted indefinitely (e.g. if the job processor aways crashes its Node process), jobs will be recovered from a stalled state a maximum of `maxStalledCount` times (default: `1`).

Reusing Redis connections
-------------------------

A standard queue requires 3 connections to a redis server. In some situations when having many queues, and using
services such as Heroku where number of connections is limited, it is desirable to reuse some connections.
This can be achieved using the "createClient" option in the queue constructor:

```js
  var client, subscriber;
  client = new redis();
  subscriber = new redis();

  var opts = {
    createClient: function(type, opts){
      switch(type){
        case 'client':
          return client;
        case 'subscriber':
          return subscriber;
        default:
          return new redis(opts);
        }
    }
  }
  var queueFoo = new Queue('foobar', opts);
  var queueQux = new Queue('quxbaz', opts);
```


Useful patterns
---------------

#### Message Queue

Bull can also be used for persistent message queues. This is a quite useful
feature in some usecases. For example, you can have two servers that need to
communicate with each other. By using a queue the servers do not need to be online
at the same time, this create a very robust communication channel. You can treat
*add* as *send* and *process* as *receive*:

Server A:
```javascript
var Queue = require('bull');

var sendQueue = new Queue("Server B");
var receiveQueue = new Queue("Server A");

receiveQueue.process(function(job, done){
  console.log("Received message", job.data.msg);
  done();
});

sendQueue.add({msg:"Hello"});
```

Server B:
```javascript
var Queue = require('bull');

var sendQueue = new Queue("Server A");
var receiveQueue = new Queue("Server B");

receiveQueue.process(function(job, done){
  console.log("Received message", job.data.msg);
  done();
});

sendQueue.add({msg:"World"});
```


#### Returning job completions

A common pattern is where you have a cluster of queue processors that just
process jobs as fast as they can, and some other services that need to take the
result of this processors and do something with it, maybe storing results in a
database.

The most robust and scalable way to accomplish this is by combining the standard
job queue with the message queue pattern: a service sends jobs to the cluster
just by opening a job queue and adding jobs to it, the cluster will start
processing as fast as it can. Everytime a job gets completed in the cluster a
message is send to a results message queue with the result data, this queue is
listened by some other service that stores the results in a database.


## Documentation

* [Queue](#queue)
* [Queue##process](#process)
* [Queue##add](#add)
* [Queue##pause](#pause)
* [Queue##resume](#resume)
* [Queue##count](#count)
* [Queue##empty](#empty)
* [Queue##clean](#clean)
* [Queue##close](#close)
* [Queue##getJob](#getJob)
* [Queue##getJobCounts](#getJobCounts)
* [Job](#job)
* [Job##remove](#remove)


## Reference

<a name="queue"/>

### Queue

```typescript
new Queue(queueName: string, redisConnectionString?: string, opts: QueueOptions): Queue
```

This is the Queue constructor. It creates a new Queue that is persisted in
Redis. Everytime the same queue is instantiated it tries to process all the
old jobs that may exist from a previous unfinished session.

If no connection string or options passed, the queue will use ioredis default connection
settings.

__Arguments__

```typescript
    queueName: string, // A unique name for this Queue.
    redisConnectionString?: string, // string A connection string containing the redis server host, port and (optional) authentication.
    opts?: QueueOptions, // Options to pass to the redis client. https://github.com/luin/ioredis/blob/master/API.md#new-redisport-host-options
```

```typescript
  interface QueueOptions {
    prefix?: string = 'bull',
    redis : RedisOpts, // ioredis defaults
    createClient?: (type: enum('client', 'subscriber'), redisOpts?: RedisOpts) => redisClient,

    // Advanced settings (see below)
    settings?: QueueSettings {
      lockDuration?: number = 5000,
      lockRenewTime?: number = lockDuration / 2,
      stalledInterval?: number = 5000,
      maxStalledCount?: number = 1,
      guardInterval?: number = 5000,
      retryProcessDelay?: number = 5000,
    }
  }
```

__Advanced Settings__

__Warning:__ Do not override these advanced settings unless you understand the internals of the queue.

`lockDuration`: Time in milliseconds to acquire the job lock. Set this to a higher value if you find that your jobs are being stalled because your job processor is CPU-intensive and blocking the event loop (see note below about stalled jobs). Set this to a lower value if your jobs are extremely time-sensitive and it might be OK if they get double-processed (due to them being falsly considered stalled).

`lockRenewTime`: Interval in milliseconds on which to acquire the job lock. It is set to `lockDuration / 2` by default to give enough buffer to renew the lock each time before the job lock expires. It should never be set to a value larger than `lockDuration`. Set this to a lower value if you're finding that jobs are becoming stalled due to a CPU-intensive job processor function. Generally you shouldn't change this though.

`stalledInterval`: Interval in milliseconds on which each worker will check for stalled jobs. See note below about stalled jobs. Set this to a lower value if your jobs are extremely time-sensitive. Set this to a higher value if your Redis CPU usage is high as this check can be expensive. Note that because each worker runs this on its own interval and checks the entire queue, the stalled job check actually runs on the queue much more frequently than this value would imply.

`maxStalledCount`: The maximum number of times a stalled job can be restarted before it will be permamently failed with the error `job stalled more than allowable limit`. This is set to a default of `1` with the assumption that stalled jobs should be very rare (i.e. only due to process crashes) and you want to be on the safer side of not double-processing jobs. Set this higher if stalled jobs are common (e.g. processes crash a lot) and it's generally OK to double-process jobs.

`guardInterval`: Interval in milliseconds on which the delayed job watchdog will run. This watchdog is only in place for unstable Redis connections which can caused delayed jobs to not be processed. Set to a lower value if your Redis connection is unstable and delayed jobs aren't being processed in time.

`retryProcessDelay`: Time in milliseconds in which to wait before trying to process jobs, in case of a Redis error. Set to a lower value if your Redis connection is unstable.

---------------------------------------


<a name="process"/>

#### Queue##Process

```ts
process(name?: string, concurrency?: number, processor: (job, done?) => Promise<any>)
```

Defines a processing function for the jobs placed into a given Queue.

The callback is called everytime a job is placed in the queue. It is passed
an instance of the job as first argument.

If the callback signature contains the second optional `done` argument,
the callback will be passed a `done` callback to be called after the job
has been completed. The `done` callback can be called with an Error instance,
to signal that the job did not complete successfully, or with a result as
second argument as second argument (e.g.: `done(null, result);`) when the
job is successful.
Errors will be passed as a second argument to the "failed" event;
results, as a second argument to the "completed" event.

If, however, the callback signature does not contain the `done` argument,
a promise must be returned to signal job completion.
If the promise is rejected, the error will be passed as
a second argument to the "failed" event.
If it is resolved, its value will be the "completed" event's second argument.

A name argument can be provided so that multiple process functions can be
defined per queue. A named process will only process jobs that matches
the given name.

**Note:** in order to determine whether job completion is signaled by
returning a promise or calling the `done` callback, Bull looks at
the length property of the callback you pass to it.
So watch out, as the following won't work:

```javascript
// THIS WON'T WORK!!
queue.process(function(job, done) { // Oops! done callback here!
    return Promise.resolve();
});
```

This, however, will:

```javascript
queue.process(function(job) { // No done callback here :)
    return Promise.resolve();
});
```

You can specify a concurrency. Bull will then call you handler in parallel respecting this max number.


---------------------------------------

<a name="add"/>

#### Queue##add

```ts
add(name?: string, data: any, opts?: JobOpt): Promise<Job>
```

Creates a new job and adds it to the queue. If the queue is empty the job
will be executed directly, otherwise it will be placed in the queue and
executed as soon as possible.

An optional name can be added, so that only process functions defined
for that name will process the job.

```typescript
interface JobOpts{
  priority: number; // Optional priority value. ranges from 1 (highest priority) to MAX_INT  (lowest priority). Note that
                    // using priorities has a slight impact on performance, so do not use it if not required.

  delay: number; // An amount of miliseconds to wait until this job can be processed. Note that for accurate delays, both 
                 // server and clients should have their clocks synchronized. [optional].

  attempts: number; // The total number of attempts to try the job until it completes.

  backoff: number | BackoffOpts; // Backoff setting for automatic retries if the job fails

  lifo: boolean; // if true, adds the job to the right of the queue instead of the left (default false)
  timeout: number; // The number of milliseconds after which the job should be fail with a timeout error [optional]

  jobId: number | string; // Override the job ID - by default, the job ID is a unique
                          // integer, but you can use this setting to override it.
                          // If you use this option, it is up to you to ensure the
                          // jobId is unique. If you attempt to add a job with an id that
                          // already exists, it will not be added.

  removeOnComplete: boolean; // If true, removes the job when it successfully
                            // completes. Default behavior is to keep the job in the completed set.

  removeOnFail: boolean; // If true, removes the job when it fails after all attempts.
                         // Default behavior is to keep the job in the failed set.
}
```

```typescript
interface BackoffOpts{
  type: string; // Backoff type, which can be either `fixed` or `exponential`
  delay: number; // Backoff delay, in milliseconds.
}
```

---------------------------------------


<a name="pause"/>

#### Queue##pause

```ts
pause(isLocal?: boolean): Promise
```

Returns a promise that resolves when the queue is paused. A paused queue will not
process new jobs until resumed, but current jobs being processed will continue until
they are finalized. The pause can be either global or local. If global, all workers
in all queue instances for a given queue will be paused. If local, just this worker will
stop processing new jobs after the current lock expires. This can be useful to stop a 
worker from taking new jobs prior to shutting down.

Pausing a queue that is already paused does nothing.


---------------------------------------


<a name="resume"/>

#### Queue##resume

```ts
resume(isLocal?: boolean): Promise
```

Returns a promise that resolves when the queue is resumed after being paused.
The resume can be either local or global. If global, all workers in all queue
instances for a given queue will be resumed. If local, only this worker will be
resumed. Note that resuming a queue globally will *not* resume workers that have been
paused locally; for those, `resume(true)` must be called directly on their instances.

Resuming a queue that is not paused does nothing.

---------------------------------------


<a name="count"/>

#### Queue##count

```ts
count(): Promise<number>
```

Returns a promise that returns the number of jobs in the queue, waiting or
delayed. Since there may be other processes adding or processing jobs, this
value may be true only for a very small amount of time.


---------------------------------------

<a name="empty"/>

#### Queue##empty

```ts
empty(): Promise
```

Empties a queue deleting all the input lists and associated jobs.


---------------------------------------

<a name="close"/>

#### Queue##close

```ts
close(): Promise
```
Closes the underlying redis client. Use this to perform a graceful
shutdown.

```javascript
var Queue = require('bull');
var queue = new Queue('example');

var after100 = _.after(100, function () {
  queue.close().then(function () { console.log('done') })
});

queue.on('completed', after100);
```

`close` can be called from anywhere, with one caveat: if called
from within a job handler the queue won't close until *after*
the job has been processed, so the following won't work:

```javascript
queue.process(function (job, jobDone) {
  handle(job);
  queue.close().then(jobDone);
});
```

Instead, do this:

```javascript
queue.process(function (job, jobDone) {
  handle(job);
  queue.close();
  jobDone();
});
```

Or this:

```javascript
queue.process(function (job) {
  queue.close();
  return handle(job).then(...);
});
```


---------------------------------------

<a name="getJob"/>

#### Queue##getJob

```ts
getJob(jobId: string): Promise<Job>
```

Returns a promise that will return the job instance associated with the `jobId`
parameter. If the specified job cannot be located, the promise will be resolved to `null`.


---------------------------------------

<a name="getJobCounts"/>

#### Queue##getJobCounts

```ts
getJobCounts() : Promise<JobCounts>
```

Returns a promise that will return the job counts for the given queue.

```typescript{
  interface JobCounts {
    wait: number,
    active: number,
    completed: number,
    failed: number,
    delayed: number 
  }
}
```

---------------------------------------

<a name="clean"/>

#### Queue##clean

```ts
clean(grace: number, status?: string, limit?: number): Promise<number[]>
```

Tells the queue remove jobs of a specific type created outside of a grace period.

__Example__

```javascript
//cleans all jobs that completed over 5 seconds ago.
queue.clean(5000);
//clean all jobs that failed over 10 seconds ago.
queue.clean(10000, 'failed');
queue.on('cleaned', function (job, type) {
  console.log('Cleaned %s %s jobs', job.length, type);
});
```

__Arguments__

```javascript
  grace: number; Grace period in milliseconds.
  status: string; Status of the job to clean. Values are completed, wait, active,
  delayed, and failed. Defaults to completed.
  limit: number; maximum amount of jobs to clean per call. If not provided will clean all matching jobs.
  
  returns Promise; A promise that resolves with an array of removed jobs.
```

__Events__

The cleaner emits the `cleaned` event anytime the queue is cleaned.

```typescript
  queue.on('cleaned', listener: (jobs: number[], status: string) => void);
```

---------------------------------------

<a name="job"/>

### Job

A job includes all data needed to perform its execution, as well as the progress
method needed to update its progress.

The most important property for the user is Job##data that includes the
object that was passed to [Queue##add](#add), and that is normally used to
perform the job.

---------------------------------------

<a name="remove"/>

#### Job##remove

```ts
remove(): Promise
```

Removes a Job from the queue from all the lists where it may be included.


---------------------------------------

<a name="retry"/>

#### Job##retry

```ts
retry(): Promise
```

Re-run a Job that has failed. Returns a promise that resolves when the job is scheduled for retry.


---------------------------------------

<a name="discard"/>

#### Job##discard

```ts
discard(): Promise
```

Ensure this job is never ran again even if attemptsMade is less than `job.attempts`

---------------------------------------

<a name="promote"/>

#### Job##promote

```ts
promote(): Promise
```

Promotes a job that is delayed to be placed on the wait state and executed as soon as
possible.

---------------------------------------

<a name="priorityQueue"/>

###PriorityQueue(queueName, redisPort, redisHost, [redisOpts])

### DEPRECATION notice
The priority queue has been deprecated since version 2.2.0 in favor of a new option, *priority* in [Queue##add](#add).
The priorityQueue will be removed from the code base in version 3.0.0.
--

This is the Queue constructor of priority queue. It works same a normal queue, with same function and parameters.
The only difference is that the Queue#add() allow an options opts.priority that could take
["low", "normal", "medium", "high", "critical"]. If no options provider, "normal" will be taken.

The priority queue will process more often higher priority jobs than lower.

```javascript
  var PriorityQueue = require("bull/lib/priority-queue");

  var queue = new PriorityQueue("myPriorityQueues");

  queue.add({todo: "Improve feature"}, {priority: "normal"});
  queue.add({todo: "Read 9gags"}, {priority: "low"});
  queue.add({todo: "Fix my test unit"}, {priority: "critical"});

  queue.process(function(job, done) {
    console.log("I have to: " + job.data.todo);
    done();
  });
```

Warning!!: Priority queue use 5 times more Redis connections than a normal queue.


#### Debugging

To see debug statements set or add `bull` to the NODE_DEBUG environment variable.

```bash
export NODE_DEBUG=bull
```

##License

(The MIT License)

Copyright (c) 2013 Manuel Astudillo <manuel@optimalbits.com>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
