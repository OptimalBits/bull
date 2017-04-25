/*eslint-env node */
'use strict';

var gulp = require('gulp'),
  eslint = require('gulp-eslint');

gulp.task('lint', function () {
  // Note: To have the process exit with an error code (1) on
  //  lint error, return the stream and pipe to failOnError last.
  return gulp.src([
    './lib/**.js',
    '!./lib/priority-queue.js', // This file is deprecated.
    './test/**.js'
  ])
    .pipe(eslint({
      rules: {
        'indent': [2, 2, {"SwitchCase": 1}],
        'valid-jsdoc': 0,
        'semi': 2,
        'func-style': 0,
        'no-use-before-define': 0,
        'camelcase': 1,
        'no-unused-vars': 1,
        'no-alert': 1,
        'no-console': [2, { allow: ["warn", "error"] }],
        'quotes': [2, "single"],
        'no-underscore-dangle': 0
      },
      globals: {
        'define': true,
        'describe': true,
        'it': true,
        'setTimeout': true,
        'after': true,
        'afterEach': true,
        'beforeEach': true,
        'before': true
      }
    }))
    .pipe(eslint.format())
    .pipe(eslint.failAfterError());
});

gulp.task('default', ['lint'], function () {
  // This will only run if the lint task is successful...
});
