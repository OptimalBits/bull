Bull Job Manager
================

![bull](http://files.softicons.com/download/animal-icons/animal-icons-by-martin-berube/png/128/bull.png)

A lightweight, robust and fast job processing queue.
Carefully written for rock solid stability and atomicity.

It uses redis for persistence, so the queue is not lost if the server goes
down for any reason.

[![BuildStatus](https://secure.travis-ci.org/OptimalBits/bull.png?branch=master)](http://travis-ci.org/OptimalBits/bull)
[![NPM version](https://badge.fury.io/js/bull.svg)](http://badge.fury.io/js/bull)

Follow [manast](http://twitter.com/manast) for news and updates regarding this library.

Features:
---------

- Minimal CPU usage by poll free design.
- Robust design based on Redis.
- Delayed jobs.
- Retries.
- Priority.
- Concurrency.
- Global pause/resume.


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

videoQueue.process(function(job, done){

  // job.data contains the custom data passed when the job was created
  // job.jobId contains id of this job.

  // transcode video asynchronously and report progress
  job.progress(42);

  // call done when finished
  done();

  // or give a error if error
  done(Error('error transcoding'));

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

  // If the job throws an unhandled exception it is also handled correctly
  throw (Error('some unexpected error'));
});

videoQueue.add({video: 'http://example.com/video1.mov'});
audioQueue.add({audio: 'http://example.com/audio1.mp3'});
imageQueue.add({image: 'http://example.com/image1.tiff'});
```

A queue can be paused and resumed:
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
queue.on('completed', function(job){
  // Job completed!
})
.on('failed', function(job, err){
  // Job failed with reason err!
})
.on('progress', function(job, progress){
  // Job progress updated!
})
.on('paused', function(){
  // The queue has been paused
})
.on('resumed', function(job){
  // The queue has been resumed
})
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
using cluster to parallelize jobs accross processes:
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

Useful patterns
---------------

####Message Queue

Bull can also be used for persistent messsage queues. This is a quite useful
feature in some usecases. For example, you can have two servers that need to
communicate with each other. By using a queue the servers do not need to be online
at the same time, this create a very robust communication channel. You can treat
*add* as *send* and *process* as *receive*:

Server A:
```javascript
var Queue = require('bull');

var sendQueue = Queue("Server B");
var receiveQueue = Queue("Server A");

receiveQueue.process(function(msg, done){
  console.log("Received message", msg);
  done();
});

sendQueue.add({msg:"Hello"});
```

Server B:
```javascript
var Queue = require('bull');

var sendQueue = Queue("Server A");
var receiveQueue = Queue("Server B");

receiveQueue.process(function(msg, done){
  console.log("Received message", msg);
  done();
});

sendQueue.add({msg:"World"});
```


####Returning job completions

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


##Documentation

* [Queue](#queue)
* [Queue##process](#process)
* [Queue##add](#add)
* [Queue##pause](#pause)
* [Queue##resume](#resume)
* [Queue##count](#count)
* [Queue##empty](#empty)
* [Job](#job)
* [Job##remove](#remove)


## Reference

<a name="queue"/>
###Queue(queueName, redisPort, redisHost, [redisOpts])

This is the Queue constructor. It creates a new Queue that is persisted in
Redis. Everytime the same queue is instantiated it tries to process all the
old jobs that may exist from a previous unfinished session.

__Arguments__

```javascript
    queueName {String} A unique name for this Queue.
    redisPort {Number} A port where redis server is running.
    redisHost {String} A host specified as IP or domain where redis is running.
    redisOptions {Object} Options to pass to the redis client. https://github.com/mranney/node_redis
```

---------------------------------------


<a name="process"/>
#### Queue##process([concurrency,] function(job, done))

Defines a processing function for the jobs placed into a given Queue.

The callback is called everytime a job is placed in the queue and
provides an instance of the job and a done callback to be called after the
job has been completed. If done can be called providing an Error instance
to signal that the job did not complete successfully.

You can specify a concurrency. Bull will then call you handler in parallel respecting this max number.

__Arguments__

```javascript
    job {String} The job to process.
    done {Function} The done callback to be called after the job has been completed.
```

---------------------------------------

<a name="add"/>
#### Queue##add(data, opts)

Creates a new job and adds it to the queue. If the queue is empty the job
will be executed directly, otherwise it will be placed in the queue and
executed as soon as possible.

__Arguments__

```javascript
  data {PlainObject} A plain object with arguments that will be passed
    to the job processing function in job.data.
  opts {PlainObject} A plain object with arguments that will be passed
    to the job processing function in job.opts
  opts.delay {Number} An amount of miliseconds to wait until this job
  can be processed. Note that for accurate delays, both server and clients
  should have their clocks synchronized.
  opts.lifo {Boolean} A boolean which, if true, adds the job to the right
    of the queue instead of the left (default false)
  opts.timeout {Number} The number of milliseconds after which the job
    should be fail with a timeout error [optional]
  returns {Promise} A promise that resolves when the job has been succesfully
    added to the queue (or rejects if some error occured).
```

---------------------------------------


<a name="pause"/>
#### Queue##pause()

Returns a promise that resolves when the queue is paused. The pause is
global, meaning that all workers in all queue instances for a given queue
will be paused. A paused queue will not process new jobs until resumed, but
current jobs being processed will continue until they are finalized.

Pausing a queue that is already paused does nothing.

__Arguments__

```javascript
  returns {Promise} A promise that resolves when the queue is paused.
```

---------------------------------------


<a name="resume"/>
#### Queue##resume()

Returns a promise that resolves when the queue is resumed after being paused. 
The resume is global, meaning that all workers in all queue instances for 
a given queue will be resumed. 

Resuming a queue that is not paused does nothing.

__Arguments__

```javascript
  returns {Promise} A promise that resolves when the queue is resumed.
```

---------------------------------------


<a name="count"/>
#### Queue##count()

Returns a promise that returns the number of jobs in the queue, waiting or
paused. Since there may be other processes adding or processing jobs, this
value may be true only for a very small amount of time.

__Arguments__

```javascript
  returns {Promise} A promise that resolves with the current jobs count.
```

---------------------------------------

<a name="empty"/>
#### Queue##empty()

Empties a queue deleting all the input lists and associated jobs.

__Arguments__

```javascript
  returns {Promise} A promise that resolves with the queue is emptied.
```

---------------------------------------

<a name="getJob"/>
#### Queue##getJob(jobId)

Returns a promise that will return the job instance associated with the `jobId`
parameter. If the specified job cannot be located, the promise callback parameter
will be set to `null`.

__Arguments__

```javascript
  jobId {String} A string identifying the ID of the to look up.
  returns {Promise} A promise that resolves with the job instance when the job
  has been retrieved to the queue, or null otherwise.
```

---------------------------------------


<a name="priorityQueue"/>
###PriorityQueue(queueName, redisPort, redisHost, [redisOpts])

This is the Queue constructor of priority queue. It works same a normal queue, with same function and parameters.
The only difference is that the Queue#add() allow an options opts.priority that could take
["low", "normal", "medium", "hight", "critical"]. If no options provider, "normal" will be taken.

The priority queue will process more often highter priority jobs than lower.

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

Warning: Priority queue use 5 times more redis connections than a normal queue.

<a name="job"/>
### Job

A job includes all data needed to perform its execution, as well as the progress
method needed to update its progress.

The most important property for the user is Job##data that includes the
object that was passed to Queue##add, and that is normally used to
perform the job.

---------------------------------------

<a name="remove"/>
#### Job##remove()

Removes a Job from the queue from all the lists where it may be included.

__Arguments__

```javascript
  returns {Promise} A promise that resolves when the job is removed.
```

---------------------------------------


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
