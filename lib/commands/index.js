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

const fs = require('fs');
const path = require('path');
const promisify = require('util.promisify'); //TODO in node >= 8 could be removed

const utils = require('../utils');

//TODO node >= 10 could be used require('fs').promises()
const _fs = {
  readdirAsync: promisify(fs.readdir),
  readFileAsync: promisify(fs.readFile)
};

module.exports = (function() {
  let scripts;

  return function(client) {
    return utils.isRedisReady(client).then(() => {
      scripts = scripts || loadScripts(__dirname);

      return scripts.then(_scripts => {
        return _scripts.forEach(command => {
          return client.defineCommand(command.name, command.options);
        });
      });
    });
  };
})();

function loadScripts(dir) {
  return _fs
    .readdirAsync(dir)
    .then(files => {
      return files.filter(file => {
        return path.extname(file) === '.lua';
      });
    })
    .then(files => {
      return Promise.all(
        files.map(file => {
          const longName = path.basename(file, '.lua');
          const name = longName.split('-')[0];
          const numberOfKeys = parseInt(longName.split('-')[1]);

          return _fs.readFileAsync(path.join(dir, file)).then(lua => {
            return {
              name: name,
              options: { numberOfKeys: numberOfKeys, lua: lua.toString() }
            };
          });
        })
      );
    });
}
