/*eslint-env node */
'use strict';

var utils = require('./utils');
module.exports = function(Queue) {
  // IDEA, How to store metadata associated to a worker.
  // create a key from the worker ID associated to the given name.
  // We keep a hash table bull:myqueue:workers where every worker is a hash key workername:workerId with json holding
  // metadata of the worker. The worker key gets expired every 30 seconds or so, we renew the worker metadata.
  //
  Queue.prototype.setWorkerName = function() {
    var _this = this;
    return utils.isRedisReady(this.client).then(function() {
      return _this.client.client('setname', _this.clientName());
    });
  };

  Queue.prototype.getWorkers = function() {
    var _this = this;
    return utils
      .isRedisReady(this.client)
      .then(function() {
        return _this.client.client('list');
      })
      .then(function(clients) {
        return _this.parseClientList(clients);
      });
  };

  Queue.prototype.base64Name = function() {
    return new Buffer(this.name).toString('base64');
  };

  Queue.prototype.clientName = function() {
    return this.keyPrefix + ':' + this.base64Name();
  };

  Queue.prototype.parseClientList = function(list) {
    var _this = this;
    var lines = list.split('\n');
    var clients = [];

    lines.forEach(function(line) {
      var client = {};
      var keyValues = line.split(' ');
      keyValues.forEach(function(keyValue) {
        var index = keyValue.indexOf('=');
        var key = keyValue.substring(0, index);
        var value = keyValue.substring(index + 1);
        client[key] = value;
      });
      var name = client['name'];
      if (name && name.startsWith(_this.clientName())) {
        client['name'] = _this.name;
        clients.push(client);
      }
    });
    return clients;
  };
};
