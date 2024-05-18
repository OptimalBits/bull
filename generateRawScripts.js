'use strict';
const { ScriptLoader } = require('./lib/commands');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');

const writeFile = promisify(fs.writeFile);

class RawScriptLoader extends ScriptLoader {
  /**
   * Transpile lua scripts in one file, specifying an specific directory to be saved
   * @param pathname - the path to the directory containing the scripts
   * @param writeDir - the path to the directory where scripts will be saved
   */
  async transpileScripts(pathname, writeDir) {
    const writeFilenamePath = path.normalize(writeDir);

    if (!fs.existsSync(writeFilenamePath)) {
      fs.mkdirSync(writeFilenamePath);
    }

    const paths = new Set();
    if (!paths.has(pathname)) {
      paths.add(pathname);
      const scripts = await this.loadScripts(pathname);
      for (const command of scripts) {
        const {
          name,
          options: { numberOfKeys, lua }
        } = command;
        await writeFile(
          path.join(writeFilenamePath, `${name}-${numberOfKeys}.lua`),
          lua
        );
      }
    }
  }
}

const scriptLoader = new RawScriptLoader();

scriptLoader.transpileScripts(
  path.join(__dirname, './lib/commands'),
  path.join(__dirname, './rawScripts')
);
