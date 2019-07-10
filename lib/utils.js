'use strict';
const errorObject = { value: null };
function tryCatch(fn, ctx, args) {
  try {
    return fn.apply(ctx, args);
  } catch (e) {
    errorObject.value = e;
    return errorObject;
  }
}

function isEmpty(obj) {
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      return false;
    }
  }
  return true;
}

/**
 * Waits for a redis client to be ready.
 * @param {Redis} redis client
 */
function isRedisReady(client) {
  return new Promise((resolve, reject) => {
    if (client.status === 'ready') {
      resolve();
    } else {
      function handleReady() {
        client.removeListener('error', handleError);
        resolve();
      }

      function handleError(err) {
        client.removeListener('ready', handleReady);
        reject(err);
      }

      client.once('ready', handleReady);
      client.once('error', handleError);
    }
  });
}

/**
 * Checks the size of string for ascii/non-ascii characters
 * (Reference: https://stackoverflow.com/a/23318053/1347170)
 * @param {string} str
 */
function lengthInUtf8Bytes(str) {
  return Buffer.byteLength(str, 'utf8')
}

module.exports.errorObject = errorObject;
module.exports.tryCatch = tryCatch;
module.exports.isEmpty = isEmpty;
module.exports.isRedisReady = isRedisReady;
module.exports.lengthInUtf8Bytes = lengthInUtf8Bytes;
