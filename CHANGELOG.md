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
