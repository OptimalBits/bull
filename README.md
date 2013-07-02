Bull Job Manager
================

A node module to process jobs. Similar to Kue but with stability and atomicity
in mind.

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

    

