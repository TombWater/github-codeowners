'use strict';

// Both extensions share one version number (see CLAUDE.md "Releases").
// Refuse to package the VSCode extension when it has drifted.
const browser = require('../public/manifest.json').version;
const vscode = require('./package.json').version;

if (browser !== vscode) {
  console.error(
    `Version mismatch: public/manifest.json is ${browser}, vscode/package.json is ${vscode}. Bump both together.`
  );
  process.exit(1);
}
