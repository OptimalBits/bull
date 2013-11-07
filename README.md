Bull Job Manager
================

![bull](http://files.softicons.com/download/animal-icons/animal-icons-by-martin-berube/png/128/bull.png)

A minimalistic, robust and fast job processing queue. 
Designed with stability and atomicity in mind. The API is inspired in Kue.

It uses redis for persistence, so the queue is not lost if the server goes 
down for any reason.

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
