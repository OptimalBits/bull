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
var promisify = require('util.promisify'); //TODO in node >= 8 could be removed

var utils = require('../utils');

//TODO node >= 10 could be used require('fs').promises()
var _fs = {
  readdirAsync: promisify(fs.readdir),
  readFileAsync: promisify(fs.readFile)
};

module.exports = (function() {
  var scripts;

  return function(client) {
    return utils.isRedisReady(client).then(function() {
      scripts = scripts || loadScripts(__dirname);

      return scripts.then(function(_scripts) {
        return _scripts.forEach(function(command) {
          return client.defineCommand(command.name, command.options);
        });
      });
    });
  };
})();

function loadScripts(dir) {
  return _fs
    .readdirAsync(dir)
    .then(function(files) {
      return files.filter(function(file) {
        return path.extname(file) === '.lua';
      });
    })
    .then(function(files) {
      return Promise.all(
        files.map(function(file) {
          var longName = path.basename(file, '.lua');
          var name = longName.split('-')[0];
          var numberOfKeys = parseInt(longName.split('-')[1]);

          return _fs.readFileAsync(path.join(dir, file)).then(function(lua) {
            return {
              name: name,
              options: { numberOfKeys: numberOfKeys, lua: lua.toString() }
            };
          });
        })
      );
    });
}
