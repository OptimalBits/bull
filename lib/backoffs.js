var _ = require('lodash');

var builtinStrategies = {
  fixed: function(delay) {
    return function() {
      return delay;
    };
  },

  exponential: function(delay) {
    return function(attemptsMade) {
      return Math.round((Math.pow(2, attemptsMade) - 1) * delay);
    };
  }
};

function lookupStrategy(backoff, customStrategies) {
  if (backoff.type in customStrategies) {
    return customStrategies[backoff.type];
  } else if (backoff.type in builtinStrategies) {
    return builtinStrategies[backoff.type](backoff.delay);
  } else {
    throw new Error(
      'Unknown backoff strategy ' +
        backoff.type +
        '. If a custom backoff strategy is used, specify it when the queue is created.'
    );
  }
}

module.exports = {
  normalize: function(backoff) {
    if (_.isFinite(backoff)) {
      return {
        type: 'fixed',
        delay: backoff
      };
    } else if (backoff) {
      return backoff;
    }
  },

  calculate: function(backoff, attemptsMade, customStrategies) {
    if (backoff) {
      var strategy = lookupStrategy(backoff, customStrategies);

      return strategy(attemptsMade);
    }
  }
};
