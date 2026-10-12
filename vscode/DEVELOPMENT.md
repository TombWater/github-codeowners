# Developing the VSCode extension

This document is a short version: the steps to build, install and debug this extension, without the need to learn VSCode extension development first.

If a step here is out of date, or you want more detail, the Microsoft documentation is the reference:

- [Your First Extension](https://code.visualstudio.com/api/get-started/your-first-extension): how an extension runs, and [debugging it](https://code.visualstudio.com/api/get-started/your-first-extension#debugging-the-extension) in an Extension Development Host
- [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension): packaging a `.vsix` with `vsce`
- [Install from a VSIX](https://code.visualstudio.com/docs/configure/extensions/extension-marketplace#_install-from-a-vsix)
- [Command Palette](https://code.visualstudio.com/docs/editing/getting-started/userinterface#_command-palette)
- [The `code` command line](https://code.visualstudio.com/docs/configure/command-line), and [adding it to the PATH on macOS](https://code.visualstudio.com/docs/setup/mac#_launch-vs-code-from-the-command-line)

## Words used in this document

- **`.vsix` file**: the package file of a VSCode extension. You install it in VSCode as you install an extension from the Marketplace.
- **Command Palette**: the VSCode command search. To open it, push **Cmd+Shift+P** (macOS) or **Ctrl+Shift+P** (Windows, Linux). Then type the name of the command.
- **Extension Development Host**: a second VSCode window that loads the extension directly from its source folder. You use it to debug with breakpoints.

## Before you start

1. Install the [GitHub Pull Requests](https://marketplace.visualstudio.com/items?itemName=GitHub.vscode-pull-request-github) extension in VSCode, and sign in to GitHub with it.
2. Make sure that the `code` command is available in your terminal. If it is not:
   1. In VSCode, open the Command Palette.
   2. Run **Shell Command: Install 'code' command in PATH**.
3. In the repo root, run `npm install`.

## Build and install the extension

Use this procedure to try the extension in your usual VSCode window.

1. In the repo root, run:

   ```sh
   npm run vscode:package
   ```

   This builds `vscode/github-codeowners-vscode-<version>.vsix`. The build stops with an error if the version in `vscode/package.json` is not the same as in `public/manifest.json`. Both extensions share one version number.
2. Install the package:

   ```sh
   code --install-extension vscode/github-codeowners-vscode-<version>.vsix --force
   ```

   `--force` replaces an installed copy with the same version. Alternatively, in the Extensions view, click **…** at the top, select **Install from VSIX…**, and select the file.
3. Open the Command Palette and run **Developer: Reload Window**. VSCode loads the new version.
4. Open a repository that has a CODEOWNERS file, and check out a pull request with the GitHub Pull Requests extension. The **Code Owners** view shows in the **GitHub Pull Request** panel of the activity bar.
5. The first time, VSCode asks you to let the extension use your GitHub account. Accept. The extension needs the `repo` scope to read the repository, and the `read:org` scope to read team members.

After each code change, do steps 1 to 3 again.

To remove the extension, open the Extensions view, find **GitHub Code Owners for Pull Requests**, and click **Uninstall**.

## Debug with breakpoints

Use this procedure to stop in the code and examine values.

1. In the repo root, run `npm run vscode:watch`. Keep it running. It builds the extension again each time that you save a file.
2. In VSCode, open the `vscode/` folder (**File → Open Folder…**). Do not open the repo root: the debug configuration is in `vscode/.vscode/launch.json`.
3. Push **F5**. VSCode opens the Extension Development Host window. This window uses the extension from your source folder. If the `.vsix` is also installed, the source folder version replaces it in this window.
4. In the Extension Development Host window, open a repository that has a CODEOWNERS file.
5. In the first window, set breakpoints in `vscode/src/*.js`. Messages from `console.log` show in the **Debug Console** of the first window.
6. After a code change, wait for `vscode:watch` to finish the build. Then, in the Extension Development Host window, run **Developer: Reload Window**.

## Logs

The extension writes its log to **View → Output**. In the list at the top right of the Output panel, select **GitHub Code Owners**.
