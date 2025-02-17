# <img src="public/icons/icon_48.png" width="45" align="left"> GitHub Codeowners

GitHub Codeowners Browser Extension

<img src="Screenshot_light.png" alt="light screenshot" width="350"/>
<img src="Screenshot_dark.png" alt="dark screenshot" width="350"/>

## Features

- Decorate each file header with labels showing the owners who must approve that file
- Owner labels of teams that you're a member of are shown in red and have a star (★)
- Owner labels of teams that have already approved are shown in green and have a checkmark (✓)
  - The star becomes lighter in your own teams that have approved (☆)
- Hovering on an owner label shows a tooltip with the members of that team
- Clicking an owner label expands all the files with that owner, and collapses the others

## Install

### Chrome

Install from [Chrome Store](https://chromewebstore.google.com/detail/GitHub%20Codeowners/bleicmjinodghcdonmnfgmjmhgnhppbk)

### Firefox

Install from [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/github-codeowners/)

### Access Token

If you're using a private repo in an organization, make a classic access token with full control of private repositories. (https://github.com/settings/tokens)

<img src="Repo_token.png" alt="personal access token scopes (repo)" width="333"/>

(This allows the extension to read the PR and CODEOWNERS from the repository, as well as team members from the organization.)

Paste the token in the extension's popup UI by clicking its icon.

## Building

> [!TIP]
> If you don't already have Node.js and npm, you'll need to [install](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm) them first.

```
npm install
npm run build
```

The extension will be in the `build/` directory.

## Privacy

All data collected by this extension is kept and used only within the browser; it is not transmitted out of the extension.

The data collected includes:
* The username of the logged-in GitHub user is read from the page metadata.
* The GitHub access token provided by the user is kept in local storage.
* The usernames and team names mentioned in the `CODEOWNERS` file are collected and cached in memory.
* Team member usernames for teams mentioned in `CODEOWNERS` are collected and cached in memory.

---

This project was bootstrapped with [Chrome Extension CLI](https://github.com/dutiyesh/chrome-extension-cli)

