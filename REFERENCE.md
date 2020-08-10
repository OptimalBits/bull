# Reference

- [Queue](#queue)

  - [Queue#process](#queueprocess)
  - [Queue#add](#queueadd)
  - [Queue#pause](#queuepause)
  - [Queue#resume](#queueresume)
  - [Queue#whenCurrentJobsFinished](#queuewhencurrentjobsfinished)
  - [Queue#count](#queuecount)
  - [Queue#removeJobs](#queueremovejobs)
  - [Queue#empty](#queueempty)
  - [Queue#clean](#queueclean)
  - [Queue#close](#queueclose)
  - [Queue#getJob](#queuegetjob)
  - [Queue#getJobs](#queuegetjobs)
  - [Queue#getJobLogs](#queuegetjoblogs)
  - [Queue#getRepeatableJobs](#queuegetrepeatablejobs)
  - [Queue#removeRepeatable](#queueremoverepeatable)
  - [Queue#removeRepeatableByKey](#queueremoverepeatablebykey)
  - [Queue#getJobCounts](#queuegetjobcounts)
  - [Queue#getCompletedCount](#queuegetcompletedcount)
  - [Queue#getFailedCount](#queuegetfailedcount)
  - [Queue#getDelayedCount](#queuegetdelayedcount)
  - [Queue#getActiveCount](#queuegetactivecount)
  - [Queue#getWaitingCount](#queuegetwaitingcount)
  - [Queue#getPausedCount](#queuegetpausedcount)
  - [Queue#getWaiting](#queuegetwaiting)
  - [Queue#getActive](#queuegetactive)
  - [Queue#getDelayed](#queuegetdelayed)
  - [Queue#getCompleted](#queuegetcompleted)
  - [Queue#getFailed](#queuegetfailed)

- [Job](#job)

  - [Job#progress](#jobprogress)
  - [Job#log](#joblog)
  - [Job#getState](#jobgetstate)
  - [Job#update](#jobupdate)
  - [Job#remove](#jobremove)
  - [Job#retry](#jobretry)
  - [Job#discard](#jobdiscard)
  - [Job#promote](#jobpromote)
  - [Job#finished](#jobfinished)
  - [Job#moveToCompleted](#jobMoveToCompleted)
  - [Job#moveToFailed](#jobMoveToFailed)

- [Events](#events)
  - [Global events](#global-events)

## Queue

```ts
Queue(queueName: string, url?: string, opts?: QueueOptions): Queue
```

This is the Queue constructor. It creates a new Queue that is persisted in
Redis. Everytime the same queue is instantiated it tries to process all the
old jobs that may exist from a previous unfinished session.

The optional `url` argument, allows to specify a redis connection string such as for example:
`redis://mypassword@myredis.server.com:1234`

```typescript
interface QueueOptions {
  createClient?(type: 'client' | 'subscriber' | 'bclient', config?: Redis.RedisOptions): Redis.Redis | Redis.Cluster;
  limiter?: RateLimiter;
  redis?: RedisOpts;
  prefix?: string = 'bull'; // prefix for all queue keys.
  defaultJobOptions?: JobOpts;
  settings?: AdvancedSettings;
}
```

```typescript
interface RateLimiter {
  max: number; // Max number of jobs processed
  duration: number; // per duration in milliseconds
  bounceBack?: boolean = false; // When jobs get rate limited, they stay in the waiting queue and are not moved to the delayed queue
  groupKey?: string; // allows grouping of jobs with the specified key from the data object passed to the Queue#add (ex. "network.handle")
}
```

`RedisOpts` are passed directly to ioredis constructor, check [ioredis](https://github.com/luin/ioredis/blob/master/API.md)
for details. We document here just the most important ones.

```typescript
interface RedisOpts {
  port?: number = 6379;
  host?: string = localhost;
  db?: number = 0;
  password?: string;
}
```

```typescript
interface AdvancedSettings {
  lockDuration: number = 30000; // Key expiration time for job locks.
  lockRenewTime: number = 15000; // Interval on which to acquire the job lock
  stalledInterval: number = 30000; // How often check for stalled jobs (use 0 for never checking).
  maxStalledCount: number = 1; // Max amount of times a stalled job will be re-processed.
  guardInterval: number = 5000; // Poll interval for delayed jobs and added jobs.
  retryProcessDelay: number = 5000; // delay before processing next job in case of internal error.
  backoffStrategies: {}; // A set of custom backoff strategies keyed by name.
  drainDelay: number = 5; // A timeout for when the queue is in drained state (empty waiting for jobs).
}
```

**Custom or Shared IORedis Connections**

`createClient` is passed a `type` to specify the type of connection that Bull is trying to create, and some options that `bull` would like to set for that connection.

You can merge the provided options with some of your own and create an `ioredis` connection.

When type is `client` or `subscriber` you can return the same connection for multiple queues, which can reduce the number of connections you open to the redis server.  Bull
does not close or disconnect these connections when queues are closed, so if you need to have your app do a graceful shutdown, you will need to keep references to these
Redis connections somewhere and disconnect them after you shut down all the queues.

The `bclient` connection however is a "blocking client" and is used to wait for new jobs on a single queue at a time.  For this reason it cannot be shared and a
new connection should be returned each time.

**Advanced Settings**

**Warning:** Do not override these advanced settings unless you understand the internals of the queue.

`lockDuration`: Time in milliseconds to acquire the job lock. Set this to a higher value if you find that your jobs are being stalled because your job processor is CPU-intensive and blocking the event loop (see note below about stalled jobs). Set this to a lower value if your jobs are extremely time-sensitive and it might be OK if they get double-processed (due to them be falsly considered stalled).

`lockRenewTime`: Interval in milliseconds on which to acquire the job lock. It is set to `lockDuration / 2` by default to give enough buffer to renew the lock each time before the job lock expires. It should never be set to a value larger than `lockDuration`. Set this to a lower value if you're finding that jobs are becoming stalled due to a CPU-intensive job processor function. Generally you shouldn't change this though.

`stalledInterval`: Interval in milliseconds on which each worker will check for stalled jobs (i.e. unlocked jobs in the `active` state). See note below about stalled jobs. Set this to a lower value if your jobs are extremely time-sensitive. Set this to a higher value if your Redis CPU usage is high as this check can be expensive. Note that because each worker runs this on its own interval and checks the entire queue, the stalled job actually run much more frequently than this value would imply.

`maxStalledCount`: The maximum number of times a job can be restarted before it will be permamently failed with the error `job stalled more than allowable limit`. This is set to a default of `1` with the assumption that stalled jobs should be very rare (only due to process crashes) and you want to be on the safer side of not restarting jobs. Set this higher if stalled jobs are common (e.g. processes crash a lot) and it's generally OK to double process jobs.

`guardInterval`: Interval in milliseconds on which the delayed job watchdog will run. When running multiple concurrent workers with delayed tasks, the default value of `guardInterval` will cause spikes on network bandwidth, cpu usage and memory usage. Each concurrent worker will run the delayed job watchdog. In this case set this value to something much higher, e.g. `guardInterval = numberOfWorkers*5000`. Set to a lower value if your Redis connection is unstable and delayed jobs aren't being processed in time.

`retryProcessDelay`: Time in milliseconds in which to wait before trying to process jobs, in case of a Redis error. Set to a lower value on an unstable Redis connection.

`backoffStrategies`: An object containing custom backoff strategies. The key in the object is the name of the strategy and the value is a function that should return the delay in milliseconds. For a full example see [Patterns](./PATTERNS.md#custom-backoff-strategy).

`drainDelay`: A timeout for when the queue is in `drained` state (empty waiting for jobs). It is used when calling `queue.getNextJob()`, which will pass it to `.brpoplpush` on the Redis client.

```js
backoffStrategies: {
  jitter: function () {
    return 5000 + Math.random() * 500;
  }
}
```

---

### Queue#process

```ts
/**
 * Consider these as overloaded functions. Since method overloading doesn't exist in javacript
 * bull recognizes the desired function call by checking the parameters' types. Make sure you
 * comply with one of the below defined patterns.
 *
 * Note: Concurrency defaults to 1 if not specified.
 */
process(processor: ((job, done?) => Promise<any>) | string)
process(concurrency: number, processor: ((job, done?) => Promise<any>) | string)
process(name: string, processor: ((job, done?) => Promise<any>) | string)
process(name: string, concurrency: number, processor: ((job, done?) => Promise<any>) | string)
```

Defines a processing function for the jobs in a given Queue.

The callback is called every time a job is placed in the queue. It is passed an instance of the job as first argument.

If the callback signature contains the second optional `done` argument, the callback will be passed a `done` callback to be called after the job has been completed. The `done` callback can be called with an Error instance, to signal that the job did not complete successfully, or with a result as second argument (e.g.: `done(null, result);`) when the job is successful. Errors will be passed as a second argument to the "failed" event;
results, as a second argument to the "completed" event.

If, however, the callback signature does not contain the `done` argument, a promise must be returned to signal job completion. If the promise is rejected, the error will be passed as a second argument to the "failed" event.
If it is resolved, its value will be the "completed" event's second argument.

You can specify a `concurrency` argument. Bull will then call your handler in parallel respecting this maximum value.

A process function can also be declared as a separate process. This will make a better use of the available CPU cores
and run the jobs in parallel. This is a perfect way to run blocking code. Just specify an absolute path to a processor module.
i.e. a file exporting the process function like this:

```js
// my-processor.js
module.exports = function(job) {
  // do some job

  return value;
};
```

You can return a value or a promise to signal that the job has been completed.

A `name` argument can be provided so that multiple process functions can be defined per queue. A named process will only process jobs that matches the given name. However, if you define multiple named process functions in one Queue, the defined concurrency for each process function stacks up for the Queue. See the following examples:

```js
/***
 * For each named processor, concurrency stacks up, so any of these three process functions
 * can run with a concurrency of 125. To avoid this behaviour you need to create an own queue
 * for each process function.
 */
const loadBalancerQueue = new Queue('loadbalancer');
loadBalancerQueue.process('requestProfile', 100, requestProfile);
loadBalancerQueue.process('sendEmail', 25, sendEmail);
loadBalancerQueue.process('sendInvitation', 0, sendInvite);

const profileQueue = new Queue('profile');
// Max concurrency for requestProfile is 100
profileQueue.process('requestProfile', 100, requestProfile);

const emailQueue = new Queue('email');
// Max concurrency for sendEmail is 25
emailQueue.process('sendEmail', 25, sendEmail);
```

Specifying `*` as the process name will make it the default processor for all named jobs.
It is frequently used to process all named jobs from one process function:

```js
const differentJobsQueue = new Queue('differentJobsQueue');
differentJobsQueue.process('*', processFunction);
differentJobsQueue.add('jobA', data, opts);
differentJobsQueue.add('jobB', data, opts);
```

**Note:** in order to determine whether job completion is signaled by
returning a promise or calling the `done` callback, Bull looks at
the length property of the callback you pass to it.
So watch out, as the following won't work:

```js
// THIS WON'T WORK!!
queue.process(function(job, done) {
  // Oops! done callback here!
  return Promise.resolve();
});
```

This, however, will:

```js
queue.process(function(job) {
  // No done callback here :)
  return Promise.resolve();
});
```

---

### Queue#add

```ts
add(name?: string, data: object, opts?: JobOpts): Promise<Job>
```

Creates a new job and adds it to the queue. If the queue is empty the job will be executed directly, otherwise it will be placed in the queue and executed as soon as possible.

An optional name can be added, so that only process functions defined for that name (also called job type) will process the job.

**Note:**
You need to define _processors_ for all the named jobs that you add to your queue or the queue will complain that you are missing a processor for the given job, unless you use the `*` as job name when defining the processor.

```typescript
interface JobOpts {
  priority: number; // Optional priority value. ranges from 1 (highest priority) to MAX_INT  (lowest priority). Note that
  // using priorities has a slight impact on performance, so do not use it if not required.

  delay: number; // An amount of milliseconds to wait until this job can be processed. Note that for accurate delays, both
  // server and clients should have their clocks synchronized. [optional].

  attempts: number; // The total number of attempts to try the job until it completes.

  repeat: RepeatOpts; // Repeat job according to a cron specification.

  backoff: number | BackoffOpts; // Backoff setting for automatic retries if the job fails

  lifo: boolean; // if true, adds the job to the right of the queue instead of the left (default false)
  timeout: number; // The number of milliseconds after which the job should be fail with a timeout error [optional]

  jobId: number | string; // Override the job ID - by default, the job ID is a unique
  // integer, but you can use this setting to override it.
  // If you use this option, it is up to you to ensure the
  // jobId is unique. If you attempt to add a job with an id that
  // already exists, it will not be added.

  removeOnComplete: boolean | number; // If true, removes the job when it successfully
  // completes. A number specified the amount of jobs to keep. Default behavior is to keep the job in the completed set.

  removeOnFail: boolean | number; // If true, removes the job when it fails after all attempts. A number specified the amount of jobs to keep
  // Default behavior is to keep the job in the failed set.
  stackTraceLimit: number; // Limits the amount of stack trace lines that will be recorded in the stacktrace.
}
```

```typescript
interface RepeatOpts {
  cron?: string; // Cron string
  tz?: string; // Timezone
  startDate?: Date | string | number; // Start date when the repeat job should start repeating (only with cron).
  endDate?: Date | string | number; // End date when the repeat job should stop repeating.
  limit?: number; // Number of times the job should repeat at max.
  every?: number; // Repeat every millis (cron setting cannot be used together with this setting.)
  count?: number; // The start value for the repeat iteration count.
}
```

More information regarding the [cron expression](https://github.com/harrisiirak/cron-parser)

```typescript
interface BackoffOpts {
  type: string; // Backoff type, which can be either `fixed` or `exponential`. A custom backoff strategy can also be specified in `backoffStrategies` on the queue settings.
  delay: number; // Backoff delay, in milliseconds.
}
```

---

### Queue#pause

```ts
pause(isLocal?: boolean, doNotWaitActive?: boolean): Promise
```

Returns a promise that resolves when the queue is paused. A paused queue will not process new jobs until resumed, but current jobs being processed will continue until they are finalized. The pause can be either global or local. If global, all workers in all queue instances for a given queue will be paused. If local, just this worker will stop processing new jobs after the current lock expires. This can be useful to stop a worker from taking new jobs prior to shutting down.

If `doNotWaitActive` is `true`, `pause` will _not_ wait for any active jobs to finish before resolving. Otherwise, `pause` _will_ wait for active jobs to finish. See [Queue#whenCurrentJobsFinished](#queuewhencurrentjobsfinished) for more information.

Pausing a queue that is already paused does nothing.

---

### Queue#resume

```ts
resume(isLocal?: boolean): Promise
```

Returns a promise that resolves when the queue is resumed after being paused. The resume can be either local or global. If global, all workers in all queue instances for a given queue will be resumed. If local, only this worker will be resumed. Note that resuming a queue globally will _not_ resume workers that have been paused locally; for those, `resume(true)` must be called directly on their instances.

Resuming a queue that is not paused does nothing.

---

### Queue#whenCurrentJobsFinished

```ts
whenCurrentJobsFinished(): Promise<Void>
```

Returns a promise that resolves when all jobs currently being processed by this worker have finished.

---

### Queue#count

```ts
count(): Promise<number>
```

Returns a promise that returns the number of jobs in the queue, waiting or delayed. Since there may be other processes adding or processing jobs, this value may be true only for a very small amount of time.

---

### Queue#removeJobs

```ts
removeJobs(pattern: string): Promise<void>
```

Removes all the jobs which jobId matches the given pattern. The pattern must follow redis glob-style pattern (syntax)[https://redis.io/commands/keys]

Example:

```js
myQueue.removeJobs('?oo*').then(function() {
  console.log('done removing jobs');
});
```

Will remove jobs with ids such as: "boo", "foofighter", etc.

---

### Queue#empty

```ts
empty(): Promise
```

Drains a queue deleting all the *input* lists and associated jobs. Note, this function only remove the jobs that are
*waiting" to be processed by the queue or *delayed*.

---

### Queue#close

```ts
close(): Promise
```

Closes the underlying Redis client. Use this to perform a graceful shutdown.

```js
var Queue = require('bull');
var queue = Queue('example');

var after100 = _.after(100, function() {
  queue.close().then(function() {
    console.log('done');
  });
});

queue.on('completed', after100);
```

`close` can be called from anywhere, with one caveat: if called
from within a job handler the queue won't close until _after_
the job has been processed, so the following won't work:

```js
queue.process(function(job, jobDone) {
  handle(job);
  queue.close().then(jobDone);
});
```

Instead, do this:

```js
queue.process(function(job, jobDone) {
  handle(job);
  queue.close();
  jobDone();
});
```

Or this:

```js
queue.process(function (job) {
  queue.close();
  return handle(job).then(...);
});
```

---

### Queue#getJob

```ts
getJob(jobId: string): Promise<Job>
```

Returns a promise that will return the job instance associated with the `jobId`
parameter. If the specified job cannot be located, the promise will be resolved to `null`.

---

### Queue#getJobs

```ts
getJobs(types: JobStatus[], start?: number, end?: number, asc?: boolean): Promise<Job[]>
```

Returns a promise that will return an array of job instances of the given job statuses. Optional parameters for range and ordering are provided.

Note: The `start` and `end` options are applied **per job statuses**. For example, if there are 10 jobs in state `completed` and 10 jobs in state `active`, `getJobs(['completed', 'active'], 0, 4)` will yield an array with 10 entries, representing the first 5 completed jobs (0 - 4) and the first 5 active jobs (0 - 4).

---

### Queue#getJobLogs

```ts
getJobLogs(jobId: string, start?: number, end?: number): Promise<{
  logs: string[],
  count: number
}>
```

Returns a object with the logs according to the start and end arguments. The returned count
value is the total amount of logs, useful for implementing pagination.

---

### Queue#getRepeatableJobs

```ts
getRepeatableJobs(start?: number, end?: number, asc?: boolean): Promise <Job[]>
```

Returns a promise that will return an array of Repeatable Job configurations. Optional parameters for range and ordering are provided.

---

### Queue#removeRepeatable

```ts
removeRepeatable(name?: string, repeat: RepeatOpts): Promise<void>
```

Removes a given repeatable job. The RepeatOpts needs to be the same as the ones used
for the job when it was added.

---

---

### Queue#removeRepeatableByKey

```ts
removeRepeatableByKey(key: string): Promise<void>
```

Removes a given repeatable job by its key.

---

### Queue#getJobCounts

```ts
getJobCounts() : Promise<JobCounts>
```

Returns a promise that will return the job counts for the given queue.

```typescript{
  interface JobCounts {
    waiting: number,
    active: number,
    completed: number,
    failed: number,
    delayed: number
  }
}
```

---

### Queue#getCompletedCount

```ts
getCompletedCount() : Promise<number>
```

Returns a promise that will return the completed job counts for the given queue.

---

### Queue#getFailedCount

```ts
getFailedCount() : Promise<number>
```

Returns a promise that will return the failed job counts for the given queue.

---

### Queue#getDelayedCount

```ts
getDelayedCount() : Promise<number>
```

Returns a promise that will return the delayed job counts for the given queue.

---

### Queue#getActiveCount

```ts
getActiveCount() : Promise<number>
```

Returns a promise that will return the active job counts for the given queue.

---

### Queue#getWaitingCount

```ts
getWaitingCount() : Promise<number>
```

Returns a promise that will return the waiting job counts for the given queue.

---

### Queue#getPausedCount

```ts
getPausedCount() : Promise<number>
```

Returns a promise that will return the paused job counts for the given queue.

---

### Queue#getWaiting

```ts
getWaiting(start?: number, end?: number) : Promise<Array<Job>>
```

Returns a promise that will return an array with the waiting jobs between start and end.

---

### Queue#getActive

```ts
getActive(start?: number, end?: number) : Promise<Array<Job>>
```

Returns a promise that will return an array with the active jobs between start and end.

---

### Queue#getDelayed

```ts
getDelayed(start?: number, end?: number) : Promise<Array<Job>>
```

Returns a promise that will return an array with the delayed jobs between start and end.

---

### Queue#getCompleted

```ts
getCompleted(start?: number, end?: number) : Promise<Array<Job>>
```

Returns a promise that will return an array with the completed jobs between start and end.

---

### Queue#getFailed

```ts
getFailed(start?: number, end?: number) : Promise<Array<Job>>
```

Returns a promise that will return an array with the failed jobs between start and end.

---

### Queue#clean

```ts
clean(grace: number, status?: string, limit?: number): Promise<number[]>
```

Tells the queue remove jobs of a specific type created outside of a grace period.

**Example**

```js
//cleans all jobs that completed over 5 seconds ago.
queue.clean(5000);
//clean all jobs that failed over 10 seconds ago.
queue.clean(10000, 'failed');
queue.on('cleaned', function(jobs, type) {
  console.log('Cleaned %s %s jobs', jobs.length, type);
});
```

**Arguments**

```js
  grace: number; Grace period in milliseconds.
  status: string; Status of the job to clean. Values are completed, wait, active,
  delayed, and failed. Defaults to completed.
  limit: number; maximum amount of jobs to clean per call. If not provided will clean all matching jobs.

  returns Promise; A promise that resolves with an array of removed jobs.
```

**Events**

The cleaner emits the `cleaned` event anytime the queue is cleaned.

```typescript
  queue.on('cleaned', listener: (jobs: number[], status: string) => void);
```

---

## Job

A job includes all data needed to perform its execution, as well as the progress method needed to update its progress.

The most important property for the user is `Job#data` that includes the object that was passed to [`Queue#add`](#queueadd), and that is normally used to perform the job.

### Job#progress

```ts
progress(progress?: number): Promise
```

Updates a job progress if called with an argument.
Return a promise resolving to the current job's progress if called without argument.

**Arguments**

```js
  progress: number; Job progress between 0 and 100.
```

---

### Job#log

```ts
log(row: string): Promise
```

Adds a log row to this job specific job. Logs can be retrieved using [Queue#getJobLogs](#queuegetjoblogs).

---

### Job#getState

```ts
getState(): Promise
```

Returns a promise resolving to the current job's status (completed, failed, delayed etc.). Possible returns are: completed, failed, delayed, active, waiting, paused, stuck or null.

Please take note that the implementation of this method is not very efficient, nor is it atomic. If your queue does have a very large quantity of jobs, you may want to avoid using this method.

---

### Job#update

```ts
update(data: object): Promise
```

Updated a job data field with the give data object.

---

### Job#remove

```ts
remove(): Promise
```

Removes a job from the queue and from any lists it may be included in.

---

### Job#retry

```ts
retry(): Promise
```

Re-run a job that has failed. Returns a promise that resolves when the job is scheduled for retry.

---

### Job#discard

```ts
discard(): Promise
```

Ensure this job is never ran again even if `attemptsMade` is less than `job.attempts`.

---

### Job#promote

```ts
promote(): Promise
```

Promotes a job that is currently "delayed" to the "waiting" state and executed as soon as possible.

---

### Job#finished

```ts
finished(): Promise
```

Returns a promise that resolves or rejects when the job completes or fails.

---

### Job#moveToCompleted

```ts
moveToCompleted(returnValue: any, ignoreLock: boolean, notFetch?: boolean): Promise<string[Jobdata, JobId] | null>
```

Moves a job to the `completed` queue. Pulls a job from 'waiting' to 'active' and returns a tuple containing the next jobs data and id. If no job is in the `waiting` queue, returns null. Set `notFetch` to true to avoid prefetching the next job in the queue.

---

### Job#moveToFailed

```ts
moveToFailed(errorInfo:{ message: string; }, ignoreLock?:boolean): Promise<string[Jobdata, JobId] | null>
```

Moves a job to the `failed` queue. Pulls a job from 'waiting' to 'active' and returns a tuple containing the next jobs data and id. If no job is in the `waiting` queue, returns null.

---

## Events

A queue emits also some useful events:

```js
.on('error', function(error) {
  // An error occured.
})

.on('waiting', function(jobId){
  // A Job is waiting to be processed as soon as a worker is idling.
});

.on('active', function(job, jobPromise){
  // A job has started. You can use `jobPromise.cancel()`` to abort it.
})

.on('stalled', function(job){
  // A job has been marked as stalled. This is useful for debugging job
  // workers that crash or pause the event loop.
})

.on('progress', function(job, progress){
  // A job's progress was updated!
})

.on('completed', function(job, result){
  // A job successfully completed with a `result`.
})

.on('failed', function(job, err){
  // A job failed with reason `err`!
})

.on('paused', function(){
  // The queue has been paused.
})

.on('resumed', function(job){
  // The queue has been resumed.
})

.on('cleaned', function(jobs, type) {
  // Old jobs have been cleaned from the queue. `jobs` is an array of cleaned
  // jobs, and `type` is the type of jobs cleaned.
});

.on('drained', function() {
  // Emitted every time the queue has processed all the waiting jobs (even if there can be some delayed jobs not yet processed)
});

.on('removed', function(job){
  // A job successfully removed.
});

```

### Global events

Events are local by default — in other words, they only fire on the listeners that are registered on the given worker. If you need to listen to events globally, for example from other servers across redis, just prefix the event with `'global:'`:

```js
// Will listen locally, just to this queue...
queue.on('completed', listener):

// Will listen globally, to instances of this queue...
queue.on('global:completed', listener);
```

When working with global events whose local counterparts pass a `Job` instance to the event listener callback, notice that global events pass the **job's ID** instead.

If you need to access the `Job` instance in a global listener, use [Queue#getJob](#queuegetjob) to retrieve it. However, remember that if `removeOnComplete` is enabled when adding the job, the job will no longer be available after completion. Should you need to both access the job and remove it after completion, you can use [Job#remove](#jobremove) to remove it in the listener.

```js
// Local events pass the job instance...
queue.on('progress', function(job, progress) {
  console.log(`Job ${job.id} is ${progress * 100}% ready!`);
});

queue.on('completed', function(job, result) {
  console.log(`Job ${job.id} completed! Result: ${result}`);
  job.remove();
});

// ...whereas global events only pass the job ID:
queue.on('global:progress', function(jobId, progress) {
  console.log(`Job ${jobId} is ${progress * 100}% ready!`);
});

queue.on('global:completed', function(jobId, result) {
  console.log(`Job ${jobId} completed! Result: ${result}`);
  queue.getJob(jobId).then(function(job) {
    job.remove();
  });
});
```
