'use strict';

// Printed after `npm run package`: how to install the .vsix it just wrote.
const path = require('path');
const {name, version} = require('./package.json');

const vsix = path.join(__dirname, `${name}-${version}.vsix`);

console.log(`
To install this build:
  code --install-extension ${vsix} --force
Then run "Developer: Reload Window" in VSCode.
`);
