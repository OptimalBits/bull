/**
 * Load redis lua scripts.
 * The name of the script must have the following format:
 * 
 * cmdName-numKeys.lua
 * 
 * cmdName must be in camel case format.
 * 
 * For example:
 * moveToFinish-3.lua
 * 
 */
'use strict';

var fs = require('fs');
var path = require('path');
var Promise = require('bluebird');

fs = Promise.promisifyAll(fs);

//
// for some very strange reason, defining scripts with this code results in this error
// when executing the scripts: ERR value is not an integer or out of range
//
module.exports = function(client){
  return loadScripts(client, __dirname);
}

function loadScripts(client, dir) {
  return fs.readdirAsync(dir).then(function(files){
    return Promise.all(files.filter(function (file) {
      return path.extname(file) === '.lua';
    }).map(function (file) {
      var longName = path.basename(file, '.lua');
      var name = longName.split('-')[0];
      var numberOfKeys = parseInt(longName.split('-')[1]);

      return fs.readFileAsync(path.join(dir, file)).then(function(lua){
        client.defineCommand(name, { numberOfKeys: numberOfKeys, lua: lua.toString() });
      }, function(err){
        console.log('Error reading script file', err)
      });
    }));
  });
};
