import {debounce} from './utils';
import {updatePrFilesPage} from './files-page';
import {updateMergeBox} from './merge-box';
import {updateCommentDecorations} from './comment-decorator';
import * as debugPanel from './debug-panel';

let incrementUpdateCount = () => {};
let initDebugPanel = () => {};

// Which build this page runs, for the smoke test (test/smoke.js) to tell a
// stale extension from a fresh one. On <html>, which navigation never
// replaces.
document.documentElement.dataset.ghcoBuild = __BUILD_TIME__;

// Only use debug panel in development builds
if (__DEBUG__) {
  incrementUpdateCount = debugPanel.incrementUpdateCount;
  initDebugPanel = debugPanel.initDebugPanel;
}

const updateAll = async () => {
  incrementUpdateCount();
  await Promise.all([
    updatePrFilesPage(),
    updateMergeBox(),
    updateCommentDecorations(),
  ]);
};

const debouncedUpdateAll = debounce(updateAll, 100);

// Filter out mutations from debug panel to prevent infinite loop. Filter every
// batch before debouncing: a debounce passes on only the last batch, so the
// panel's ticker could hide a page change that came just before it.
const mutationCallback = (mutations) => {
  // Ignore mutations inside the debug panel
  const hasRelevantMutation = mutations.some((mutation) => {
    // Check if mutation is inside debug panel
    let node = mutation.target;
    while (node) {
      if (node.id === 'ghco-debug-panel') {
        return false; // Ignore this mutation
      }
      node = node.parentElement;
    }
    return true; // This is a relevant mutation
  });

  if (hasRelevantMutation) {
    debouncedUpdateAll();
  }
};

// Potentially refresh after every mutation, with debounce
const observer = new MutationObserver(mutationCallback);
// Observe documentElement (not body) so the observer survives Turbo Drive
// navigation, which replaces document.body entirely on page transitions.
observer.observe(document.documentElement, {childList: true, subtree: true});
// The script runs at document_idle, when the page may already be quiet
debouncedUpdateAll();

// Delete the disused access token that may still be in storage from the previous version
try {
  chrome.storage.local.remove('token');
} catch (e) {
  // Extension context invalidated - silently ignore
}

// Initialize debug panel if ?ghco-debug is in URL
initDebugPanel(updateAll);
