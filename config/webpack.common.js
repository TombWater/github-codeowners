'use strict';

const webpack = require('webpack');
const CopyWebpackPlugin = require('copy-webpack-plugin');

const PATHS = require('./paths');

// left out of the stats list: the icons copied from `public`
const IMAGE_TYPES = /\.(png|jpe?g|gif|svg)$/i;

// To re-use webpack configuration across templates,
// CLI maintains a common webpack configuration file - `webpack.common.js`.
// Whenever user creates an extension, CLI adds `webpack.common.js` file
// in template's `config` folder
const common = (mode = 'production') => ({
  output: {
    // the build folder to output bundles and assets in.
    path: PATHS.build,
    // the filename template for entry chunks
    filename: '[name].js',
  },
  stats: {
    all: false,
    errors: true,
    builtAt: true,
    assets: true,
    excludeAssets: [IMAGE_TYPES],
  },
  module: {
    rules: [
      // Import CSS as raw string for inline injection
      {
        test: /\.css$/,
        type: 'asset/source',
      },
      // Import SVG as raw string for inline use
      {
        test: /\.svg$/,
        type: 'asset/source',
      },
    ],
  },
  plugins: [
    // Define global constants for conditional compilation
    new webpack.DefinePlugin({
      __DEBUG__: JSON.stringify(mode === 'development'),
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    }),
    // Copy static assets from `public` folder to `build` folder
    new CopyWebpackPlugin({
      patterns: [
        {
          from: '**/*',
          context: 'public',
          globOptions: {
            ignore: ['**/*.sh'],
          },
        },
      ],
    }),
  ],
});

module.exports = common;
