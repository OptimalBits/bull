Bull Job Manager
================

![bull](http://files.softicons.com/download/animal-icons/animal-icons-by-martin-berube/png/128/bull.png)

A lightweight, robust and fast job processing queue.
Designed with stability and atomicity in mind. The API is inspired by Kue.

It uses redis for persistence, so the queue is not lost if the server goes
down for any reason.

If you need more features than the ones provided by Bull check
[Kue](https://github.com/learnboost/kue) but keep in mind this open
[issue](https://github.com/LearnBoost/kue/issues/130).

[![BuildStatus](https://secure.travis-ci.org/OptimalBits/bull.png?branch=master)](http://travis-ci.org/OptimalBits/bull)

Follow [manast](http://twitter.com/manast) for news and updates regarding this library.

Install:
--------

    npm install bull

Note that you need a redis version higher or equal than 2.6.12 for bull to work.

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
at the same time, this create a very robust communication channel:

```javascript
var Queue = require('bull');

// If we are server one, we will use queueOne for sending and queue two for
// receiving.

var sendQueue = Queue("server one message queue", 6379, '127.0.0.1');
var receiveQueue = Queue("server two message queue", 6379, '127.0.0.1');

// we can send any JSON stringfiable data
sendQueue.add({msg: 'this is a test message'});

// And receive as well
receiveQueue.process(function(msg, msgDone){
  console.log('Received message from server two: %s', msg);
  msgDone();
});
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
    redisOptions {Object} Optional options to pass to the redis client.
```

---------------------------------------


<a name="process"/>
#### Queue##process(function(job, done))

Defines a processing function for the jobs placed into a given Queue.

The callback is called everytime a job is placed in the queue and
provides an instance of the job and a done callback to be called after the
job has been completed. If done can be called providing an Error instsance
to signal that the job did not complete successfully.

__Arguments__

```javascript
    jobName {String} A job type name.
    cb {Function} A callback called for every job of the given name.
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
  opts.lifo {Boolean} A boolean which, if true, adds the job to the right
    of the queue instead of the left (default false)
  returns {Promise} A promise that resolves when the job has been succesfully
    added to the queue (or rejects if some error occured).
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

