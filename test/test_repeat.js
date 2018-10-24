/*eslint-env node */
'use strict';

var expect = require('chai').expect;
var utils = require('./utils');
var sinon = require('sinon');
var redis = require('ioredis');
var moment = require('moment');
var _ = require('lodash');

var ONE_SECOND = 1000;
var ONE_MINUTE = 60 * ONE_SECOND;
var ONE_HOUR = 60 * ONE_MINUTE;
var ONE_DAY = 24 * ONE_HOUR;
var MAX_INT = 2147483647;

describe('repeat', function() {
  var queue;
  var client;

  beforeEach(function() {
    this.clock = sinon.useFakeTimers();
    client = new redis();
    return client.flushdb().then(function() {
      queue = utils.buildQueue('repeat', {
        settings: {
          tickInterval: MAX_INT,
          stalledInterval: MAX_INT,
          drainDelay: 1 // Small delay so that .close is faster.
        }
      });
      return queue;
    });
  });

  afterEach(function() {
    this.clock.restore();
    return queue.close().then(function() {
      return client.quit();
    });
  });

  it('should create multiple jobs if they have the same cron pattern', function(done) {
    var cron = '*/10 * * * * *';
    var customJobIds = ['customjobone', 'customjobtwo'];

    Promise.all([
      queue.add({}, { jobId: customJobIds[0], repeat: { cron: cron } }),
      queue.add({}, { jobId: customJobIds[1], repeat: { cron: cron } })
    ])
      .then(function() {
        return queue.count();
      })
      .then(function(count) {
        expect(count).to.be.eql(2);
        done();
      })
      .catch(done);
  });

  it('should get repeatable jobs with different cron pattern', function(done) {
    var crons = ['10 * * * * *', '2 10 * * * *', '1 * * 5 * *', '2 * * 4 * *'];

    Promise.all([
      queue.add('first', {}, { repeat: { cron: crons[0], endDate: 12345 } }),
      queue.add('second', {}, { repeat: { cron: crons[1], endDate: 610000 } }),
      queue.add(
        'third',
        {},
        { repeat: { cron: crons[2], tz: 'Africa/Abidjan' } }
      ),
      queue.add(
        'fourth',
        {},
        { repeat: { cron: crons[3], tz: 'Africa/Accra' } }
      )
    ])
      .then(function() {
        return queue.getRepeatableCount();
      })
      .then(function(count) {
        expect(count).to.be.eql(4);
        return queue.getRepeatableJobs(0, -1, true);
      })
      .then(function(jobs) {
        return jobs.sort(function(a, b) {
          return crons.indexOf(a.cron) > crons.indexOf(b.cron);
        });
      })
      .then(function(jobs) {
        expect(jobs)
          .to.be.and.an('array')
          .and.have.length(4);

        expect(jobs[0]).to.include({
          cron: '10 * * * * *',
          next: 10000,
          endDate: 12345
        });
        expect(jobs[1]).to.include({
          cron: '2 10 * * * *',
          next: 602000,
          endDate: 610000
        });
        expect(jobs[2]).to.include({
          cron: '1 * * 5 * *',
          next: 345601000,
          tz: 'Africa/Abidjan'
        });
        expect(jobs[3]).to.include({
          cron: '2 * * 4 * *',
          next: 259202000,
          tz: 'Africa/Accra'
        });
        done();
      })
      .catch(done);
  });

  it('should repeat every 2 seconds', function(done) {
    var _this = this;
    var date = new Date('2017-02-07 9:24:00');
    this.clock.tick(date.getTime());
    var nextTick = 2 * ONE_SECOND + 500;

    queue
      .add('repeat', { foo: 'bar' }, { repeat: { cron: '*/2 * * * * *' } })
      .then(function() {
        _this.clock.tick(nextTick);
      });

    queue.process('repeat', function() {
      // dummy
    });

    var prev;
    var counter = 0;
    queue.on('completed', function(job) {
      _this.clock.tick(nextTick);
      if (prev) {
        expect(prev.timestamp).to.be.lt(job.timestamp);
        expect(job.timestamp - prev.timestamp).to.be.gte(2000);
      }
      prev = job;
      counter++;
      if (counter == 20) {
        done();
      }
    });
  });

  it('should repeat every 2 seconds with startDate in future', function(done) {
    var _this = this;
    var date = new Date('2017-02-07 9:24:00');
    this.clock.tick(date.getTime());
    var nextTick = 2 * ONE_SECOND + 500;
    var delay = 5 * ONE_SECOND + 500;

    queue
      .add(
        'repeat',
        { foo: 'bar' },
        {
          repeat: {
            cron: '*/2 * * * * *',
            startDate: new Date('2017-02-07 9:24:05')
          }
        }
      )
      .then(function() {
        _this.clock.tick(nextTick + delay);
      });

    queue.process('repeat', function() {
      // dummy
    });

    var prev;
    var counter = 0;
    queue.on('completed', function(job) {
      _this.clock.tick(nextTick);
      if (prev) {
        expect(prev.timestamp).to.be.lt(job.timestamp);
        expect(job.timestamp - prev.timestamp).to.be.gte(2000);
      }
      prev = job;
      counter++;
      if (counter == 20) {
        done();
      }
    });
  });

  it('should repeat every 2 seconds with startDate in past', function(done) {
    var _this = this;
    var date = new Date('2017-02-07 9:24:00');
    this.clock.tick(date.getTime());
    var nextTick = 2 * ONE_SECOND + 500;

    queue
      .add(
        'repeat',
        { foo: 'bar' },
        {
          repeat: {
            cron: '*/2 * * * * *',
            startDate: new Date('2017-02-07 9:22:00')
          }
        }
      )
      .then(function() {
        _this.clock.tick(nextTick);
      });

    queue.process('repeat', function() {
      // dummy
    });

    var prev;
    var counter = 0;
    queue.on('completed', function(job) {
      _this.clock.tick(nextTick);
      if (prev) {
        expect(prev.timestamp).to.be.lt(job.timestamp);
        expect(job.timestamp - prev.timestamp).to.be.gte(2000);
      }
      prev = job;
      counter++;
      if (counter == 20) {
        done();
      }
    });
  });

  it('should repeat once a day for 5 days', function(done) {
    var _this = this;
    var date = new Date('2017-05-05 13:12:00');
    this.clock.tick(date.getTime());
    var nextTick = ONE_DAY;

    queue
      .add(
        'repeat',
        { foo: 'bar' },
        {
          repeat: {
            cron: '0 1 * * *',
            endDate: new Date('2017-05-10 13:12:00')
          }
        }
      )
      .then(function() {
        _this.clock.tick(nextTick);
      });

    queue.process('repeat', function() {
      // Dummy
    });

    var prev;
    var counter = 0;
    queue.on('completed', function(job) {
      _this.clock.tick(nextTick);
      if (prev) {
        expect(prev.timestamp).to.be.lt(job.timestamp);
        expect(job.timestamp - prev.timestamp).to.be.gte(ONE_DAY);
      }
      prev = job;

      counter++;
      if (counter == 5) {
        queue.getWaiting().then(function(jobs) {
          expect(jobs.length).to.be.eql(0);
          queue.getDelayed().then(function(jobs) {
            expect(jobs.length).to.be.eql(0);
            done();
          });
        });
      }
    });
  });

  it('should repeat 7:th day every month at 9:25', function(done) {
    var _this = this;
    var date = new Date('2017-02-02 7:21:42');
    this.clock.tick(date.getTime());

    function nextTick() {
      var now = moment();
      var nextMonth = moment().add(1, 'months');
      _this.clock.tick(nextMonth - now);
    }

    queue
      .add('repeat', { foo: 'bar' }, { repeat: { cron: '* 25 9 7 * *' } })
      .then(function() {
        nextTick();
      });

    queue.process('repeat', function(/*job*/) {
      // Dummy
    });

    var counter = 20;
    var prev;
    queue.on('completed', function(job) {
      if (prev) {
        expect(prev.timestamp).to.be.lt(job.timestamp);
        var diff = moment(job.timestamp).diff(
          moment(prev.timestamp),
          'months',
          true
        );
        expect(diff).to.be.gte(1);
      }
      prev = job;

      counter--;
      if (counter == 0) {
        done();
      }
      nextTick();
    });
  });

  it('should create two jobs with the same ids', function() {
    var options = {
      repeat: {
        cron: '0 1 * * *'
      }
    };

    var p1 = queue.add({ foo: 'bar' }, options);
    var p2 = queue.add({ foo: 'bar' }, options);

    return Promise.all([p1, p2]).then(function(jobs) {
      expect(jobs.length).to.be.eql(2);
      expect(jobs[0].id).to.be.eql(jobs[1].id);
    });
  });

  it('should allow removing a named repeatable job', function(done) {
    var _this = this;
    var date = new Date('2017-02-07 9:24:00');
    this.clock.tick(date.getTime());

    var nextTick = 2 * ONE_SECOND;
    var repeat = { cron: '*/2 * * * * *' };

    queue.add('remove', { foo: 'bar' }, { repeat: repeat }).then(function() {
      _this.clock.tick(nextTick);
    });

    queue.process('remove', function() {
      counter++;
      if (counter == 20) {
        return queue.removeRepeatable('remove', repeat).then(function() {
          _this.clock.tick(nextTick);
          return queue.getDelayed().then(function(delayed) {
            expect(delayed).to.be.empty;
            done();
            return null;
          });
        });
      } else if (counter > 20) {
        done(Error('should not repeat more than 20 times'));
      }
    });

    var prev;
    var counter = 0;
    queue.on('completed', function(job) {
      _this.clock.tick(nextTick);
      if (prev) {
        expect(prev.timestamp).to.be.lt(job.timestamp);
        expect(job.timestamp - prev.timestamp).to.be.gte(2000);
      }
      prev = job;
    });
  });

  it('should allow removing a customId repeatable job', function(done) {
    var _this = this;
    var date = new Date('2017-02-07 9:24:00');
    this.clock.tick(date.getTime());

    var nextTick = 2 * ONE_SECOND;
    var repeat = { cron: '*/2 * * * * *' };

    queue
      .add({ foo: 'bar' }, { repeat: repeat, jobId: 'xxxx' })
      .then(function() {
        _this.clock.tick(nextTick);
      });

    queue.process(function() {
      counter++;
      if (counter == 20) {
        return queue
          .removeRepeatable(_.defaults({ jobId: 'xxxx' }, repeat))
          .then(function() {
            _this.clock.tick(nextTick);
            return queue.getDelayed().then(function(delayed) {
              expect(delayed).to.be.empty;
              done();
              return null;
            });
          });
      } else if (counter > 20) {
        done(Error('should not repeat more than 20 times'));
      }
    });

    var prev;
    var counter = 0;
    queue.on('completed', function(job) {
      _this.clock.tick(nextTick);
      if (prev) {
        expect(prev.timestamp).to.be.lt(job.timestamp);
        expect(job.timestamp - prev.timestamp).to.be.gte(2000);
      }
      prev = job;
    });
  });

  it('should not re-add a repeatable job after it has been removed', function() {
    var _this = this;
    var date = new Date('2017-02-07 9:24:00');
    var nextTick = 2 * ONE_SECOND;
    var repeat = { cron: '*/2 * * * * *' };
    var nextRepeatableJob = queue.nextRepeatableJob;
    this.clock.tick(date.getTime());

    var afterRemoved = new Promise(function(resolve) {
      queue.process(function() {
        queue.nextRepeatableJob = function() {
          var args = arguments;
          // In order to simulate race condition
          // Make removeRepeatables happen any time after a moveToX is called
          return queue
            .removeRepeatable(_.defaults({ jobId: 'xxxx' }, repeat))
            .then(function() {
              // nextRepeatableJob will now re-add the removed repeatable
              return nextRepeatableJob.apply(queue, args);
            })
            .then(function(result) {
              resolve();
              return result;
            });
        };
      });

      queue
        .add({ foo: 'bar' }, { repeat: repeat, jobId: 'xxxx' })
        .then(function() {
          _this.clock.tick(nextTick);
        });

      queue.on('completed', function() {
        _this.clock.tick(nextTick);
      });
    });

    return afterRemoved.then(function() {
      return queue.getRepeatableJobs().then(function(jobs) {
        // Repeatable job was recreated
        expect(jobs.length).to.eql(0);
      });
    });
  });

  it('should allow adding a repeatable job after removing it', function() {
    queue.process(function(/*job*/) {
      // dummy
    });

    var repeat = {
      cron: '*/5 * * * *'
    };

    return queue
      .add(
        'myTestJob',
        {
          data: '2'
        },
        {
          repeat: repeat
        }
      )
      .then(function() {
        return queue.getDelayed();
      })
      .then(function(delayed) {
        expect(delayed.length).to.be.eql(1);
      })
      .then(function() {
        return queue.removeRepeatable('myTestJob', repeat);
      })
      .then(function() {
        return queue.getDelayed();
      })
      .then(function(delayed) {
        expect(delayed.length).to.be.eql(0);
      })
      .then(function() {
        return queue.add(
          'myTestJob',
          {
            data: '2'
          },
          {
            repeat: repeat
          }
        );
      })
      .then(function() {
        return queue.getDelayed();
      })
      .then(function(delayed) {
        expect(delayed.length).to.be.eql(1);
      });
  });

  it('should not repeat more than 5 times', function(done) {
    var _this = this;
    var date = new Date('2017-02-07 9:24:00');
    this.clock.tick(date.getTime());
    var nextTick = ONE_SECOND + 500;

    queue
      .add(
        'repeat',
        { foo: 'bar' },
        { repeat: { limit: 5, cron: '*/1 * * * * *' } }
      )
      .then(function() {
        _this.clock.tick(nextTick);
      });

    queue.process('repeat', function() {
      // dummy
    });

    var counter = 0;
    queue.on('completed', function() {
      _this.clock.tick(nextTick);
      counter++;
      if (counter == 5) {
        utils.sleep(nextTick * 2).then(function() {
          done();
        }, nextTick * 2);
      } else if (counter > 5) {
        done(Error('should not repeat more than 5 times'));
      }
    });
  });

  it('should processes delayed jobs by priority', function(done) {
    var _this = this;
    var jobAdds = [];
    var currentPriority = 1;
    var nextTick = 1000;
    var total = 0;

    jobAdds.push(queue.add({ p: 1 }, { priority: 1, delay: nextTick * 3 }));
    jobAdds.push(queue.add({ p: 2 }, { priority: 2, delay: nextTick * 2 }));
    jobAdds.push(queue.add({ p: 3 }, { priority: 3, delay: nextTick }));

    _this.clock.tick(nextTick * 3);

    Promise.all(jobAdds).then(function() {
      queue.process(function(job, jobDone) {
        expect(job.id).to.be.ok;
        expect(job.data.p).to.be.eql(currentPriority++);
        total++;
        jobDone();

        if (currentPriority > 3) {
          done();
        }
      });
    }, done);
  });

  it('should use ".every" as a valid interval', function(done) {
    var _this = this;
    var interval = ONE_SECOND * 2;
    var date = new Date('2017-02-07 9:24:00');

    // Quantize time
    var time = Math.floor(date.getTime() / interval) * interval;
    this.clock.tick(time);

    var nextTick = ONE_SECOND * 2 + 500;

    queue
      .add('repeat m', { type: 'm' }, { repeat: { every: interval } })
      .then(function() {
        return queue.add(
          'repeat s',
          { type: 's' },
          { repeat: { every: interval } }
        );
      })
      .then(function() {
        _this.clock.tick(nextTick);
      });

    queue.process('repeat m', function() {
      // dummy
    });

    queue.process('repeat s', function() {
      // dummy
    });

    var prevType;
    var counter = 0;
    queue.on('completed', function(job) {
      _this.clock.tick(nextTick);
      if (prevType) {
        expect(prevType).to.not.be.eql(job.data.type);
      }
      prevType = job.data.type;
      counter++;
      if (counter == 20) {
        done();
      }
    });
  });

  it('should throw an error when using .cron and .every simutaneously', function(done) {
    queue
      .add(
        'repeat',
        { type: 'm' },
        { repeat: { every: 5000, cron: '*/1 * * * * *' } }
      )
      .then(
        function() {
          throw new Error('The error was not thrown');
        },
        function(err) {
          expect(err.message).to.be.eql(
            'Both .cron and .every options are defined for this repeatable job'
          );
          done();
        }
      );
  });

  it('should emit a waiting event when adding a repeatable job to the waiting list', function(done) {
    var _this = this;
    var date = new Date('2017-02-07 9:24:00');
    this.clock.tick(date.getTime());
    var nextTick = 2 * ONE_SECOND + 500;

    queue.on('waiting', function(jobId) {
      expect(jobId).to.be.equal(
        'repeat:93168b0ea97b55fb5a8325e8c66e4300:' +
          (date.getTime() + 2 * ONE_SECOND)
      );
      done();
    });

    queue
      .add('repeat', { foo: 'bar' }, { repeat: { cron: '*/2 * * * * *' } })
      .then(function() {
        _this.clock.tick(nextTick);
      });

    queue.process('repeat', function() {
      console.error('hiasd');
    });
  });

  it('should have the right count value', function(done) {
    var _this = this;

    queue.add({ foo: 'bar' }, { repeat: { every: 1000 } }).then(function() {
      _this.clock.tick(ONE_SECOND);
    });

    queue.process(function(job) {
      if (job.opts.repeat.count === 1) {
        done();
      } else {
        done(Error('repeatable job got the wrong repeat count'));
      }
    });
  });
});
