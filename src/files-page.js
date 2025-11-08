import {getPrOwnershipData} from './ownership';
import {createOwnerLabels, clearHighlightedOwner} from './labels';
import * as github from './github';

import fileLabelsCss from './file-labels.css';
import {injectStyles} from './inject-styles';

// Inject CSS into page head for DevTools inspection
injectStyles(fileLabelsCss, 'ghco-file-labels-styles');

const getFileHeadersForDecoration = () => {
  const selectors = [
    // Old Files Changed page
    'div.file-header',
    // New Files Changed page
    'div[class^="Diff-module__diffHeaderWrapper"]',
  ];
  const fileHeaders = document.querySelectorAll(selectors.join(', '));

  // Only return headers that don't already have our decoration AND have the data we need
  const newHeaders = Array.from(fileHeaders).filter((node) => {
    // Skip if already decorated
    if (node.parentNode?.querySelector('.ghco-decoration')) {
      return false;
    }

    // Skip sticky headers and other headers without path data
    // Old UI: needs data-anchor attribute
    // New UI: needs DiffFileHeader-module__file-name link
    const hasOldUiData = node.dataset.anchor;
    const hasNewUiData = node.querySelector(
      '[class^="DiffFileHeader-module__file-name"] a'
    );

    return hasOldUiData || hasNewUiData;
  });

  return newHeaders;
};

// If we are on a PR files page, update reviewer decorations on the files
export const updatePrFilesPage = async () => {
  const fileHeaders = getFileHeadersForDecoration();

  // Don't do anything when not on a PR files page, or the files haven't changed
  if (fileHeaders.length === 0) {
    return;
  }

  const ownershipData = await getPrOwnershipData();
  if (!ownershipData) {
    return;
  }

  const {folderOwners} = ownershipData;

  // Get diff files map (needed for new UI, old UI uses data-path directly)
  const diffFilesMap = (await github.getDiffFilesMap()) || new Map();

  // Clear highlighted owner
  clearHighlightedOwner();

  fileHeaders.forEach((node) =>
    decorateFileHeader(node, {
      folderOwners,
      ownershipData,
      diffFilesMap,
    })
  );
};

const decorateFileHeader = (
  node,
  {folderOwners, ownershipData, diffFilesMap}
) => {
  // Try to get path directly from data-path attribute first (old UI, always present)
  let path = node?.dataset.path;

  // If not found, try to look up by digest in the map (new UI)
  if (!path) {
    const link =
      node?.dataset.anchor ||
      node.querySelector('[class^="DiffFileHeader-module__file-name"] a')?.href;
    const digest = link?.split('diff-')[1];
    path = diffFilesMap.get(digest);
  }

  if (!path) {
    // File header exists but path not available yet (lazy loading or placeholder)
    return;
  }
  const {owners} =
    folderOwners.find(({folderMatch}) =>
      // ignores() means it matches, as it's meant to match in .gitignore files
      folderMatch.ignores(path)
    ) || {};

  // Remove any previous owners decoration
  node.parentNode.querySelectorAll('.ghco-decoration').forEach((decoration) => {
    decoration.remove();
  });

  if (!owners) {
    return;
  }

  // Create the new owners decoration containing labels for each owner
  const decoration = document.createElement('div');
  decoration.classList.add('ghco-decoration', 'js-skip-tagsearch');

  const labels = createOwnerLabels({
    owners,
    ownershipData,
  });

  labels.forEach((label) => decoration.appendChild(label));
  node.parentNode.insertBefore(decoration, node.nextSibling);
};
