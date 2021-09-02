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
        client.removeListener('end', handleEnd);
        client.removeListener('error', handleError);
        resolve();
      }

      let lastError;
      function handleError(err) {
        lastError = err;
      }

      function handleEnd() {
        client.removeListener('ready', handleReady);
        client.removeListener('error', handleError);
        reject(lastError);
      }

      client.once('ready', handleReady);
      client.on('error', handleError);
      client.once('end', handleEnd);
    }
  });
}

module.exports.errorObject = errorObject;
module.exports.tryCatch = tryCatch;
module.exports.isRedisReady = isRedisReady;
