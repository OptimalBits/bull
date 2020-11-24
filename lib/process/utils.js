'use strict';

function hasProcessExited(child) {
  return !!(child.exitCode !== null || child.signalCode);
}

function onExitOnce(child) {
  return new Promise(resolve => {
    child.once('exit', () => resolve());
  });
}

/**
 * Sends a kill signal to a child resolving when the child has exited,
 * resorting to SIGKILL if the given timeout is reached
 *
 * @param {ChildProcess} child
 * @param {'SIGTERM' | 'SIGKILL'} [signal] initial signal to use
 * @param {number} [timeoutMs] time to wait until sending SIGKILL
 *
 * @returns {Promise<void>} the killed child
 */
function killAsync(child, signal, timeoutMs) {
  if (hasProcessExited(child)) {
    return Promise.resolve(child);
  }

  // catch any new on exit
  let onExit = onExitOnce(child);

  child.kill(signal || 'SIGKILL');

  if (timeoutMs === 0 || isFinite(timeoutMs)) {
    const timeout = setTimeout(() => {
      if (!hasProcessExited(child)) {
        child.kill('SIGKILL');
      }
    }, timeoutMs);

    onExit = onExit.then(() => {
      clearTimeout(timeout);
    });
  }
  return onExit;
}

module.exports = {
  killAsync
};
