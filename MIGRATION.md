# Migration from 2.x to 3.0.0

Although version 3.0 is almost backwards compatible with 2.x, there are some important changes that needs
to be taking in consideration before upgrading to 3.0.

# Complete and failed sets.

In 3.x, the jobs that are completed and failed end in two ZSETS, instead of a standard SET.
This gives the possibility of retrieving a subset of the jobs in a high performant way, which
is useful for graphical tools and scripts. However an old queue will not be compatible with 3.x.
You will need to either delete the complete and failed keys, or create a new queue.

# Data structure changes

job.jobId to job.id

toJSON ->
 job.data
 job.opts

# Queue instantiation options

Sanitized and cleaned all the options. Check the [Reference](./REFERENCE.md) to see the new structure.


# Events

All events are now published atomically in the scripts where they are relevant, this increases efficiency and
reduces chances for hazards.

'ready' event has been removed, you can use ```Queue##isReady()``` instead if you want to know when the queue
has been initialized. Normally you will never need to wait for readyness since this is taken care internally
by the queue methods that require the queue to be ready.

Events arguments are now the same for local and global events. This affects events such as completed and failed,
where in 2.x the first argument was a job instance for local jobs. Now both local and global events pass
jobId as first argument to the event handler. If the job instance is needed it can be easily retrieved with
```Job.fromId()```.

