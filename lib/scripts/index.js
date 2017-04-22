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

var fs = require('fs');
var path = require('path');

//
// for some very strange reason, defining scripts with this code results in this error
// when executing the scripts: ERR value is not an integer or out of range
//
module.exports = function(client){
  loadScripts(client, __dirname);
}

function loadScripts(client, dir) {
  fs.readdirSync(dir).filter(function (file) {
    return path.extname(file) === '.lua';
  }).forEach(function (file) {
    var longName = path.basename(file, '.lua');
    var name = longName.split('-')[0];
    var numberOfKeys = longName.split('-')[1];

    var lua = fs.readFileSync(path.join(dir, file)).toString();
    client.defineCommand(name, { numberOfKeys: numberOfKeys, lua: lua });
  });
};
