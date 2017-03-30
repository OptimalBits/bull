Bull Job Manager
================

[![Join the chat at https://gitter.im/OptimalBits/bull](https://badges.gitter.im/Join%20Chat.svg)](https://gitter.im/OptimalBits/bull?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)
[![npm](https://img.shields.io/npm/dm/bull.svg?maxAge=2592000)]()
[![BuildStatus](https://secure.travis-ci.org/OptimalBits/bull.png?branch=master)](http://travis-ci.org/OptimalBits/bull)
[![NPM version](https://badge.fury.io/js/bull.svg)](http://badge.fury.io/js/bull)
[![Percentage of issues still open](http://isitmaintained.com/badge/open/OptimalBits/bull.svg)](http://isitmaintained.com/project/OptimalBits/bull "Percentage of issues still open")
[![Average time to resolve an issue](http://isitmaintained.com/badge/resolution/OptimalBits/bull.svg)](http://isitmaintained.com/project/OptimalBits/bull "Average time to resolve an issue")


<img src="https://image.freepik.com/free-icon/strong-bull-side-view_318-52710.jpg" width="200" />

The fastest, most reliable redis based queue for nodejs.
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

We also have an official UI which is at the moment bare bones project: [bull-ui](https://github.com/OptimalBits/bull-ui)

Roadmap:
--------

- Multiple job types per queue.
- Scheduling jobs as a cron specification.
- Rate limiter for jobs.
- Parent-child jobs relationships.


Install:
--------

    npm install bull

Note that you need a redis version higher or equal than 2.8.11 for bull to work properly.

Quick Guide
-----------
```javascript
var Queue = require('bull');

var videoQueue = Queue('video transcoding', 6379, '127.0.0.1');
var audioQueue = Queue('audio transcoding', 6379, '127.0.0.1');
var imageQueue = Queue('image transcoding', 6379, '127.0.0.1');
var pdfQueue = Queue('pdf transcoding', 6379, '127.0.0.1');

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
  throw (Error('some unexpected error'));
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
  throw (Error('some unexpected error'));
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
  throw (Error('some unexpected error'));
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
var userJohn = Queue('john');
var userLisa = Queue('lisa');
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
var queue = Queue("test concurrent queue", 6379, '127.0.0.1');

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

The queue aims for "at most once" working strategy. When a worker is processing a job, it will keep the job locked until the work is done. However, it is important that the worker does not lock the event loop too long, otherwise other workers could pick the job believing that the worker processing it has been stalled.

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
    redis: {
      opts: {
        createClient: function(type){
          switch(type){
            case 'client':
              return client;
            case 'subscriber':
              return subscriber;
            default:
              return new redis();
          }
        }
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

var sendQueue = Queue("Server B");
var receiveQueue = Queue("Server A");

receiveQueue.process(function(job, done){
  console.log("Received message", job.data.msg);
  done();
});

sendQueue.add({msg:"Hello"});
```

Server B:
```javascript
var Queue = require('bull');

var sendQueue = Queue("Server A");
var receiveQueue = Queue("Server B");

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

```ts
Queue(queueName: string, redisPort: number, redisHost: string, redisOpts?: RedisOpts): Queue
```
```ts
Queue(queueName: string, redisConnectionString: string, redisOpts? RedisOpts): Queue
```

This is the Queue constructor. It creates a new Queue that is persisted in
Redis. Everytime the same queue is instantiated it tries to process all the
old jobs that may exist from a previous unfinished session.

__Arguments__

```javascript
    queueName {String} A unique name for this Queue.
    redisPort {Number} A port where redis server is running.
    redisHost {String} A host specified as IP or domain where redis is running.
    redisOptions {Object} Options to pass to the redis client. https://github.com/luin/ioredis/blob/master/API.md#new-redisport-host-options 
```

Alternatively, it's possible to pass a connection string to create a new queue.

__Arguments__

```javascript
    queueName {String} A unique name for this Queue.
    redisConnectionString {String} A connection string containing the redis server host, port and (optional) authentication.
    redisOptions {Object} Options to pass to the redis client. https://github.com/luin/ioredis/blob/master/API.md#new-redisport-host-options
```

---------------------------------------


<a name="process"/>

#### Queue##Process

```ts
process(concurrency?: number, processor: (job, done?) => Promise<any>)
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
add(data: any, opts?: JobOpt): Promise<Job>
```

Creates a new job and adds it to the queue. If the queue is empty the job
will be executed directly, otherwise it will be placed in the queue and
executed as soon as possible.

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
var queue = Queue('example');

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

Warning!!: Priority queue use 5 times more redis connections than a normal queue.


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
