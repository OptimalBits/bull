
Patterns
========

Here are a few examples of useful patterns that are often implemented with Bull:

- [Message Queue](#message-queue)
- [Returning Job Completions](#returning-job-completions)
- [Reusing Redis Connections](#reusing-redis-connections)
- [Redis Cluster](#redis-cluster)
- [Debugging](#debugging)
- [Custom backoff strategy](#custom-backoff-strategy)

If you have any other common patterns you want to add, pull request them!


Message Queue
-------------

Bull can also be used for persistent message queues. This is a quite useful
feature in some usecases. For example, you can have two servers that need to
communicate with each other. By using a queue the servers do not need to be online at the same time, this creates a very robust communication channel. You can treat `add` as *send* and `process` as *receive*:

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

The most robust and scalable way to accomplish this is by combining the standard job queue with the message queue pattern: a service sends jobs to the cluster just by opening a job queue and adding jobs to it, the cluster will start processing as fast as it can. Everytime a job gets completed in the cluster a message is send to a results message queue with the result data, this queue is listened by some other service that stores the results in a database.


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
        return new Redis();
    }
  }
}

var queueFoo = new Queue('foobar', opts);
var queueQux = new Queue('quxbaz', opts);
```

Redis cluster
-------------

Bull internals requires atomic operations that spans different keys. This fact breaks redis
rules for cluster configurations, however it is still possible to use a cluster environment
by using the proper bull prefix option as a cluster "hash tag". Hash tags are used to guarantee
that certain keys are placed in the same hash slot, read more about hash tags in the [redis cluster
tutorial](https://redis.io/topics/cluster-tutorial).

A hash tag is defined with brakets. I.e. a key that has a substring inside brackets will use that
substring to determine in which hash slot the key will be placed. So to make bull compatible with
cluster, just use a queue prefix inside brackes, for example:

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

When the builtin backoff strategies on retries are not sufficient, a custom strategy can be defined. Custom backoff strategies are defined by a function on the queue:

```js
var Queue = require('bull');

var myQueue = new Queue("Server B", {
  settings: {
    backoffStrategies: {
      jitter: function () {
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


