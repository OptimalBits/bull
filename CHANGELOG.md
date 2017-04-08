v.2.2.6
=======

- Persisted failedReason when storing job data.
- added queue##isReady()

[Changes](https://github.com/OptimalBits/bull/compare/v2.2.5...v2.2.6)


v.2.2.5
=======

- Fixed so that redis key prefix works properly.

[Changes](https://github.com/OptimalBits/bull/compare/v2.2.4...v2.2.5)


v.2.2.4
=======

- Allow reusing certain redis connections.

[Changes](https://github.com/OptimalBits/bull/compare/v2.2.3...v2.2.4)

v.2.2.3
=======

- Added getJobCounts.
- Fixed global events #394.

[Changes](https://github.com/OptimalBits/bull/compare/v2.2.2...v2.2.3)

v.2.2.2
=======
- Fixed redis script cache gets bloated after update to bull 2.0 #426

[Changes](https://github.com/OptimalBits/bull/compare/v2.2.1...v2.2.2)

v.2.2.1
=======

- Re-added createClient option that was removed by mistake.
- Corrected getJobCountByTypes, fixes #419 and #401

[Changes](https://github.com/OptimalBits/bull/compare/v2.2.0...v2.2.1)

v.2.2.0
=======

- Much improved priority queues, simpler, faster and more reliable.
- Fixed issue where lua scripts where leaking memory.
- Improvements in local pause, fixing #446 and #447.
- Fix to increase delay time over 24 days #244

[Changes](https://github.com/OptimalBits/bull/compare/v2.1.2...v2.2.0)


v.2.1.2
=======

- Fixed Error renewing lock LockError: Exceeded 0 attempts to lock the resource #437
- Fixed Unable to renew nonexisting lock on job fail #441

[Changes](https://github.com/OptimalBits/bull/compare/v2.1.1...v2.1.2)

v.2.1.1
=======

- Catch errors produced in timers. Related to #441

[Changes](https://github.com/OptimalBits/bull/compare/v2.1.0...v2.1.1)

v.2.1.0
=======

- Fixed #397, Error: Unable to renew nonexisting lock
- Fixed #402, Job.prototype.finished contains error in promise 
- Fixed #371, "Unexpected token u in JSON at position 0" while processing job
- New feature #363, "method to permanently fail a job"
- Fix job.progress() to return the correct progress  

[Changes](https://github.com/OptimalBits/bull/compare/v2.0.0...v2.1.0)

v.2.0.0
=======

- Changed redis module to ioredis fixing many issues along the way, see changes.

[Changes](https://github.com/OptimalBits/bull/compare/v1.1.3...v2.0.0)

v.1.1.3
=======

- fixed "Broken constructor pattern from recent commit" #384
- fixed "Queue.prototype.getWaiting() returns empty list if Queue is paused" #342

[Changes](https://github.com/OptimalBits/bull/compare/v1.1.2...v1.1.3)

v1.1.2
======

- regained backwards compatibility in events by using disturbed 1.0.6

[Changes](https://github.com/OptimalBits/bull/compare/v1.1.1...v1.1.2)

v1.1.1
======

- Returned this in queue##on and queue##once for backwards compatibility.
- [Fixes PriorityQueue Events and Local Worker Pause/Resume](https://github.com/OptimalBits/bull/pull/341)

[Changes](https://github.com/OptimalBits/bull/compare/v1.1.0...v1.1.1)

v1.1.0
======

- Fixed [job corruption issue](https://github.com/OptimalBits/bull/pull/359)
- The job id can be [overridden](https://github.com/OptimalBits/bull/pull/335) to implement job throttling behavior
- Added [`removeOnComplete` job option](https://github.com/OptimalBits/bull/pull/361)
- [More robust job retry](https://github.com/OptimalBits/bull/pull/318)
- Events are [now broadcast to all workers](https://github.com/OptimalBits/bull/commit/d55ad1c8f44f86be9b4e9f4fa9a3fc8a16c6e02d)

[Changes](https://github.com/OptimalBits/bull/compare/v1.0.0...v1.1.0)

v1.0.0
======

- improvements in clean (fixes and performance).

[Changes](https://github.com/OptimalBits/bull/compare/v1.0.0-rc4...v1.0.0)

v1.0.0-rc4
==========

- fixed lock renew logic.
- atomized code for getting stalled jobs.

[Changes](https://github.com/OptimalBits/bull/compare/v1.0.0-rc3...v1.0.0-rc4)

v1.0.0-rc3
==========

- smaller fixes.

[Changes](https://github.com/OptimalBits/bull/compare/v1.0.0-rc2...v1.0.0-rc3)

v1.0.0-rc2
==========

- Improved locking when removing and processing stalled jobs.
- Fixed #302 EVALSHA failure.
- Fixed #295 error with redis 3.2.
- Correctly allows the specification of the db
- Honor start/end range for complete/failed jobs.
- Fixed #277 Memory Leaks With Large Queue.
- Support for custom key prefix for redis keys.

[Changes](https://github.com/OptimalBits/bull/compare/v1.0.0-rc1...v1.0.0-rc2)

v1.0.0-rc1
==========

- Removed all potential dangerous hazards by atomizing many operations using
cached LUA scripts.
- Improved performance around 400% compared to previous version.
- Better pause/resume (#266), and added pause for local workers.
- Fixed #272, #271, #261, #253, #240, #239

[Changes](https://github.com/OptimalBits/bull/compare/v0.7.2...v1.0.0-rc1)

v0.7.2
======

- Added local pause/resume functionality
- fixed memory leaks present in the run promise chain.
- fixed "Illegal access to a strict mode caller function".

[Changes](https://github.com/OptimalBits/bull/compare/v0.7.1...v0.7.2)

v0.7.1
======

- fixed storing of stacktraces

[Changes](https://github.com/OptimalBits/bull/compare/v0.7.0...v0.7.1)

v0.7.0
======

- store the return value from the job handlers.
- store stacktraces.
- improvements in delayed jobs.

[Changes](https://github.com/OptimalBits/bull/compare/v0.6.0...v0.7.0)

v0.4.0
======
- added a Queue##clean method

[Changes](https://github.com/OptimalBits/bull/compare/v0.3.0...v0.4.0)

v0.3.0
======

- added support for custom clients.
- added test support for node 0.12.
- timeout improvements.
- unit test improvements.
- added timeout to queue pop blocking call.
- removed when dependency.

[Changes](https://github.com/OptimalBits/bull/compare/v0.2.7...v0.3.0)

v0.2.7
======

[Changes](https://github.com/OptimalBits/bull/compare/v0.2.6...v0.2.7)

v0.2.6
======

- [Fix] #103 When a queue start it do not process delayed job.
[Changes](https://github.com/OptimalBits/bull/compare/v0.2.5...v0.2.6)

v0.2.5
======
- [upgrade] Upgraded node redis to version 0.12.x
- [improvement] eslinted all code.
- [fix] added missing token when calling takeLock on jobs.

[Changes](https://github.com/OptimalBits/bull/compare/v0.2.4...v0.2.5)

v0.2.4
======
[Changes](https://github.com/OptimalBits/bull/compare/v0.2.3...v0.2.4)

v0.2.3
======
[Changes](https://github.com/OptimalBits/bull/compare/v0.1.9...v0.2.3)

v0.1.9
======
- [Improvement] Faster job removal. (manast)

v0.1.8
======
- [Improvement] Better promisification of redis methods. (manast)

v0.1.7
======
- [Feature] Added a convenience method for getting a job. (loginx)
- [Fix] Only set a redis db from options if defined. (jboga)
- [Fix] Fixed issue #52. (manast)

v0.1.6
======
- [Fix] Improved and corrected job's getters.
- [Fix] Automatically restart queues in the event of redis disconnections.
- [Feature] Added support for adding jobs in a LIFO fashion.
