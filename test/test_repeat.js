/*eslint-env node */
'use strict';

var expect = require('chai').expect;
var utils = require('./utils');
var sinon = require('sinon');
var redis = require('ioredis');

var ONE_SECOND = 1000;
var ONE_MINUTE = 60 * ONE_SECOND;
var ONE_HOUR = 60 * ONE_MINUTE;
var ONE_DAY = 24 * ONE_HOUR;
var ONE_MONTH = 31 * ONE_DAY;

describe('repeat', function () {
  var sandbox = sinon.sandbox.create();
  var queue;

  beforeEach(function(){
    this.clock = sinon.useFakeTimers();
    var client = new redis();
    return client.flushdb().then(function(){
      queue = utils.buildQueue('repeat', {settings: { 
        guardInterval: Number.MAX_VALUE,
        stalledInterval: Number.MAX_VALUE
      }});
    });
  });

  afterEach(function(){
    this.clock.restore();
  });

  it('should repeat every 2 seconds', function (done) {
    var _this = this;
    var date = new Date('2017-02-07 9:24:00');
    this.clock.tick(date.getTime());
    var nextTick = 2 * ONE_SECOND + 500;

    queue.repeat('repeat', {foo: 'bar'}, '*/2 * * * * *').then(function(){
      _this.clock.tick(nextTick);
    });

    queue.process('repeat', function(){
      // dummy
    });

    var prev;
    var counter = 0;
    queue.on('completed', function(job){
      _this.clock.tick(nextTick);
      if(prev){
        expect(prev.timestamp).to.be.lt(job.timestamp);
        expect(job.timestamp - prev.timestamp).to.be.gte(2000);
      }
      prev = job;
      counter ++;
      if(counter == 20){
        done();
      }
    });
  });

  it('should repeat once a day for 5 days', function (done) {
    var _this = this;
    this.timeout(50000);
    var date = new Date('2017-05-05 13:12:00');
    this.clock.tick(date.getTime());
    var nextTick = ONE_DAY;

    queue.repeat('repeat', {foo: 'bar'}, '0 1 * * *', {endDate: new Date('2017-05-10 13:12:00')}).then(function(){
      _this.clock.tick(nextTick);
    });

    queue.process('repeat', function(){
      // Dummy
    });

    var prev;
    var counter = 0;
    queue.on('completed', function(job){
      _this.clock.tick(nextTick);
      if(prev){
        expect(prev.timestamp).to.be.lt(job.timestamp);
        expect(job.timestamp - prev.timestamp).to.be.gte(ONE_DAY);
      }
      prev = job;

      counter ++;
      if(counter == 5){
        queue.getWaiting().then(function(jobs){
          expect(jobs.length).to.be.zero;
          queue.getDelayed().then(function(jobs){
            expect(jobs.length).to.be.zero;
            done();
          });
        });
      }
    });
  });

  it('should repeat 7:th day every month at 9:25', function (done) {
    var _this = this;
    var date = new Date('2017-02-02 7:21:42');
    this.clock.tick(date.getTime());

    queue.repeat('repeat', {foo: 'bar'}, '* 25 9 7 * *').then(function(){
      _this.clock.tick(ONE_MONTH);
    });

    queue.process('repeat', function(){
      // Dummy
    });

    var counter = 20;
    var prev;
    queue.on('completed', function(job){
      if(prev){
        expect(prev.timestamp).to.be.lt(job.timestamp);
        expect(job.timestamp - prev.timestamp).to.be.gte(ONE_MONTH);
      }
      prev = job;

      counter --;
      if(counter == 0){
        done();
      }
      _this.clock.tick(ONE_MONTH);
    });
  });
});
