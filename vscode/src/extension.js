import * as vscode from 'vscode';
import {PrTracker} from './pr-tracker';
import {OwnerDecorationProvider} from './decorations';
import {OwnersViewProvider, setViewState} from './owners-view';
import {log} from './log';
import {activePrFile, activePrNumber, openPrFile} from './pr-diff';

const PR_EXTENSION_ID = 'GitHub.vscode-pull-request-github';
// Approvals happen on GitHub, which sends no event. Refresh now and then
// while the view is visible, and when the user comes back to VSCode.
const REFRESH_INTERVAL = 5 * 60 * 1000;
const FOCUS_REFRESH_AGE = 30 * 1000;
// The PR extension loads the checked-out PR some time after startup and
// fires no event for it, so look often until a PR is found
const SEARCH_INTERVAL = 3 * 1000;
// How long to say "Looking for a pull request…" before "No checked-out
// pull request". The PR extension's own github:inReviewMode key covers a
// checked-out PR that is still loading after this.
const SEARCH_GRACE = 20 * 1000;

// Start the PR extension ourselves, as soon as our badge provider is
// registered (see activate), rather than wait for its onStartupFinished
const getPrApi = async () => {
  const extension = vscode.extensions.getExtension(PR_EXTENSION_ID);
  if (!extension) return null;
  const exports = await extension.activate();
  return exports?.getAPI ? exports.getAPI(1) : exports;
};

