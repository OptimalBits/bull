Bull Job Manager
================

![bull](http://files.softicons.com/download/animal-icons/animal-icons-by-martin-berube/png/128/bull.png)

A minimalistic, robust and fast job processing queue. 
Designed with stability and atomicity in mind. The API is inspired by Kue.

It uses redis for persistence, so the queue is not lost if the server goes 
down for any reason.

If you need more features than the one provided by Bull check 
[Kue](https://github.com/learnboost/kue) but keep in mind this open
[issue](https://github.com/LearnBoost/kue/issues/130).

[![BuildStatus](https://secure.travis-ci.org/OptimalBits/bull.png?branch=master)](http://travis-ci.org/optimalbits/bull)

Install:
--------

    npm install bull

Quick Guide
-----------

    var Queue = require('bull');
    
    var queue = new Queue('media transcoding', 6379, '127.0.0.1'));
    
    queue.process('video transcode', function(job, done){
      // transcode video asynchronously and report progress
      job.progress(42);
      
      // call done when finished
      done();
      
      // or give a error if error
      done(Error('error transcoding'));
    });

    queue.process('audio transcode', function(job, done){
      // transcode audio asynchronously and report progress
      job.progress(42);
      
      // call done when finished
      done();
      
      // or give a error if error
      done(Error('error transcoding'));
    });
    
    queue.process('image transcode', function(job, done){
      // transcode image asynchronously and report progress
      job.progress(42);
      
      // call done when finished
      done();
      
      // or give a error if error
      done(Error('error transcoding'));
    });
    
    queue.createJob('video transcode', {video: 'http://example.com/video1.mov'});
    queue.createJob('audio transcode', {audio: 'http://example.com/audio1.mp3'});
    queue.createJob('image transcode', {image: 'http://example.com/image1.tiff'});

A queue emits also some useful events:

    queue.on('completed', function(job){
      // Job completed!
    })
    .on('failed', function(job, err){
      // Job failed with reason err!
    })
    .on('progress', function(job, progress){
      // Job progress updated!
    })
    


##Documentation

    * [Queue](#queue)
    * [Queue##process](#process)
    * [Queue##createJob](#createJob)
    
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
#### process(jobName, function(job, done))

Defines a processing function for the jobs with the given name.

The callback is called everytime a job in the queue matches the name and
provides an instance of the job and a done callback to be called after the
job has been completed. If done can be called providing an Error instsance
to signal that the job did not complete successfully. 
    
__Arguments__
 
```javascript
    jobName {String} A job type name.
    cb {Function} A callback called for every job of the given name.
```

---------------------------------------
  
<a name="createJob"/>
#### createJob(jobName, args)

Creates a new job and adds it to the queue. If the queue is empty the job
will be executed directly, otherwise it will be placed in the queue and 
executed as soon as possible.
    
__Arguments__
 
```javascript
  jobName {String} A job type name.
  args {PlainObject} A plain object with arguments that will be passed
    to the job processing function in job.data.
  returns {Promise} A promise that resolves when the job has been succesfully
    added to the queue (or rejects if some error occured).
```

---------------------------------------


<a name="job"/>
### Job

A job includes all data needed to perform its execution, as well as the progress
method needed to update its progress.
    
The most important property for the user is Job##data that includes the
object that was passed to Queue##createJob, and that is normally used to 
perform the job.

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

