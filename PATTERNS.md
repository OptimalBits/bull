
Patterns
========

Here are a few examples of useful patterns that are often implemented with Bull:

- [Message Queue](#message-queue)
- [Returning Job Completions](#returning-job-completions)
- [Reusing Redis Connections](#reusing-redis-connections)
- [Debugging](#debugging)

If you have any other common patterns you want to add, pull request them!


Message Queue
-------------

Bull can also be used for persistent message queues. This is a quite useful
feature in some usecases. For example, you can have two servers that need to
communicate with each other. By using a queue the servers do not need to be online at the same time, this create a very robust communication channel. You can treat `add` as *send* and `process` as *receive*:

Server A:

```js
var Queue = require('bull');

var sendQueue = Queue("Server B");
var receiveQueue = Queue("Server A");

receiveQueue.process(function(job, done){
  console.log("Received message", job.data.msg);
  done();
});

sendQueue.add({msg:"Hello"});
```

Server B:

```js
var Queue = require('bull');

var sendQueue = Queue("Server A");
var receiveQueue = Queue("Server B");

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
var client = new redis();
var subscriber = new redis();

var opts = {
  redis: {
    opts: {
      createClient: function(type){
        switch(type){
          case 'client':
            return client;
          case 'subscriber':
            return subscriber;
          default:
            return new redis();
        }
      }
    }
  }
}
var queueFoo = new Queue('foobar', opts);
var queueQux = new Queue('quxbaz', opts);
```


Debugging
---------

To see debug statements set or add `bull` to the `NODE_DEBUG` environment variable:

```bash
export NODE_DEBUG=bull
```

```bash
NODE_DEBUG=bull node ./your-script.js
```