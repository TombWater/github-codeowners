'use strict';

const webpack = require('webpack');
const CopyWebpackPlugin = require('copy-webpack-plugin');

const PATHS = require('./paths');

// used in the module rules and in the stats exlude list
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
      // Check for images imported in .js files and
      {
        test: IMAGE_TYPES,
        exclude: /\.svg$/,
        use: [
          {
            loader: 'file-loader',
            options: {
              outputPath: 'images',
              name: '[name].[ext]',
            },
          },
        ],
      },
    ],
  },
  plugins: [
    // Define global constants for conditional compilation
    new webpack.DefinePlugin({
      __DEBUG__: JSON.stringify(mode === 'development'),
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
    // MiniCssExtractPlugin removed - CSS now injected inline for DevTools inspection
  ],
});

module.exports = common;
