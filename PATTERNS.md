
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
const Queue = require('bull');

const sendQueue = new Queue('Server B');
const receiveQueue = new Queue('Server A');

receiveQueue.process(function (job, done) {
  console.log('Received message', job.data.msg);
  done();
});

sendQueue.add({ msg: 'Hello' });
```

Server B:

```js
const Queue = require('bull');

const sendQueue = new Queue('Server A');
const receiveQueue = new Queue('Server B');

receiveQueue.process(function (job, done) {
  console.log('Received message', job.data.msg);
  done();
});

sendQueue.add({ msg: 'World' });
```


Returning Job Completions
-------------------------

A common pattern is where you have a cluster of queue processors that just process jobs as fast as they can, and some other services that need to take the result of this processors and do something with it, maybe storing results in a database.

The most robust and scalable way to accomplish this is by combining the standard job queue with the message queue pattern: a service sends jobs to the cluster just by opening a job queue and adding jobs to it, and the cluster will start processing as fast as it can. Everytime a job gets completed in the cluster a message is sent to a results message queue with the result data, and this queue is listened by some other service that stores the results in a database.


Reusing Redis Connections
-------------------------

A standard queue requires **3 connections** to the Redis server. In some situations you might want to re-use connections—for example on Heroku where the connection count is restricted. You can do this with the `createClient` option in the `Queue` constructor.

Notes:
- bclient connections [cannot be re-used](https://github.com/OptimalBits/bull/issues/880), so you should return a new connection each time this is called.
- client and subscriber connections can be shared and will not be closed when the queue is closed.  When you are shutting down the process, first close the queues, then the shared connections (if they are shared).
- if you are not sharing connections but still using `createClient` to do some custom connection logic, you may still need to keep a list of all the connections you created so you can manually close them later when the queue shuts down, if you need a graceful shutdown for your process
- do not set a `keyPrefix` on the connection you create, use bull's built-in prefix feature if you need a key prefix

```js
const { REDIS_URL } = process.env;

const Redis = require('ioredis');
let client;
let subscriber;

const opts = {
  // redisOpts here will contain at least a property of connectionName which will identify the queue based on its name
  createClient: function (type, redisOpts) {
    switch (type) {
      case 'client':
        if (!client) {
          client = new Redis(REDIS_URL, redisOpts);
        }
        return client;
      case 'subscriber':
        if (!subscriber) {
          subscriber = new Redis(REDIS_URL, redisOpts);
        }
        return subscriber;
      case 'bclient':
        return new Redis(REDIS_URL, redisOpts);
      default:
        throw new Error('Unexpected connection type: ' + type);
    }
  }
}

const queueFoo = new Queue('foobar', opts);
const queueQux = new Queue('quxbaz', opts);
```

Redis cluster
-------------

Bull internals require atomic operations that span different keys. This behavior breaks Redis's
rules for cluster configurations. However, it is still possible to use a cluster environment
by using the proper bull prefix option as a cluster "hash tag". Hash tags are used to guarantee
that certain keys are placed in the same hash slot, read more about hash tags in the [redis cluster
tutorial](https://redis.io/topics/cluster-tutorial). A hash tag is defined with brackets. I.e. a key that has a substring inside brackets will use that
substring to determine in which hash slot the key will be placed.

In summary, to make bull compatible with Redis cluster, use a queue prefix inside brackets.
For example:

```js
const queue = new Queue('cluster', {
  prefix: '{myprefix}'
});
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
const Queue = require('bull');

const myQueue = new Queue('Server B', {
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

You may specify options for your strategy:
```js
const Queue = require('bull');

const myQueue = new Queue('Server B', {
  settings: {
    backoffStrategies: {
      // truncated binary exponential backoff
      binaryExponential: function (attemptsMade, err, options) {
        // Options can be undefined, you need to handle it by yourself
        if (!options) {
          options = {}
        }
        const delay = options.delay || 1000;
        const truncate = options.truncate || 1000;
        console.error({ attemptsMade, err, options });
        return Math.round(Math.random() * (Math.pow(2, Math.max(attemptsMade, truncate)) - 1) * delay)
      }
    }
  }
});

myQueue.add({ foo: 'bar' }, {
  attempts: 10,
  backoff: {
    type: 'binaryExponential',
    options: {
      delay: 500,
      truncate: 5
    }
  }
});

```

You may base your backoff strategy on the error that the job throws:
```js
const Queue = require('bull');

function MySpecificError() {};

const myQueue = new Queue('Server C', {
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

myQueue.process(function (job, done) {
  if (job.data.msg === 'Specific Error') {
    throw new MySpecificError();
  } else {
    throw new Error();
  }
});

myQueue.add({ msg: 'Hello' }, {
  attempts: 3,
  backoff: {
    type: 'foo'
  }
});

myQueue.add({ msg: 'Specific Error' }, {
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
import Queue from 'bull';

const queue = new Queue({
  limiter: {
    max: 5,
    duration: 5000,
    bounceBack: true // important
  },
  ...queueOptions
});
queue.add({ random_attr: 'random_value' });
```

2. Pulling a job from 'waiting' and moving it to 'active'.

```typescript
const job: Job = await queue.getNextJob();
```

3. Move the job to the 'failed' queue if something goes wrong.

```typescript
const (nextJobData, nextJobId) = await job.moveToFailed(
  {
    message: 'Call to external service failed!',
  },
  true,
);
```

3. Move the job to the 'completed' queue.

```typescript
const (nextJobData, nextJobId) = await job.moveToCompleted('succeeded', true);
```

4. Return the next job if one is returned.

```typescript
if (nextJobdata) {
  return Job.fromJSON(queue, nextJobData, nextJobId);
}
```

**Note**

By default the lock duration for a job that has been returned by ```getNextJob``` or ```moveToCompleted``` is 30 seconds, if it takes more time than that the job will be automatically
marked as stalled and depending on the max stalled options be moved back to the wait state or marked as failed. In order to avoid this you must use [```job.extendLock(duration)```](REFERENCE.md#jobextendlock) in order to give you some more time before the lock expires. The recommended is to extend the lock when half the lock time has passsed.

