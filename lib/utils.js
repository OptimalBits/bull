'use strict';

var errorObject = {value: null};
function tryCatch(fn, ctx, args) {
  try {
    return fn.apply(ctx, args);
  }
  catch(e) {
    errorObject.value = e;
    return errorObject;
  }
}

function isEmpty(obj){
  for(var key in obj) {
    if(obj.hasOwnProperty(key)){
      return false;
    }
  }
  return true;
}

module.exports.errorObject = errorObject;
module.exports.tryCatch = tryCatch;
module.exports.isEmpty = isEmpty;
