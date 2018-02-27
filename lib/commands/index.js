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

var utils = require('../utils');

fs = Promise.promisifyAll(fs);

//
// for some very strange reason, defining scripts with this code results in this error
// when executing the scripts: ERR value is not an integer or out of range
//
module.exports = (function() {
  var scripts;

  return function(client) {
    return utils.isRedisReady(client).then(function() {
      scripts = scripts || loadScripts(__dirname);

      return scripts.each(function(command) {
        return client.defineCommand(command.name, command.options);
      });
    });
  };
})();

function loadScripts(dir) {
  return fs
    .readdirAsync(dir)
    .filter(function(file) {
      return path.extname(file) === '.lua';
    })
    .map(function(file) {
      var longName = path.basename(file, '.lua');
      var name = longName.split('-')[0];
      var numberOfKeys = parseInt(longName.split('-')[1]);

      return fs.readFileAsync(path.join(dir, file)).then(function(lua) {
        return {
          name: name,
          options: { numberOfKeys: numberOfKeys, lua: lua.toString() }
        };
      });
    });
}
