
<div align="center">
  <img src="https://image.freepik.com/free-icon/strong-bull-side-view_318-52710.jpg" width="200" />
  <h3>Bull</h3>
  <br/>
  <p>
    The fastest, most reliable, Redis-based queue for Node. <br/>
    Carefully written for rock solid stability and atomicity.
  </p>
  <br/>
  <p>
    <a href="#sponsors"><strong>Sponsors</strong></a> · 
    <a href="#features"><strong>Features</strong></a> · 
    <a href="#uis"><strong>UIs</strong></a> · 
    <a href="#install"><strong>Install</strong></a> · 
    <a href="#quickstart"><strong>Quickstart</strong></a> · 
    <a href="#documentation"><strong>Documentation</strong></a> · 
    <a href="./CONTRIBUTING.md"><strong>Contributing!</strong></a>
  </p>
  <p>
    <a href="https://gitter.im/OptimalBits/bull">
      <img src="https://badges.gitter.im/Join%20Chat.svg"/>
    </a>
    <a href="https://gitter.im/OptimalBits/bull">
      <img src="https://img.shields.io/npm/dm/bull.svg?maxAge=2592000"/>
    </a>
    <a href="http://travis-ci.org/OptimalBits/bull">
      <img src="https://img.shields.io/travis/OptimalBits/bull/master.svg"/>
    </a>
    <a href="http://badge.fury.io/js/bull">
      <img src="https://badge.fury.io/js/bull.svg"/>
    </a>
    <a href="http://isitmaintained.com/project/OptimalBits/bull">
      <img src="http://isitmaintained.com/badge/open/OptimalBits/bull.svg"/>
    </a>
    <a href="http://isitmaintained.com/project/OptimalBits/bull">
      <img src="http://isitmaintained.com/badge/resolution/OptimalBits/bull.svg"/>
    </a>
  </p>
  <br/>
  <p>
    <em>Follow <a href="http://twitter.com/manast">@manast</a> for news and updates regarding this library!</em>
  </p>
</div>


---


### Sponsors

<a href="http://mixmax.com">
<img src="https://mixmax.com/images/logo_confirmation.png" alt="Mixmax, Inc" width="100" />
</a>
<a href="http://optimalbits.com">
  <img src="http://optimalbits.com/images/logo.png" />
</a>

Are you developing bull sponsored by a company? Please, let us now!


---


### Features

- [x] Minimal CPU usage due to a polling-free design.
- [x] Robust design based on Redis.
- [x] Delayed jobs.
- [x] Retries.
- [x] Priority.
- [x] Concurrency.
- [x] Pause/resume—globally or locally.
- [x] Automatic recovery from process crashes.

And coming up on the roadmap...

- [ ] Multiple job types per queue.
- [ ] Scheduling jobs as a cron specification.
- [ ] Rate limiter for jobs.
- [ ] Parent-child jobs relationships.


---


### UIs

There are a few third-party UIs that you can use for monitoring:

- [bull-ui](https://github.com/OptimalBits/bull-ui)
- [matador](https://github.com/ShaneK/Matador)
- [react-bull](https://github.com/kfatehi/react-bull)
- [toureiro](https://github.com/Epharmix/Toureiro)


---


### Install

```shell
npm install bull@2.x --save
```

_**Requirements:** Bull requires a Redis version greater than or equal to `2.8.11`._

_**Important:** We are currently developing Bull `3.x`, which means that the latest *unstable* version would be something like `3.0.0-alpha.1`. We recommend you stick to version `2.x` until `3.x` is stable. Check out [the milestone](https://github.com/OptimalBits/bull/milestone/4) for some things to expect in the next version!_


---


### Quickstart

```js
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

```js
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

```js
queue.pause().then(function(){
  // queue is paused now
});

queue.resume().then(function(){
  // queue is resumed now
})
```

A queue also emits some useful events, for example...

```js
queue.on('completed', function(job, result){
  console.log('Job completed with result!', result)
})
```

For more information on events, including the full list of events that are fired, check out the [Events reference](./REFERENCE.md#events)

Queues are cheap, so if you need many of them just create new ones with different names:

```js
var userJohn = Queue('john');
var userLisa = Queue('lisa');
...
```

Queues are robust and can be run in parallel in several threads or processes without any risk of hazards or queue corruption. Check this simple example using cluster to parallelize jobs across processes:

```js
var Queue = require('bull');
var cluster = require('cluster');

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



---


### Important Notes

Bull aims for an "at most once" working strategy. When a worker is processing a job, it will keep the job locked until the work is done. However, it is important that the worker does not lock the event loop for too long, otherwise other workers might pick up the job believing that the original worker has stalled out.


---


### Documentation

For the full documentation, check out the reference and common patterns:

- [Reference](./REFERENCE.md) — the full reference material for Bull.
- [Patterns](./PATTERNS.md) — a set of examples for common patterns.
- [License](./LICENSE.md) — the Bull license—it's MIT.

If you see anything that could use more docs, please submit a pull request!
