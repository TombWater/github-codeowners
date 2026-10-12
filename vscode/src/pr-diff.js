import * as path from 'path';
import * as vscode from 'vscode';
import {log} from './log';

// File rows open exactly what the PR extension's Changes list opens:
// vscode.diff (vscode.open for added files) on the same URIs. That gives
// the same behaviour for free: VSCode passes those two commands the
// list's open event, so a click keeps the focus in the list and Enter
// moves it to the editor, and an editor already open on the same inputs
// is brought to the front with its scroll position kept.

// The PR extension's GitChangeType enum, which its pr: URIs carry
const CHANGE_TYPES = {
  ADDED: 0,
  COPIED: 1,
  DELETED: 2,
  CHANGED: 3,
  MODIFIED: 3,
  RENAMED: 4,
};

// Name of the git remote that points at owner/repo
const remoteNameFor = (root, {owner, repo}) => {
  const git = vscode.extensions.getExtension('vscode.git')?.exports?.getAPI(1);
  const repository = git?.getRepository(root);
  const pattern = new RegExp(`[/:]${owner}/${repo}(\\.git)?$`, 'i');
  const remote = repository?.state.remotes.find((r) =>
    pattern.test(r.fetchUrl ?? r.pushUrl ?? '')
  );
  return remote?.name ?? 'origin';
};

// The PR extension's URIs, keys in its order (toPRUri / toReviewUri)

// Other PRs: served by its pr: provider, which loads the PR on demand
const prUri = (fileUri, root, pr, filePath, isBase) =>
  fileUri.with({
    scheme: 'pr',
    query: JSON.stringify({
      baseCommit: pr.mergeBase,
      headCommit: pr.headRefOid,
      isBase,
      fileName: filePath,
      prNumber: pr.number,
      status: CHANGE_TYPES[pr.changeTypes.get(filePath)] ?? 3,
      remoteName: remoteNameFor(root, pr),
    }),
  });

// Checked-out PR: a review: URI at a commit of the local repository
const reviewUri = (fileUri, root, filePath, commit, base) =>
  fileUri.with({
    scheme: 'review',
    query: JSON.stringify({
      path: filePath ?? fileUri.path,
      commit,
      base,
      isOutdated: false,
      rootPath: root.path,
    }),
  });

// Base and head of a PR file, as the PR extension's Changes list has them
const prFileUris = ({pr}, root, filePath, checkedOut) => {
  const fileUri = vscode.Uri.joinPath(root, filePath);
  const deleted = pr.changeTypes.get(filePath) === 'DELETED';
  if (!checkedOut) {
    return {
      base: prUri(fileUri, root, pr, filePath, true),
      head: prUri(fileUri, root, pr, filePath, false),
    };
  }
  return {
    base: reviewUri(fileUri, root, filePath, pr.mergeBase, true),
    head: deleted ? reviewUri(fileUri, root, undefined, '', false) : fileUri,
  };
};

// Tree row command. Added files have nothing to compare with, so they open
// the file itself, as the PR extension does.
export const fileCommand = (data, root, filePath, checkedOut) => {
  const {base, head} = prFileUris(data, root, filePath, checkedOut);
  if (data.pr.changeTypes.get(filePath) === 'ADDED') {
    return {command: 'vscode.open', title: 'Open File', arguments: [head, {}]};
  }
  return {
    command: 'vscode.diff',
    title: 'Open Changed File in Pull Request',
    arguments: [
      base,
      head,
      `${path.posix.basename(filePath)} (Pull Request)`,
      {},
    ],
  };
};

// Inline "Open Changes" buttons: files in one multi-file diff, as the PR
// extension's "Changes in Pull Request" view. vscode.changes gives every
// editor a random identity, so each click opened another tab. This
// workbench command takes the identity instead: one per PR head, group or
// owner, which brings an open tab to the front. It is internal, so fall
// back to vscode.changes if it goes away.
export const openChanges = async (tracker, {prNumber, paths, title, key}) => {
  try {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    const data = await tracker.get(prNumber);
    if (!root || !data) return;
    const checkedOut =
      (await tracker.describe())?.pullRequest?.number === prNumber;
    const label = `${title} — Changes in Pull Request #${prNumber}`;
    const resources = paths.map((filePath) => {
      const {base, head} = prFileUris(data, root, filePath, checkedOut);
      const type = data.pr.changeTypes.get(filePath);
      return {
        originalUri: type === 'ADDED' ? undefined : base,
        modifiedUri: type === 'DELETED' ? undefined : head,
      };
    });
    const source = vscode.Uri.from({
      scheme: 'multi-diff-editor',
      path: `ghco/${prNumber}/${data.pr.headRefOid}/${key}`,
    });
    try {
      await vscode.commands.executeCommand('_workbench.openMultiDiffEditor', {
        multiDiffSourceUri: source,
        title: label,
        resources,
      });
    } catch (e) {
      log('Multi-file diff by identity failed, opening a new one:', e.message);
      await vscode.commands.executeCommand(
        'vscode.changes',
        label,
        resources.map(({originalUri, modifiedUri}, index) => [
          vscode.Uri.joinPath(root, paths[index]),
          originalUri,
          modifiedUri,
        ])
      );
    }
  } catch (e) {
    log('Opening changes failed:', e.message);
  }
};

// Inline "Open File" button: the local file for the checked-out PR, else
// the PR head (the base for a deleted file)
export const openPrFile = async (tracker, prNumber, filePath) => {
  try {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    const data = await tracker.get(prNumber);
    if (!root || !data) return;
    const checkedOut =
      (await tracker.describe())?.pullRequest?.number === prNumber;
    const deleted = data.pr.changeTypes.get(filePath) === 'DELETED';
    const {base, head} = prFileUris(data, root, filePath, checkedOut);
    await vscode.window.showTextDocument(deleted ? base : head);
  } catch (e) {
    log(`Opening ${filePath} failed:`, e.message);
  }
};

// PR number and repo-relative path of the file in the active editor or
// diff tab, as far as it can be told: pr:/review: URIs name both, a local
// file under the workspace is taken to be the checked-out PR's
export const activePrFile = (checkedOutNumber) => {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  const uri =
    input instanceof vscode.TabInputTextDiff
      ? input.modified
      : input instanceof vscode.TabInputText
      ? input.uri
      : null;
  if (!uri) return null;
  if (uri.scheme === 'pr' || uri.scheme === 'review') {
    try {
      const {prNumber, fileName} = JSON.parse(uri.query);
      if (fileName)
        return {prNumber: prNumber ?? checkedOutNumber, filePath: fileName};
    } catch {}
    return null;
  }
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (uri.scheme !== 'file' || !root || !uri.path.startsWith(`${root.path}/`)) {
    return null;
  }
  return {
    prNumber: checkedOutNumber,
    filePath: uri.path.slice(root.path.length + 1),
  };
};
