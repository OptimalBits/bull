'use strict';
const { createHash } = require('crypto');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');

const readFile = promisify(fs.readFile);
const readdir = promisify(fs.readdir);

const GlobOptions = { dot: true, silent: false };
const IncludeRegex = /^[-]{2,3}[ \t]*@include[ \t]+(["'])(.+?)\1[; \t\n]*$/m;
const EmptyLineRegex = /^\s*[\r\n]/gm;

class ScriptLoaderError extends Error {
  /**
   * The include stack
   */

  constructor(message, path, stack = [], line, position = 0) {
    super(message);
    // Ensure the name of this error is the same as the class name
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
    this.includes = stack;
    this.line = line ? line : 0;
    this.position = position;
  }
}

const isPossiblyMappedPath = path => path && ['~', '<'].includes(path[0]);

/**
 * Lua script loader with include support
 */
class ScriptLoader {
  constructor() {
    this.pathMapper = new Map();
    this.clientScripts = new WeakMap();
    /**
     * Cache commands by dir
     */
    this.commandCache = new Map();
    this.rootPath = getPkgJsonDir();
    this.pathMapper.set('~', this.rootPath);
    this.pathMapper.set('rootDir', this.rootPath);
    this.pathMapper.set('base', __dirname);
  }

  /**
   * Add a script path mapping. Allows includes of the form "<includes>/utils.lua" where `includes` is a user
   * defined path
   * @param name - the name of the mapping. Note: do not include angle brackets
   * @param mappedPath - if a relative path is passed, it's relative to the *caller* of this function.
   * Mapped paths are also accepted, e.g. "~/server/scripts/lua" or "<base>/includes"
   */
  addPathMapping(name, mappedPath) {
    let resolved;

    if (isPossiblyMappedPath(mappedPath)) {
      resolved = this.resolvePath(mappedPath);
    } else {
      const caller = getCallerFile();
      const callerPath = path.dirname(caller);
      resolved = path.normalize(path.resolve(callerPath, mappedPath));
    }

    const last = resolved.length - 1;
    if (resolved[last] === path.sep) {
      resolved = resolved.substr(0, last);
    }

    this.pathMapper.set(name, resolved);
  }

  /**
   * Resolve the script path considering path mappings
   * @param scriptName - the name of the script
   * @param stack - the include stack, for nicer errors
   */
  resolvePath(scriptName, stack = []) {
    const first = scriptName[0];
    if (first === '~') {
      scriptName = path.join(this.rootPath, scriptName.substr(2));
    } else if (first === '<') {
      const p = scriptName.indexOf('>');
      if (p > 0) {
        const name = scriptName.substring(1, p);
        const mappedPath = this.pathMapper.get(name);
        if (!mappedPath) {
          throw new ScriptLoaderError(
            `No path mapping found for "${name}"`,
            scriptName,
            stack
          );
        }
        scriptName = path.join(mappedPath, scriptName.substring(p + 1));
      }
    }

    return path.normalize(scriptName);
  }

  /**
   * Recursively collect all scripts included in a file
   * @param file - the parent file
   * @param cache - a cache for file metadata to increase efficiency. Since a file can be included
   * multiple times, we make sure to load it only once.
   * @param stack - internal stack to prevent circular references
   */
  async resolveDependencies(file, cache, isInclude = false, stack = []) {
    cache = cache ? cache : new Map();

    if (stack.includes(file.path)) {
      throw new ScriptLoaderError(
        `circular reference: "${file.path}"`,
        file.path,
        stack
      );
    }
    stack.push(file.path);

    function findPos(content, match) {
      const pos = content.indexOf(match);
      const arr = content.slice(0, pos).split('\n');
      return {
        line: arr.length,
        column: arr[arr.length - 1].length + match.indexOf('@include') + 1
      };
    }

    function raiseError(msg, match) {
      const pos = findPos(file.content, match);
      throw new ScriptLoaderError(msg, file.path, stack, pos.line, pos.column);
    }
    // eslint-disable-next-line node/no-unpublished-require
    const minimatch = require('minimatch');

    if (!minimatch) {
      console.warn('Install minimatch as dev-dependency');
    }

    const Minimatch = minimatch.Minimatch || class Empty {};
    // eslint-disable-next-line node/no-unpublished-require
    const fg = require('fast-glob');

    if (!fg) {
      console.warn('Install fast-glob as dev-dependency');
    }

    const nonOp = () => {
      return [''];
    };
    const glob = fg ? fg.glob : nonOp;

    const hasMagic = pattern => {
      if (!Array.isArray(pattern)) {
        pattern = [pattern];
      }
      for (const p of pattern) {
        if (new Minimatch(p, GlobOptions).hasMagic()) {
          return true;
        }
      }
      return false;
    };

    const hasFilenamePattern = path => hasMagic(path);

    async function getFilenamesByPattern(pattern) {
      return glob(pattern, { dot: true });
    }

    let res;
    let content = file.content;

    while ((res = IncludeRegex.exec(content)) !== null) {
      const [match, , reference] = res;

      const includeFilename = isPossiblyMappedPath(reference)
        ? // mapped paths imply absolute reference
          this.resolvePath(ensureExt(reference), stack)
        : // include path is relative to the file being processed
          path.resolve(path.dirname(file.path), ensureExt(reference));

      let includePaths;

      if (hasFilenamePattern(includeFilename)) {
        const filesMatched = await getFilenamesByPattern(includeFilename);
        includePaths = filesMatched.map(x => path.resolve(x));
      } else {
        includePaths = [includeFilename];
      }

      includePaths = includePaths.filter(file => path.extname(file) === '.lua');

      if (includePaths.length === 0) {
        raiseError(`include not found: "${reference}"`, match);
      }

      const tokens = [];

      for (let i = 0; i < includePaths.length; i++) {
        const includePath = includePaths[i];

        const hasInclude = file.includes.find(x => x.path === includePath);

        if (hasInclude) {
          /**
           * We have something like
           * --- \@include "a"
           * ...
           * --- \@include "a"
           */
          raiseError(
            `file "${reference}" already included in "${file.path}"`,
            match
          );
        }

        let includeMetadata = cache.get(includePath);
        let token;

        if (!includeMetadata) {
          const { name, numberOfKeys } = splitFilename(includePath);
          let childContent = '';
          try {
            const buf = await readFile(includePath, { flag: 'r' });
            childContent = buf.toString();
          } catch (err) {
            if (err.code === 'ENOENT') {
              raiseError(`include not found: "${reference}"`, match);
            } else {
              throw err;
            }
          }
          // this represents a normalized version of the path to make replacement easy
          token = getPathHash(includePath);
          includeMetadata = {
            name,
            numberOfKeys,
            path: includePath,
            content: childContent,
            token,
            includes: []
          };
          cache.set(includePath, includeMetadata);
        } else {
          token = includeMetadata.token;
        }

        tokens.push(token);

        file.includes.push(includeMetadata);
        await this.resolveDependencies(includeMetadata, cache, true, stack);
      }

      // Replace @includes with normalized path hashes
      const substitution = tokens.join('\n');
      content = content.replace(match, substitution);
    }

    file.content = content;

    if (isInclude) {
      cache.set(file.path, file);
    } else {
      cache.set(file.name, file);
    }

    stack.pop();
  }

  /**
   * Parse a (top-level) lua script
   * @param filename - the full path to the script
   * @param content - the content of the script
   * @param cache - cache
   */
  async parseScript(filename, content, cache) {
    const { name, numberOfKeys } = splitFilename(filename);
    const meta = cache ? cache.get(name) : undefined;
    if (meta && meta.content === content) {
      return meta;
    }
    const fileInfo = {
      path: filename,
      token: getPathHash(filename),
      content,
      name,
      numberOfKeys,
      includes: []
    };

    await this.resolveDependencies(fileInfo, cache);
    return fileInfo;
  }

  /**
   * Construct the final version of a file by interpolating its includes in dependency order.
   * @param file - the file whose content we want to construct
   * @param processed - a cache to keep track of which includes have already been processed
   */
  interpolate(file, processed) {
    processed = processed || new Set();
    let content = file.content;
    file.includes.forEach(child => {
      const emitted = processed ? processed.has(child.path) : undefined;
      const fragment = this.interpolate(child, processed);
      const replacement = emitted ? '' : fragment;

      if (!replacement) {
        content = replaceAll(content, child.token, '');
      } else {
        // replace the first instance with the dependency
        content = content.replace(child.token, replacement);
        // remove the rest
        content = replaceAll(content, child.token, '');
      }

      if (processed) {
        processed.add(child.path);
      }
    });

    return content;
  }

  async loadCommand(filename, cache) {
    filename = path.resolve(filename);

    const { name: scriptName } = splitFilename(filename);
    let script = cache ? cache.get(scriptName) : undefined;
    if (!script) {
      const content = (await readFile(filename)).toString();
      script = await this.parseScript(filename, content, cache);
    }

    const lua = removeEmptyLines(this.interpolate(script));
    const { name, numberOfKeys } = script;

    return {
      name,
      options: { numberOfKeys: numberOfKeys, lua }
    };
  }

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
  async loadScripts(dir, cache) {
    dir = path.normalize(dir || __dirname);

    let commands = this.commandCache.get(dir);
    if (commands) {
      return commands;
    }

    const files = await readdir(dir);

    const luaFiles = files.filter(file => path.extname(file) === '.lua');

    if (luaFiles.length === 0) {
      /**
       * To prevent unclarified runtime error "updateDelayset is not a function
       * @see https://github.com/OptimalBits/bull/issues/920
       */
      throw new ScriptLoaderError('No .lua files found!', dir, []);
    }

    commands = [];
    cache = cache ? cache : new Map();

    for (let i = 0; i < luaFiles.length; i++) {
      const file = path.join(dir, luaFiles[i]);

      const command = await this.loadCommand(file, cache);
      commands.push(command);
    }

    this.commandCache.set(dir, commands);

    return commands;
  }

  /**
   * Attach all lua scripts in a given directory to a client instance
   * @param client - redis client to attach script to
   * @param pathname - the path to the directory containing the scripts
   */
  async load(client, pathname, cache) {
    let paths = this.clientScripts.get(client);
    if (!paths) {
      paths = new Set();
      this.clientScripts.set(client, paths);
    }
    if (!paths.has(pathname)) {
      paths.add(pathname);
      const scripts = await this.loadScripts(
        pathname,
        cache ? cache : new Map()
      );
      scripts.forEach(command => {
        // Only define the command if not already defined
        if (!client[command.name]) {
          client.defineCommand(command.name, command.options);
        }
      });
    }
  }

  /**
   * Clears the command cache
   */
  clearCache() {
    this.commandCache.clear();
  }
}

function ensureExt(filename, ext = 'lua') {
  const foundExt = path.extname(filename);
  if (foundExt && foundExt !== '.') {
    return filename;
  }
  if (ext && ext[0] !== '.') {
    ext = `.${ext}`;
  }
  return `${filename}${ext}`;
}

function splitFilename(filePath) {
  const longName = path.basename(filePath, '.lua');
  const [name, num] = longName.split('-');
  const numberOfKeys = num ? parseInt(num, 10) : undefined;
  return { name, numberOfKeys };
}

// Determine the project root
// https://stackoverflow.com/a/18721515
function getPkgJsonDir() {
  for (const modPath of module.paths || []) {
    try {
      const prospectivePkgJsonDir = path.dirname(modPath);
      fs.accessSync(modPath, fs.constants.F_OK);
      return prospectivePkgJsonDir;
      // eslint-disable-next-line no-empty
    } catch (e) {}
  }
  return '';
}

// https://stackoverflow.com/a/66842927
// some dark magic here :-)
// this version is preferred to the simpler version because of
// https://github.com/facebook/jest/issues/5303 -
// tldr: dont assume you're the only one with the doing something like this
function getCallerFile() {
  const originalFunc = Error.prepareStackTrace;

  let callerFile = '';
  try {
    Error.prepareStackTrace = (_, stack) => stack;

    const sites = new Error().stack;
    const shiftResponse = sites.shift();
    const currentFile = shiftResponse ? shiftResponse.getFileName() : undefined;

    while (sites.length) {
      const newShiftResponse = sites.shift();
      callerFile = newShiftResponse ? newShiftResponse.getFileName() : '';

      if (currentFile !== callerFile) {
        break;
      }
    }
    // eslint-disable-next-line no-empty
  } catch (e) {
  } finally {
    Error.prepareStackTrace = originalFunc;
  }

  return callerFile;
}

function sha1(data) {
  return createHash('sha1')
    .update(data)
    .digest('hex');
}

function getPathHash(normalizedPath) {
  return `@@${sha1(normalizedPath)}`;
}

function replaceAll(str, find, replace) {
  return str.replace(new RegExp(find, 'g'), replace);
}

function removeEmptyLines(str) {
  return str.replace(EmptyLineRegex, '');
}

module.exports = {
  ScriptLoaderError,
  ScriptLoader
};
