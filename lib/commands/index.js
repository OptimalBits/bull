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

var utils = require('../utils');

function readdirAsync(path) {
  return new Promise(function(resolve, reject) {
    fs.readdir(path, function(error, result) {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
}

function readFileAsync(path) {
  return new Promise(function(resolve, reject) {
    fs.readFile(path, function(error, result) {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
}

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
  return readdirAsync(dir)
    .filter(function(file) {
      return path.extname(file) === '.lua';
    })
    .map(function(file) {
      var longName = path.basename(file, '.lua');
      var name = longName.split('-')[0];
      var numberOfKeys = parseInt(longName.split('-')[1]);

      return readFileAsync(path.join(dir, file)).then(function(lua) {
        return {
          name: name,
          options: { numberOfKeys: numberOfKeys, lua: lua.toString() }
        };
      });
    });
}
