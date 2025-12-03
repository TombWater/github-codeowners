'use strict';

const common = require('./webpack.common.js');
const PATHS = require('./paths');

const config = (env, argv) => ({
  ...common(argv.mode),
  entry: {
    content: PATHS.browser + '/decorator.js',
  },
  devtool: argv.mode === 'production' ? false : 'source-map',
});

module.exports = config;

// Fake change for screenshot demo
