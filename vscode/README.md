# GitHub Code Owners for Pull Requests (VSCode)

Shows CODEOWNERS approval status for pull requests that you open with the
[GitHub Pull Requests](https://marketplace.visualstudio.com/items?itemName=GitHub.vscode-pull-request-github)
extension. It is an add-on for that extension and does nothing without it: if it is not installed or is disabled, a notification offers to open its page, where you can install or enable it.

It shares its ownership logic with the [GitHub Codeowners browser extension](https://github.com/TombWater/github-codeowners), which shows the same information on GitHub's pull request pages. Install that from the [Chrome Web Store](https://chromewebstore.google.com/detail/GitHub%20Codeowners/bleicmjinodghcdonmnfgmjmhgnhppbk) or [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/github-codeowners/).

## Features

- **File badges** in "Changes in Pull Request" and in the files of PRs in the PR list:
  - ★ (red): needs your approval
  - ◐: waiting for approval from other owners
  - ✓: approved
  - Hover a file to see its owners and their team members.
- **Code Owners view** in the Pull Request panel. It groups the changed files by owner, puts the groups that need your approval first, and shows a summary such as "2 of 3 owner groups approved".
  - Click a team, person or group to open every file those owners can approve, from all groups, in one multi-file diff.
  - It shows the checked-out PR, like the panes above it.
- Approvals happen on GitHub, so the data refreshes when you return to VSCode and every 5 minutes. **Refresh** in the view's title bar updates it immediately.

## Limits

- **The GitHub Pull Requests extension is not a declared dependency**, so VSCode does not install it with this extension. The notification with the **Install or Enable** button replaces the dependency. The reason: VSCode shows the file badges of the extension that registered last first. With a declared dependency, VSCode always starts the GitHub Pull Requests extension first, so its badge provider registers first, and our ★, ◐ or ✓ then shows *before* its M, A or D letter. Because the letters have different widths, our badges would then not align. Without the dependency, this extension usually starts first, registers its badges, and then starts the GitHub Pull Requests extension itself.
- **The badge order is usually, not always, correct.** VSCode can start the GitHub Pull Requests extension first, for example to restore a pull request description or diff tab when it opens a window. Then our badge shows before the M, A or D letter until you reload the window (**Developer: Reload Window**). The log says when this happens. The badges, the view and the diffs work correctly either way.
- The PR overview page is a webview that belongs to the GitHub Pull Requests extension. Other extensions cannot add content to it, so the summary shows in the Code Owners view instead.
- Team membership needs the `read:org` scope. If your organization restricts OAuth app access, team members are unknown, and only direct approvals by listed users count.

## Development

Quick start, in the repo root:

```sh
npm install
npm run vscode:package
code --install-extension vscode/github-codeowners-vscode-<version>.vsix --force
```

Then run **Developer: Reload Window** from the Command Palette.

- For all steps, debugging with breakpoints and logs, see [DEVELOPMENT.md](https://github.com/TombWater/github-codeowners/blob/main/vscode/DEVELOPMENT.md).
- If you have never worked on a VSCode extension, the VSCode docs explain the basics: [Your First Extension](https://code.visualstudio.com/api/get-started/your-first-extension) and [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) (packaging with `vsce`).
