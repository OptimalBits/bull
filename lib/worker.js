/*eslint-env node */
'use strict';

module.exports = function(Queue){
  
  Queue.prototype.setWorkerName = function(){
    return this.client.client('setname', this.clientName());
  };

  Queue.prototype.getWorkers = function(){
    var _this = this;
    return this.client.client('list').then(function(clients){
      return _this.parseClientList(clients);
    });
  };

  Queue.prototype.base64Name = function(){
    return (new Buffer(this.name)).toString('base64');
  };

  Queue.prototype.clientName = function(){
    return this.keyPrefix + ':' + this.base64Name();
  };

  Queue.prototype.parseClientList = function(list){
    var _this = this;
    var lines = list.split('\n');
    var clients = [];

    lines.forEach(function(line){
      var client = {};
      var keyValues = line.split(' ');
      keyValues.forEach(function(keyValue){
        keyValue = keyValue.split('=');
        client[keyValue[0]] = keyValue[1];
      });
      var name = client['name'];
      if(name && name.startsWith(_this.clientName())){
        client['name'] = _this.name;
        clients.push(client);
      }
    });

    return clients;
  };
};

