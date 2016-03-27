"use strict";

var Queue = require('./');

var videoQueue = Queue('video transcoding', 6379, '127.0.0.1');

videoQueue.process(function(job, done){
    console.log('video job %d started.', job.jobId);
    done();
});

videoQueue.on('completed', function(job) {
    console.log('video job %d completed.', job.jobId);
});

videoQueue.add({video: 'http://example.com/video1.mov'});
videoQueue.add({video: 'http://example.com/video1.mov'});
videoQueue.add({video: 'http://example.com/video1.mov'});


/**
 * 
 *  Tasks
 * 
 */
 queue.task('video', opts, function(input, next){
    
    output = do_something_with_input(input);
     
    next('postprocess', output); 
 });
 