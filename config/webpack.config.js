'use strict';

const {merge} = require('webpack-merge');

const common = require('./webpack.common.js');
const PATHS = require('./paths');

// Merge webpack configuration files
const config = (env, argv) =>
  merge(common(argv.mode), {
    entry: {
      content: PATHS.src + '/decorator.js',
    },
    devtool: argv.mode === 'production' ? false : 'source-map',
  });

module.exports = config;

// Fake change for screenshot demo
