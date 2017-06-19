

module.exports = {
  setWorkerName: function(){
    var base64 = (new Buffer(this.name)).toString('base64');
    return this.client.client('setname', this.keyPrefix + ':' + base64);
  },
  getWorkers: function(){
    var _this = this;
    return this.client.client('list').then(function(clients){
      return parseClientList(clients, _this.keyPrefix); 
    });
  }
};


function parseClientList(list, prefix){
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
    if(name && name.startsWith(prefix)){
      client['name'] = (new Buffer(name.substr(prefix.length), 'base64')).toString('utf8');
      clients.push(client);
    }
  });

  return clients;
}