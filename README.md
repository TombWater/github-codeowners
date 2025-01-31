# <img src="public/icons/icon_48.png" width="45" align="left"> GitHub Codeowners

GitHub Codeowners Browser Extension

<img src="Screenshot_light.png" alt="light screenshot" width="350"/>
<img src="Screenshot_dark.png" alt="dark screenshot" width="350"/>

## Features

- Decorate each file header with labels showing the owners who must approve that file
- Owner labels of teams that you're a member of are shown in red and have a star (★)
- Owner labels of teams that have already approved are shown in green and have a checkmark (✓)
  - The star becomes lighter in your own teams (☆)
- Hovering on an owner label shows a tooltip with the members of that team
- Clicking an owner label expands all the files with that owner, and collapses the others

## Install

The plan is to get these into the Chrome and Firefox stores, but until then clone this repo and build it locally.

> [!TIP]
> If you don't already have Node.js and npm, you'll need to [install](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm) them first.

Build the extension:
```
npm install
npm run build
```
... then from the resulting `build/` directory
* Chrome: [Load unpacked](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked) extension
* Firefox: [Install](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Your_first_WebExtension#installing) as a tempory add-on

> [!IMPORTANT]
> After installing the extension, if your repo needs a GitHub token to access it, paste it in the extension's popup UI by clicking on its icon.

## Privacy

All data collected by this extension is kept and used only within the browser; it is not transmitted out of the extension.

The data collected includes:
* The username of the logged-in GitHub user is read from the page metadata.
* The GitHub access token provided by the user is kept in local storage.
* The usernames and team names mentioned in the `CODEOWNERS` file are collected and cached in memory.
* Team member usernames for teams mentioned in `CODEOWNERS` are collected and cached in memory.

---

This project was bootstrapped with [Chrome Extension CLI](https://github.com/dutiyesh/chrome-extension-cli)

