import {debounce} from 'lodash-es';

import {updatePrFilesPage} from './files-page';
import {updateMergeBox} from './conversation-page';

import './decorator.css';

let incrementUpdateCount = () => {};
let initDebugPanel = () => {};

// Only import debug panel in development builds
if (__DEBUG__) {
  const debugPanel = await import('./debug-panel');
  incrementUpdateCount = debugPanel.incrementUpdateCount;
  initDebugPanel = debugPanel.initDebugPanel;
}

const updateAll = async () => {
  incrementUpdateCount();
  await Promise.all([updatePrFilesPage(), updateMergeBox()]);
};

// Filter out mutations from debug panel to prevent infinite loop
const mutationCallback = (mutations) => {
  // Ignore mutations inside the debug panel
  const hasRelevantMutation = mutations.some(mutation => {
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
    updateAll();
  }
};

// Potentially refresh after every mutation, with debounce
const observer = new MutationObserver(debounce(mutationCallback, 100));
observer.observe(document.body, {childList: true, subtree: true});

// Delete the disused access token that may still be in storage from the previous version
chrome.storage.local.remove('token');

// Initialize debug panel if ?ghco-debug is in URL
initDebugPanel(updateAll);
