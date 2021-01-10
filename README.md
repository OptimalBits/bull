
<div align="center">
  <br/>
  <img src="./support/logo@2x.png" width="300" />
  <br/>
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
    <a href="#quick-guide"><strong>Quick Guide</strong></a> ·
    <a href="#documentation"><strong>Documentation</strong></a>
  </p>
  <p>Check the new <a href="https://optimalbits.github.io/bull/"><strong>Guide!</strong></p>
  <br/>
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
    <a href="https://coveralls.io/github/OptimalBits/bull?branch=master">
      <img src="https://coveralls.io/repos/github/OptimalBits/bull/badge.svg?branch=master"/>
    </a>
    <a href="http://isitmaintained.com/project/OptimalBits/bull">
      <img src="http://isitmaintained.com/badge/open/optimalbits/bull.svg"/>
    </a>
    <a href="http://isitmaintained.com/project/OptimalBits/bull">
      <img src="http://isitmaintained.com/badge/resolution/optimalbits/bull.svg"/>
    </a>
  </p>
  <p>
    <em>Follow <a href="http://twitter.com/manast">@manast</a> for Bull news and updates!</em>
  </p>
</div>

---

### BullMQ

If you want to start using the next major version of Bull written entirely in Typescript you are welcome to the new repo [here](https://github.com/taskforcesh/bullmq). Otherwise you are very welcome to still use Bull, which is a safe, battle tested codebase.

---

### Official FrontEnd

[<img src="http://taskforce.sh/assets/logo_square.png" width="100" alt="Taskforce.sh, Inc" style="padding: 100px"/>](https://taskforce.sh)

Super charge your queues with a profesional front end and optional Redis hosting:
- Get a complete overview of all your queues.
- Inspect jobs, search, retry, or promote delayed jobs.
- Metrics and statistics.
- and many more features.

Sign up at [Taskforce.sh](https://taskforce.sh)

---

### Bull Features

- [x] Minimal CPU usage due to a polling-free design.
- [x] Robust design based on Redis.
- [x] Delayed jobs.
- [x] Schedule and repeat jobs according to a cron specification.
- [x] Rate limiter for jobs.
- [x] Retries.
- [x] Priority.
- [x] Concurrency.
- [x] Pause/resume—globally or locally.
- [x] Multiple job types per queue.
- [x] Threaded (sandboxed) processing functions.
- [x] Automatic recovery from process crashes.

And coming up on the roadmap...

- [ ] Job completion acknowledgement.
- [ ] Parent-child jobs relationships.

---

### UIs

There are a few third-party UIs that you can use for monitoring:

**Bull v3**

- [Taskforce](https://taskforce.sh)
- [bull-board](https://github.com/vcapretz/bull-board)
- [bull-repl](https://github.com/darky/bull-repl)

**Bull <= v2**

- [Matador](https://github.com/ShaneK/Matador)
- [react-bull](https://github.com/kfatehi/react-bull)
- [Toureiro](https://github.com/Epharmix/Toureiro)

---

### Monitoring & Alerting

- With Prometheus [Bull Queue Exporter](https://github.com/UpHabit/bull_exporter)

---

### Feature Comparison

Since there are a few job queue solutions, here is a table comparing them:

| Feature         | Bull          | Kue   | Bee | Agenda |
| :-------------  |:-------------:|:-----:|:---:|:------:|
| Backend         | redis         | redis |redis| mongo  |
| Priorities      | ✓             |  ✓    |     |   ✓    |
| Concurrency     | ✓             |  ✓    |  ✓  |   ✓    |
| Delayed jobs    | ✓             |  ✓    |     |   ✓    |
| Global events   | ✓             |  ✓    |     |        |
| Rate Limiter    | ✓             |       |     |        |
| Pause/Resume    | ✓             |  ✓    |     |        |
| Sandboxed worker| ✓             |       |     |        |
| Repeatable jobs | ✓             |       |     |   ✓    |
| Atomic ops      | ✓             |       |  ✓  |        |
| Persistence     | ✓             |   ✓   |  ✓  |   ✓    |
| UI              | ✓             |   ✓   |     |   ✓    |
| Optimized for   | Jobs / Messages | Jobs | Messages | Jobs |


### Install

```bash
npm install bull --save
```
or

```bash
yarn add bull
```

_**Requirements:** Bull requires a Redis version greater than or equal to `2.8.18`._


### Typescript Definitions

```bash
npm install @types/bull --save-dev
```
```bash
yarn add --dev @types/bull
```

Definitions are currently maintained in the [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/bull) repo.


## Contributing

We welcome all types of contributions, either code fixes, new features or doc improvements.
Code formatting is enforced by [prettier](https://prettier.io/)
For commits please follow conventional [commits convention](https://www.conventionalcommits.org/en/v1.0.0-beta.2/)
All code must pass lint rules and test suites before it can be merged into develop.

---

### Quick Guide

#### Basic Usage
```js
var Queue = require('bull');

var videoQueue = new Queue('video transcoding', 'redis://127.0.0.1:6379');
var audioQueue = new Queue('audio transcoding', {redis: {port: 6379, host: '127.0.0.1', password: 'foobared'}}); // Specify Redis connection using object
var imageQueue = new Queue('image transcoding');
var pdfQueue = new Queue('pdf transcoding');

videoQueue.process(function(job, done){

  // job.data contains the custom data passed when the job was created
  // job.id contains id of this job.

  // transcode video asynchronously and report progress
  job.progress(42);

  // call done when finished
  done();

  // or give a error if error
  done(new Error('error transcoding'));

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
  done(new Error('error transcoding'));

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
  done(new Error('error transcoding'));

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

#### Using promises

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

#### Separate processes

The process function can also be run in a separate process. This has several advantages:
- The process is sandboxed so if it crashes it does not affect the worker.
- You can run blocking code without affecting the queue (jobs will not stall).
- Much better utilization of multi-core CPUs.
- Less connections to redis.

In order to use this feature just create a separate file with the processor:
```js
// processor.js
module.exports = function(job){
  // Do some heavy work

  return Promise.resolve(result);
}
```

And define the processor like this:

```js
// Single process:
queue.process('/path/to/my/processor.js');

// You can use concurrency as well:
queue.process(5, '/path/to/my/processor.js');

// and named processors:
queue.process('my processor', 5, '/path/to/my/processor.js');
```

#### Repeated jobs

A job can be added to a queue and processed repeatedly according to a cron specification:

```
  paymentsQueue.process(function(job){
    // Check payments
  });

  // Repeat payment job once every day at 3:15 (am)
  paymentsQueue.add(paymentsData, {repeat: {cron: '15 3 * * *'}});

```

As a tip, check your expressions here to verify they are correct:
[cron expression generator](https://crontab.cronhub.io)

#### Pause / Resume

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

#### Events

A queue emits some useful events, for example...
```js
.on('completed', function(job, result){
  // Job completed with output result!
})
```

For more information on events, including the full list of events that are fired, check out the [Events reference](./REFERENCE.md#events)

#### Queues performance

Queues are cheap, so if you need many of them just create new ones with different
names:
```javascript
var userJohn = new Queue('john');
var userLisa = new Queue('lisa');
.
.
.
```

However every queue instance will require new redis connections, check how to [reuse connections](https://github.com/OptimalBits/bull/blob/master/PATTERNS.md#reusing-redis-connections) or you can also use [named processors](https://github.com/OptimalBits/bull/blob/master/REFERENCE.md#queueprocess) to achieve a similar result.

#### Cluster support

NOTE: From version 3.2.0 and above it is recommended to use threaded processors instead.

Queues are robust and can be run in parallel in several threads or processes
without any risk of hazards or queue corruption. Check this simple example
using cluster to parallelize jobs across processes:
```js
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
    console.log("Job done by worker", cluster.worker.id, job.id);
    jobDone();
  });
}
```

---


### Documentation

For the full documentation, check out the reference and common patterns:

- [Guide](https://optimalbits.github.io/bull/) — Your starting point for developing with Bull.
- [Reference](./REFERENCE.md) — Reference document with all objects and methods available.
- [Patterns](./PATTERNS.md) — a set of examples for common patterns.
- [License](./LICENSE.md) — the Bull license—it's MIT.

If you see anything that could use more docs, please submit a pull request!



---

### Important Notes

The queue aims for an "at least once" working strategy. This means that in some situations, a job
could be processed more than once. This mostly happens when a worker fails to keep a lock
for a given job during the total duration of the processing.

When a worker is processing a job it will keep the job "locked" so other workers can't process it.

It's important to understand how locking works to prevent your jobs from losing their lock - becoming _stalled_ -
and being restarted as a result. Locking is implemented internally by creating a lock for `lockDuration` on interval
`lockRenewTime` (which is usually half `lockDuration`). If `lockDuration` elapses before the lock can be renewed,
the job will be considered stalled and is automatically restarted; it will be __double processed__. This can happen when:
1. The Node process running your job processor unexpectedly terminates.
2. Your job processor was too CPU-intensive and stalled the Node event loop, and as a result, Bull couldn't renew the job lock (see [#488](https://github.com/OptimalBits/bull/issues/488) for how we might better detect this). You can fix this by breaking your job processor into smaller parts so that no single part can block the Node event loop. Alternatively, you can pass a larger value for the `lockDuration` setting (with the tradeoff being that it will take longer to recognize a real stalled job).

As such, you should always listen for the `stalled` event and log this to your error monitoring system, as this means your jobs are likely getting double-processed.

As a safeguard so problematic jobs won't get restarted indefinitely (e.g. if the job processor always crashes its Node process), jobs will be recovered from a stalled state a maximum of `maxStalledCount` times (default: `1`).
