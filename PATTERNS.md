
Patterns
========

Here are a few examples of useful patterns that are often implemented with Bull:

- [Message Queue](#message-queue)
- [Returning Job Completions](#returning-job-completions)
- [Reusing Redis Connections](#reusing-redis-connections)
- [Redis Cluster](#redis-cluster)
- [Debugging](#debugging)
- [Custom backoff strategy](#custom-backoff-strategy)
- [Manually fetching jobs](#manually-fetching-jobs)

If you have any other common patterns you want to add, pull request them!


Message Queue
-------------

Bull can also be used for persistent message queues. This is a quite useful
feature in some use cases. For example, you can have two servers that need to
communicate with each other. By using a queue the servers do not need to be online at the same time, so this creates a very robust communication channel. You can treat `add` as *send* and `process` as *receive*:

Server A:

```js
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

```js
var Queue = require('bull');

var sendQueue = new Queue("Server A");
var receiveQueue = new Queue("Server B");

receiveQueue.process(function(job, done){
  console.log("Received message", job.data.msg);
  done();
});

sendQueue.add({msg:"World"});
```


Returning Job Completions
-------------------------

A common pattern is where you have a cluster of queue processors that just process jobs as fast as they can, and some other services that need to take the result of this processors and do something with it, maybe storing results in a database.

The most robust and scalable way to accomplish this is by combining the standard job queue with the message queue pattern: a service sends jobs to the cluster just by opening a job queue and adding jobs to it, and the cluster will start processing as fast as it can. Everytime a job gets completed in the cluster a message is sent to a results message queue with the result data, and this queue is listened by some other service that stores the results in a database.


Reusing Redis Connections
-------------------------

A standard queue requires **3 connections** to the Redis server. In some situations you might want to re-use connections—for example on Heroku where the connection count is restricted. You can do this with the `createClient` option in the `Queue` constructor:

```js
var {REDIS_URL} = process.env

var Redis = require('ioredis')
var client = new Redis(REDIS_URL);
var subscriber = new Redis(REDIS_URL);

var opts = {
  createClient: function (type) {
    switch (type) {
      case 'client':
        return client;
      case 'subscriber':
        return subscriber;
      default:
        return new Redis(REDIS_URL);
    }
  }
}

var queueFoo = new Queue('foobar', opts);
var queueQux = new Queue('quxbaz', opts);
```

Redis cluster
-------------

Bull internals requires atomic operations that spans different keys. This fact breaks Redis'
rules for cluster configurations. However it is still possible to use a cluster environment
by using the proper bull prefix option as a cluster "hash tag". Hash tags are used to guarantee
that certain keys are placed in the same hash slot, read more about hash tags in the [redis cluster
tutorial](https://redis.io/topics/cluster-tutorial).

A hash tag is defined with brackets. I.e. a key that has a substring inside brackets will use that
substring to determine in which hash slot the key will be placed. So to make bull compatible with
cluster, just use a queue prefix inside brackets, for example:

```js
  var queue = new Queue('cluster', {
    prefix: '{myprefix}'
  })
```

If you use several queues in the same cluster, you should use different prefixes so that the
queues are evenly placed in the cluster nodes.

Debugging
---------

To see debug statements set or add `bull` to the `NODE_DEBUG` environment variable:

```bash
export NODE_DEBUG=bull
```

```bash
NODE_DEBUG=bull node ./your-script.js
```

Custom backoff strategy
-----------------------

When the builtin backoff strategies on retries are not sufficient, a custom strategy can be defined. Custom backoff strategies are defined by a function on the queue. The number of attempts already made to process the job is passed to this function as the first parameter, and the error that the job failed with as the second parameter.
The function returns either the time to delay the retry with, 0 to retry immediately or -1 to fail the job immediately.

```js
var Queue = require('bull');

var myQueue = new Queue("Server B", {
  settings: {
    backoffStrategies: {
      jitter: function (attemptsMade, err) {
        return 5000 + Math.random() * 500;
      }
    }
  }
});
```

The new backoff strategy can then be specified on the job, using the name defined above:

```js
myQueue.add({foo: 'bar'}, {
  attempts: 3,
  backoff: {
    type: 'jitter'
  }
});
```

You may base your backoff strategy on the error that the job throws:
```js
var Queue = require('bull');

function MySpecificError() {}

var myQueue = new Queue('Server C', {
  settings: {
    backoffStrategies: {
      foo: function (attemptsMade, err) {
        if (err instanceof MySpecificError) {
          return 10000;
        }
        return 1000;
      }
    }
  }
});

myQueue.process(function(job, done){
  if (job.data.msg === 'Specific Error') {
    throw new MySpecificError();
  } else {
    throw new Error();
  }
});

myQueue.add({msg: 'Hello'}, {
  attempts: 3,
  backoff: {
    type: 'foo'
  }
});

myQueue.add({msg: 'Specific Error'}, {
 attempts: 3,
 backoff: {
   type: 'foo'
 }
});
```

Manually fetching jobs
----------------------------------

If you want the actual job processing to be done in a seperate repo/service than where `bull` is running, this pattern may be for you.

Manually transitioning states for jobs can be done with a few simple methods.

1. Adding a job to the 'waiting' queue. Grab the queue and call `add`.

```typescript
import Queue from "bull";

const queue = new Queue(
  limiter: {
    max: 5,
    duration: 5000,
    bounceBack: true // important
  },
  ...queueOptions
});
queue.add({ random_attr: "random_value" });
```

2. Pulling a job from 'waiting' and moving it to 'active'.

```typescript
const job: Job = await queue.getNextJob();
```

3. Move the job to the 'failed' queue if something goes wrong.

```typescript
const (nextJobData, nextJobId) = await job.moveToFailed(
  {
    message: "Call to external service failed!",
  },
  true,
);
```

3. Move the job to the 'completed' queue.

```typescript
const (nextJobData, nextJobId) = await job.moveToCompleted("succeeded", true);
```

4. Return the next job if one is returned.

```typescript
if (nextJobdata) {
  return Job.fromJSON(queue, nextJobData, nextJobId);
}
```

Then you can easily wrap `bull` in an API for use with external systems.
