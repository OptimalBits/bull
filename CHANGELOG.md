# Changelog

## v.3.10.0

- fix: remove logs automtically when using autoremove fixes #1330
- feat: add support for keeping a specified number of jobs when using auto-remove.
- feat: add support for node 12
- fix: fix check for supported file types in sandboxed processors #1311 
- ci: drop support for node 6

 [Changes](https://github.com/OptimalBits/bull/compare/v3.9.1...v3.10.0)

## v.3.9.1
 
 - fix: add log to job wrapper
 
 [Changes](https://github.com/OptimalBits/bull/compare/v3.9.0...v3.9.1)

## v.3.9.0
 
 - feat: add job.log #1165
 
 [Changes](https://github.com/OptimalBits/bull/compare/v3.8.1...v3.9.0)

## v.3.8.1
 
 - fix: wait for ready in cleanJobsInSet fixes #1298
 
 [Changes](https://github.com/OptimalBits/bull/compare/v3.8.0...v3.8.1)

## v.3.8.0

- fix: improve delay logic fixing #1226, #1222
- feat: store finishedOn on the job instance
- fix: return every in getRepeatableJobs #1284
- fix: remove broken child processes #1098
- feat: update sandbox exit handler to log signals #1252
- fix: Ignore unknown command client error #1240

[Changes](https://github.com/OptimalBits/bull/compare/v3.7.0...v3.8.0)

## v.3.7.0

- perf: improve update delay set logic.
- feat: consider priority when promoting a job #1205.
- fix: better delay for rate limited jobs.
- feat: update port selection mechanism for child node process inspect flag.

[Changes](https://github.com/OptimalBits/bull/compare/v3.6.0...v3.7.0)

## v.3.6.0

- feat: add function to remove repeatable jobs by key.
- fix: properly remove sandbox events. Fixes #1179.
- fix: make progress functions in sandbox consistently return a promise.

[Changes](https://github.com/OptimalBits/bull/compare/v3.5.3...v3.6.0)

## v.3.5.3

- chore: upgrade ioredis to ^4.5.1.
- fix: fix #1044 support for typescript processors.
- chore: remove bluebird.
- chore: use lockKey method instead of private property.
- fix(queue): convert delay setting to number.

[Changes](https://github.com/OptimalBits/bull/compare/v3.5.2...v3.5.3)

## v.3.5.2

- chore(queue): remove bluebird config from the codebase.

[Changes](https://github.com/OptimalBits/bull/compare/v3.5.1...v3.5.2)

## v.3.5.1

- chore(yarn): updated yarn.lock

[Changes](https://github.com/OptimalBits/bull/compare/v3.5.0...v3.5.1)

## v.3.5.0

- fix(delayed): pause delayed jobs #1087
- fix(lua): correct numJobs fetch in moveToActive
- perf(moveToActive): used local var for rate limiter
- perf(queue): replace bluebird by native promises where possible
- chore(queue): fix typo in forcedReconnection variable
- feat(child-processes): catch sub process crashes
- fix(jobs): reset 'failedReason', 'finishedOn' and 'processedOn' fields on job retry
- fix(queue): fix Warning: cancellation is disabled
- fix(queue): remove the correct listener in isRedisReady
- feat(jobs): allow cancelling of retries when using custom backoff strategy
- feat(rate-limiter): add discard config for rate-limiter
- feat(jobs): make job progress accepts variant types
- fix(repeatable): Fixed wrong repeatable count updates
- fix(jobs): fix copy paste mistake for stacktrace in job toData
- feat(child-processes): Propagate stack traces
- feat(repeatable): add ability for cron repeatable job with startDate

[Changes](https://github.com/OptimalBits/bull/compare/v3.4.8...v3.5.0)

## v.3.4.8

- emit waiting event when waking up sleep jobs fixing #792
- throw error if missing processor file fixing #954

[Changes](https://github.com/OptimalBits/bull/compare/v3.4.7...v3.4.8)

## v.3.4.7

- Fixes to deal with removing correctly in priority queues #984

[Changes](https://github.com/OptimalBits/bull/compare/v3.4.6...v3.4.7)

## v.3.4.6

- Reverted use of arrow function that was incompatible with older versions of node.

[Changes](https://github.com/OptimalBits/bull/compare/v3.4.5...v3.4.6)

## v.3.4.5

- Fixed Unhandled promise rejections #1012.

[Changes](https://github.com/OptimalBits/bull/compare/v3.4.4...v3.4.5)

## v.3.4.4

- Partially fixed #845. When call queue.close() bull throws Error: Connection is closed.
- Fixed #998. Check for existence of rate limiter options.
- Fixed #1003. Fixed fixed repeatable jobs duplication using every.
- Feature/provide error to custom backoff strategy.

[Changes](https://github.com/OptimalBits/bull/compare/v3.4.3...v3.4.4)

## v.3.4.3

- Fixed #994 queue.getJobs() race condition.
- Fixed #966 Race conditions reviving repeatable jobs.
- Fixed getters: Update types array to include paused.
- Fixed #958 job.finished slowdown.
- Fixed #949 TypeError: job.queue.client.isFinished is not a function.
- Fixed #870 TypeError when retrying jobs.
- Fixed #942 Support for milliseconds intervals in repeatable jobs.

[Changes](https://github.com/OptimalBits/bull/compare/v3.4.2...v3.4.3)

## v.3.4.2

- Fixed #903 Globally paused queue cannot receive job (or not shown in Arena untill queue is globally resumed).
- Workaround for #911 Seperate process worker fails to launch when Node is started with --inspect flag
- added missing retain on reused child job #908.
- added more tests for child jobs.

[Changes](https://github.com/OptimalBits/bull/compare/v3.4.1...v3.4.2)

## v.3.4.1

- Better check for closing in moveUnlockedJobsToWait, possibly fixing #806.

[Changes](https://github.com/OptimalBits/bull/compare/v3.4.0...v3.4.1)

## v.3.4.0

- Added support for prioritized delayed jobs.
- Added ability to process all named jobs from one process function.
- Fixed #893, warning 'a promise was rejected with a non-error' for external queues in case of an error.

[Changes](https://github.com/OptimalBits/bull/compare/v3.3.10...v3.4.0)

## v.3.3.10

- Faster next job fetch #868
- Added global default options for jobs. Fixes #706.
- Added a limit for repeatable jobs. #854.

[Changes](https://github.com/OptimalBits/bull/compare/v3.3.9...v3.3.10)

## v.3.3.9

- Support custom backoff strategies.
- Fixed #786. Handling of ES6 default export.
- Fixed #782. Better handling of "isReady".

[Changes](https://github.com/OptimalBits/bull/compare/v3.3.8...v3.3.9)

## v.3.3.8

- Fixed #812. External process doesn't terminate on `queue.close()`.
- Fixed #830. Named Process Sent to Wrong Processor.
- Fixed #572. Do not close external connections.

[Changes](https://github.com/OptimalBits/bull/compare/v3.3.7...v3.3.8)

## v.3.3.7

- Fixed #807.
- Adding ability to limit by stacktrace. #798.

[Changes](https://github.com/OptimalBits/bull/compare/v3.3.6...v3.3.7)

## v.3.3.6

- Fixed #766, #781, #716.
- Correctly accept DB in redis connection string.
- Fixed global progress event.

[Changes](https://github.com/OptimalBits/bull/compare/v3.3.5...v3.3.6)

## v.3.3.5

- Fixed #764, #762, #759.

[Changes](https://github.com/OptimalBits/bull/compare/v3.3.4...v3.3.5)

## v.3.3.4

- Fixed #748.

[Changes](https://github.com/OptimalBits/bull/compare/v3.3.3...v3.3.4)

## v.3.3.3

- Re-fixed #739.
- Possibly fixed for #747.
- Fixed removeRepeatable (missing file)

[Changes](https://github.com/OptimalBits/bull/compare/v3.3.2...v3.3.3)

## v.3.3.2

- Fixed #721. SyntaxError: Unexpected token u in JSON at position 0.
- Fixed #739. childs are not added to the retained set.
- Fixed #734. fixed Promise warnings.

[Changes](https://github.com/OptimalBits/bull/compare/v3.3.1...v3.3.2)

## v.3.3.1

- Fixed #714

[Changes](https://github.com/OptimalBits/bull/compare/v3.3.0...v3.3.1)

## v.3.3.0

- Added a method `Queue##removeRepeatable` to remove repeatable jobs.
- Now also emits drained as a global event.
- Fixed #518, #624

[Changes](https://github.com/OptimalBits/bull/compare/v3.2.0...v3.3.0)

## v.3.2.0

- Added support for running jobs in child processes #488

[Changes](https://github.com/OptimalBits/bull/compare/v3.1.0...v3.2.0)

## v.3.1.0

- Added rate limiter support.
- Added method to update jobs data.
- Implemented stalled as global event.

[Changes](https://github.com/OptimalBits/bull/compare/v3.0.0...v3.1.0)

## v.3.0.0

- No changes.

## v.3.0.0-rc.10

- Fixed #666.
- Small improvements in the repeat code.

[Changes](https://github.com/OptimalBits/bull/compare/v3.0.0-rc.9...v3.0.0-rc.10)

## v.3.0.0-rc.9

- Fixed #672.
- Fixed #670

[Changes](https://github.com/OptimalBits/bull/compare/v3.0.0-rc.8...v3.0.0-rc.9)

## v.3.0.0-rc.8

- Enhanced job fetching #651 (faster and more reliable).

[Changes](https://github.com/OptimalBits/bull/compare/v3.0.0-rc.7...v3.0.0-rc.8)

## v.3.0.0-rc.7

- Fixed #659

[Changes](https://github.com/OptimalBits/bull/compare/v3.0.0-rc.6...v3.0.0-rc.7)

## v.3.0.0-rc.6

- Fixed #645.

[Changes](https://github.com/OptimalBits/bull/compare/v3.0.0-rc.5...v3.0.0-rc.6)

## v.3.0.0-rc.5

- Improved performance, specially when having many concurrent workers.
- Fixed #609 using zsets for storing repeatable jobs.
- Fixed #608 Event chaining no longer works.
- Improved getters.
- Fixed #601 Add multiple repeatable jobs with the same cron pattern.

[Changes](https://github.com/OptimalBits/bull/compare/3.0.0-rc.4...v3.0.0-rc.5)

## v.3.0.0-rc.4

- Added support for naming workers in redis connections #530.
- Lazy instantiation of redis clients. Fixes #526.
- job.finished captures result from queue process. #588.
- Caches LUA scripts to avoid reading files in every queue instantiation. #591.
- Emit 'drain' event when queue is empty. #596.
- store finished and processed timestamps. #594, #606.

[Changes](https://github.com/OptimalBits/bull/compare/v3.0.0-rc.3...3.0.0-rc.4)

## v.3.0.0-rc.3

- Fixed #579.
- Lazy subscription to events for better performance.
- Corrected calculation of next repeat job. #563.

[Changes](https://github.com/OptimalBits/bull/compare/v3.0.0-rc.2...v3.0.0-rc.3)

## v.3.0.0-rc.2

- Improved performance of moveToActive #550.
- Fixed issue with cancelable promise #546.

[Changes](https://github.com/OptimalBits/bull/compare/v3.0.0-rc.1...v3.0.0-rc.2)

## v.3.0.0-rc.1

- Improved error and lock handling for failed jobs #499, #539.
- Corrected instantiation from urls #538.
- Return jobs in proper order in jobs getters.

[Changes](https://github.com/OptimalBits/bull/compare/v3.0.0-alpha.4...v3.0.0-rc.1)

## v.3.0.0-alpha.4

- Implemented repeatable jobs. #252.

[Changes](https://github.com/OptimalBits/bull/compare/v3.0.0-alpha.3...v3.0.0-alpha.4)

## v.3.0.0-alpha.3

- Simplified global events #501.

[Changes](https://github.com/OptimalBits/bull/compare/v3.0.0-alpha.2...v3.0.0-alpha.3)

## v.3.0.0-alpha.2

- Eliminated possible memory leak #503

[Changes](https://github.com/OptimalBits/bull/compare/v3.0.0-alpha.1...v3.0.0-alpha.2)

## v.3.0.0-alpha.1

- improved job fetch mechanism. #480.
- job.jobId changed to job.id.
- refactored error messages into separate error module.
- refactored lua scripts into separate files, and preloaded.
- many atomizations and clean ups.
- completed and failed job states are now represented in ZSETs. #190.

[Changes](https://github.com/OptimalBits/bull/compare/v2.2.6...v3.0.0-alpha.1)

## v.2.2.6

- Persisted failedReason when storing job data.
- added queue##isReady()

[Changes](https://github.com/OptimalBits/bull/compare/v2.2.5...v2.2.6)

## v.2.2.5

- Fixed so that redis key prefix works properly.

[Changes](https://github.com/OptimalBits/bull/compare/v2.2.4...v2.2.5)

## v.2.2.4

- Allow reusing certain redis connections.

[Changes](https://github.com/OptimalBits/bull/compare/v2.2.3...v2.2.4)

## v.2.2.3

- Added getJobCounts.
- Fixed global events #394.

[Changes](https://github.com/OptimalBits/bull/compare/v2.2.2...v2.2.3)

## v.2.2.2

- Fixed redis script cache gets bloated after update to bull 2.0 #426

[Changes](https://github.com/OptimalBits/bull/compare/v2.2.1...v2.2.2)

## v.2.2.1

- Re-added createClient option that was removed by mistake.
- Corrected getJobCountByTypes, fixes #419 and #401

[Changes](https://github.com/OptimalBits/bull/compare/v2.2.0...v2.2.1)

## v.2.2.0

- Much improved priority queues, simpler, faster and more reliable.
- Fixed issue where lua scripts where leaking memory.
- Improvements in local pause, fixing #446 and #447.
- Fix to increase delay time over 24 days #244

[Changes](https://github.com/OptimalBits/bull/compare/v2.1.2...v2.2.0)

## v.2.1.2

- Fixed Error renewing lock LockError: Exceeded 0 attempts to lock the resource #437
- Fixed Unable to renew nonexisting lock on job fail #441

[Changes](https://github.com/OptimalBits/bull/compare/v2.1.1...v2.1.2)

## v.2.1.1

- Catch errors produced in timers. Related to #441

[Changes](https://github.com/OptimalBits/bull/compare/v2.1.0...v2.1.1)

## v.2.1.0

- Fixed #397, Error: Unable to renew nonexisting lock
- Fixed #402, Job.prototype.finished contains error in promise
- Fixed #371, "Unexpected token u in JSON at position 0" while processing job
- New feature #363, "method to permanently fail a job"
- Fix job.progress() to return the correct progress

[Changes](https://github.com/OptimalBits/bull/compare/v2.0.0...v2.1.0)

## v.2.0.0

- Changed redis module to ioredis fixing many issues along the way, see changes.

[Changes](https://github.com/OptimalBits/bull/compare/v1.1.3...v2.0.0)

## v.1.1.3

- fixed "Broken constructor pattern from recent commit" #384
- fixed "Queue.prototype.getWaiting() returns empty list if Queue is paused" #342

[Changes](https://github.com/OptimalBits/bull/compare/v1.1.2...v1.1.3)

## v1.1.2

- regained backwards compatibility in events by using disturbed 1.0.6

[Changes](https://github.com/OptimalBits/bull/compare/v1.1.1...v1.1.2)

## v1.1.1

- Returned this in queue##on and queue##once for backwards compatibility.
- [Fixes PriorityQueue Events and Local Worker Pause/Resume](https://github.com/OptimalBits/bull/pull/341)

[Changes](https://github.com/OptimalBits/bull/compare/v1.1.0...v1.1.1)

## v1.1.0

- Fixed [job corruption issue](https://github.com/OptimalBits/bull/pull/359)
- The job id can be [overridden](https://github.com/OptimalBits/bull/pull/335) to implement job throttling behavior
- Added [`removeOnComplete` job option](https://github.com/OptimalBits/bull/pull/361)
- [More robust job retry](https://github.com/OptimalBits/bull/pull/318)
- Events are [now broadcast to all workers](https://github.com/OptimalBits/bull/commit/d55ad1c8f44f86be9b4e9f4fa9a3fc8a16c6e02d)

[Changes](https://github.com/OptimalBits/bull/compare/v1.0.0...v1.1.0)

## v1.0.0

- improvements in clean (fixes and performance).

[Changes](https://github.com/OptimalBits/bull/compare/v1.0.0-rc4...v1.0.0)

## v1.0.0-rc4

- fixed lock renew logic.
- atomized code for getting stalled jobs.

[Changes](https://github.com/OptimalBits/bull/compare/v1.0.0-rc3...v1.0.0-rc4)

## v1.0.0-rc3

- smaller fixes.

[Changes](https://github.com/OptimalBits/bull/compare/v1.0.0-rc2...v1.0.0-rc3)

## v1.0.0-rc2

- Improved locking when removing and processing stalled jobs.
- Fixed #302 EVALSHA failure.
- Fixed #295 error with redis 3.2.
- Correctly allows the specification of the db
- Honor start/end range for complete/failed jobs.
- Fixed #277 Memory Leaks With Large Queue.
- Support for custom key prefix for redis keys.

[Changes](https://github.com/OptimalBits/bull/compare/v1.0.0-rc1...v1.0.0-rc2)

## v1.0.0-rc1

- Removed all potential dangerous hazards by atomizing many operations using
  cached LUA scripts.
- Improved performance around 400% compared to previous version.
- Better pause/resume (#266), and added pause for local workers.
- Fixed #272, #271, #261, #253, #240, #239

[Changes](https://github.com/OptimalBits/bull/compare/v0.7.2...v1.0.0-rc1)

## v0.7.2

- Added local pause/resume functionality
- fixed memory leaks present in the run promise chain.
- fixed "Illegal access to a strict mode caller function".

[Changes](https://github.com/OptimalBits/bull/compare/v0.7.1...v0.7.2)

## v0.7.1

- fixed storing of stacktraces

[Changes](https://github.com/OptimalBits/bull/compare/v0.7.0...v0.7.1)

## v0.7.0

- store the return value from the job handlers.
- store stacktraces.
- improvements in delayed jobs.

[Changes](https://github.com/OptimalBits/bull/compare/v0.6.0...v0.7.0)

## v0.4.0

- added a Queue##clean method

[Changes](https://github.com/OptimalBits/bull/compare/v0.3.0...v0.4.0)

## v0.3.0

- added support for custom clients.
- added test support for node 0.12.
- timeout improvements.
- unit test improvements.
- added timeout to queue pop blocking call.
- removed when dependency.

[Changes](https://github.com/OptimalBits/bull/compare/v0.2.7...v0.3.0)

## v0.2.7

[Changes](https://github.com/OptimalBits/bull/compare/v0.2.6...v0.2.7)

## v0.2.6

- [Fix] #103 When a queue start it do not process delayed job.
  [Changes](https://github.com/OptimalBits/bull/compare/v0.2.5...v0.2.6)

## v0.2.5

- [upgrade] Upgraded node redis to version 0.12.x
- [improvement] eslinted all code.
- [fix] added missing token when calling takeLock on jobs.

[Changes](https://github.com/OptimalBits/bull/compare/v0.2.4...v0.2.5)

## v0.2.4

[Changes](https://github.com/OptimalBits/bull/compare/v0.2.3...v0.2.4)

## v0.2.3

[Changes](https://github.com/OptimalBits/bull/compare/v0.1.9...v0.2.3)

## v0.1.9

- [Improvement] Faster job removal. (manast)

## v0.1.8

- [Improvement] Better promisification of redis methods. (manast)

## v0.1.7

- [Feature] Added a convenience method for getting a job. (loginx)
- [Fix] Only set a redis db from options if defined. (jboga)
- [Fix] Fixed issue #52. (manast)

## v0.1.6

- [Fix] Improved and corrected job's getters.
- [Fix] Automatically restart queues in the event of redis disconnections.
- [Feature] Added support for adding jobs in a LIFO fashion.
