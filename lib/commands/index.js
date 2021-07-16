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

  return async function(client) {
    await utils.isRedisReady(client);
    scripts = await (scripts || loadScripts(__dirname));

    return scripts.map(({ name, options }) =>
      client.defineCommand(name, options)
    );
  };
})();

async function loadScripts(dir) {
  const scriptsDir = await _fs.readdirAsync(dir);
  const luaFiles = scriptsDir.filter(file => path.extname(file) === '.lua');
  if (luaFiles.length === 0) {
    /**
     * To prevent unclarified runtime error "updateDelayset is not a function
     * @see https://github.com/OptimalBits/bull/issues/920
     */
    throw new Error('No .lua files found!');
  }
  return Promise.all(
    luaFiles.map(async file => {
      const lua = await _fs.readFileAsync(path.join(dir, file));
      const longName = path.basename(file, '.lua');

      return {
        name: longName.split('-')[0],
        options: {
          numberOfKeys: parseInt(longName.split('-')[1]),
          lua: lua.toString()
        }
      };
    })
  );
}
