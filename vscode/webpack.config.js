'use strict';

const path = require('path');

// Bundles vscode/src and the shared ../core into one CommonJS file.
// Dependencies (`ignore`) resolve from the root node_modules.
module.exports = {
  target: 'node',
  entry: './src/extension.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
  },
  externals: {
    vscode: 'commonjs vscode',
  },
  resolve: {
    modules: [path.resolve(__dirname, '../node_modules'), 'node_modules'],
  },
  devtool: 'source-map',
  stats: {all: false, errors: true, builtAt: true, assets: true},
};