// PR number of the focused PR overview tab, if any. The overview is a
// webview we can't draw into, but its tab tells us which PR is on screen.
const activeOverviewPrNumber = () => {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  const input = tab?.input;
  if (!(input instanceof vscode.TabInputWebview)) return null;
  if (!input.viewType.endsWith('PullRequestOverview')) return null;
  const match = tab.label.match(/#(\d+)/);
  return match ? Number(match[1]) : null;
};

export const activate = async (context) => {
  // VSCode lists badges newest provider first, so register before the PR
  // extension activates to put our badge after its M/A/D letter. Best
  // effort only: it can start before us, e.g. to restore a PR overview or
  // diff tab, and a registered provider can't be removed. Say so in the log.
  if (vscode.extensions.getExtension(PR_EXTENSION_ID)?.isActive) {
    log(
      `${PR_EXTENSION_ID} started before this extension, so badges show before its M/A/D letter until the window reloads`
    );
  }
  const tracker = new PrTracker(null);
  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider(
      new OwnerDecorationProvider(tracker)
    )
  );
  // Then start the PR extension at once; don't wait for it here
  const prApiPromise = getPrApi();
  const ownersView = new OwnersViewProvider(tracker);
  const treeView = vscode.window.createTreeView('ghco.codeOwners', {
    treeDataProvider: ownersView,
  });
  ownersView.attach(treeView);

  const activatedAt = Date.now();
  setViewState('searching');
  let pinnedNumber = null;
  const updatePr = async () => {
    try {
      // The PR on screen: its overview, else a diff of its file(s)
      const number =
        activeOverviewPrNumber() ??
        activePrNumber() ??
        pinnedNumber ??
        (await tracker.describe())?.pullRequest?.number ??
        null;
      if (number !== ownersView.prNumber) log('Showing PR', number);
      if (!number) {
        setViewState(
          Date.now() - activatedAt < SEARCH_GRACE ? 'searching' : 'noPr'
        );
      }
      ownersView.setPrNumber(number);
    } catch (e) {
      log('Finding the PR failed:', e.message);
    }
  };

  const timer = setInterval(() => {
    if (!treeView.visible) return;
    if (!ownersView.prNumber) {
      updatePr();
    } else if (tracker.ageOf(ownersView.prNumber) >= REFRESH_INTERVAL) {
      updatePr();
      tracker.invalidate(ownersView.prNumber);
    }
  }, SEARCH_INTERVAL);

  const onWindowFocus = ({focused}) => {
    if (!focused) return;
    updatePr();
    tracker.refreshOlderThan(FOCUS_REFRESH_AGE);
  };

  // A checkout changes which PR is active
  const git = vscode.extensions.getExtension('vscode.git');
  const gitApi = git && (await git.activate())?.getAPI(1);
  const watchRepo = (repo) =>
    context.subscriptions.push(repo.state.onDidChange(updatePr));
  gitApi?.repositories.forEach(watchRepo);
  if (gitApi) {
    context.subscriptions.push(
      gitApi.onDidOpenRepository((repo) => {
        watchRepo(repo);
        updatePr();
      })
    );
  }

  // Follow the active editor, like the PR extension's Changes list
  // Only when the active tab really changed: VSCode also fires tab events
  // while a new editor is still opening, with the old tab still active, and
  // re-selecting that tab's file would undo a click in our list. A rebuild
  // loses the selection, so it syncs regardless (force).
  let lastSyncedTab = null;
  const activeTabKey = () => {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    if (input instanceof vscode.TabInputTextDiff) {
      return `${input.original}|${input.modified}`;
    }
    if (input instanceof vscode.TabInputText) return `${input.uri}`;
    return input ? 'other' : null;
  };
  const syncSelection = async (force = false) => {
    const key = activeTabKey();
    if (!force && key === lastSyncedTab) return;
    lastSyncedTab = key;
    try {
      const checkedOut = (await tracker.describe())?.pullRequest?.number;
      const file = activePrFile(checkedOut);
      if (file) ownersView.revealFile(file.prNumber, file.filePath);
    } catch (e) {
      log('Following the editor failed:', e.message);
    }
  };

  ownersView.onDidRebuild = () => syncSelection(true);

  context.subscriptions.push(
    treeView,
    vscode.window.tabGroups.onDidChangeTabs(updatePr),
    vscode.window.tabGroups.onDidChangeTabs(() => syncSelection()),
    treeView.onDidChangeVisibility(() => syncSelection(true)),
    vscode.window.tabGroups.onDidChangeTabGroups(updatePr),
    treeView.onDidChangeVisibility(updatePr),
    vscode.window.onDidChangeWindowState(onWindowFocus),
    vscode.commands.registerCommand('ghco.openFile', (item) =>
      openPrFile(tracker, item.prFile.prNumber, item.prFile.filePath)
    ),
    vscode.commands.registerCommand('ghco.refresh', () => {
      pinnedNumber = null;
      tracker.refresh();
      updatePr();
    }),
    // From the PR overview's context menu: the webview passes its
    // data-vscode-context, which includes the PR number
    vscode.commands.registerCommand('ghco.showForPullRequest', async (ctx) => {
      pinnedNumber = Number(ctx?.number) || null;
      await updatePr();
      if (pinnedNumber) ownersView.setPrNumber(pinnedNumber);
      await vscode.commands.executeCommand('ghco.codeOwners.focus');
    }),
    {dispose: () => clearInterval(timer)}
  );

  const connect = (prApi) => {
    tracker.prApi = prApi;
    updatePr();
  };
  prApiPromise
    .then((prApi) => {
      if (prApi) return connect(prApi);
      log(`${PR_EXTENSION_ID} is not installed`);
      offerPrExtension(context);
      // Connect as soon as it is installed; no reload needed
      const watch = vscode.extensions.onDidChange(async () => {
        const later = await getPrApi().catch(() => null);
        if (!later) return;
        watch.dispose();
        connect(later);
      });
      context.subscriptions.push(watch);
    })
    .catch((e) => log(`${PR_EXTENSION_ID} failed to start:`, e.message));
};

// Without the PR extension we have nothing to show: no panel for our view,
// no PR to follow and no file lists to decorate. Say so once, unless the
// user asked not to be told again. VSCode reports a disabled extension as
// missing too, so open its page, which offers Install or Enable as fits.
const DONT_OFFER_KEY = 'ghco.dontOfferPrExtension';
const offerPrExtension = async (context) => {
  if (context.globalState.get(DONT_OFFER_KEY)) return;
  const show = 'Install or Enable';
  const never = "Don't Show Again";
  const choice = await vscode.window.showInformationMessage(
    'GitHub Code Owners works with the GitHub Pull Requests extension, which is not installed or is disabled.',
    show,
    never
  );
  if (choice === show) {
    await vscode.commands.executeCommand('extension.open', PR_EXTENSION_ID);
  } else if (choice === never) {
    await context.globalState.update(DONT_OFFER_KEY, true);
  }
};

export const deactivate = () => {};
