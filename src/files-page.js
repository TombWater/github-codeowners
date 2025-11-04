import {getPrOwnershipData} from './ownership';
import {createOwnerLabels, clearHighlightedOwner} from './labels';
import * as github from './github';

import './file-labels.css';

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
  const prInfo = github.getPrInfo();
  console.log('[GHCO] Decorate PR', prInfo);

  const ownershipData = await getPrOwnershipData();
  if (!ownershipData) {
    return;
  }

  const {folderOwners} = ownershipData;

  const diffFilesMap = await github.getDiffFilesMap();
  if (!diffFilesMap || diffFilesMap.size === 0) {
    console.warn('[GHCO] No diff files found, cannot decorate file headers');
    return;
  }

  // Clear highlighted owner
  clearHighlightedOwner();

  console.log(`[GHCO] Decorating ${fileHeaders.length} file headers`);

  // Batch collect decorations to trigger animations together
  const decorationsToAnimate = [];

  fileHeaders.forEach((node) => {
    const decoration = decorateFileHeader(node, {
      folderOwners,
      ownershipData,
      diffFilesMap,
    });
    if (decoration) {
      decorationsToAnimate.push(decoration);
    }
  });

  // Trigger all animations together after DOM insertion
  // Double RAF: First RAF waits for DOM insertion, second RAF ensures layout
  // stabilizes before animation starts (required for CSS transitions to trigger)
  if (decorationsToAnimate.length > 0) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        decorationsToAnimate.forEach((decoration) => {
          decoration.classList.remove('ghco-decoration-hidden');
        });
      });
    });
  }
};

const decorateFileHeader = (
  node,
  {folderOwners, ownershipData, diffFilesMap}
) => {
  const link =
    node?.dataset.anchor ||
    node.querySelector('[class^="DiffFileHeader-module__file-name"] a')?.href;
  const digest = link?.split('diff-')[1];
  const path = diffFilesMap.get(digest);
  if (!path) {
    console.log('[GHCO] No path found for file header', node);
    return;
  }
  const {owners} =
    folderOwners.find(({folderMatch}) =>
      // ignores() means it matches, as it's meant to match in .gitignore files
      folderMatch.ignores(path)
    ) || {};
  console.log('[GHCO] File:', path, owners, node);

  // Remove any previous owners decoration
  node.parentNode.querySelectorAll('.ghco-decoration').forEach((decoration) => {
    decoration.remove();
  });

  if (!owners) {
    return;
  }

  // Create the new owners decoration containing labels for each owner
  const decoration = document.createElement('div');
  decoration.classList.add(
    'ghco-decoration',
    'ghco-decoration-hidden',
    'js-skip-tagsearch'
  );

  const labels = createOwnerLabels({
    owners,
    ownershipData,
  });

  labels.forEach((label) => decoration.appendChild(label));
  node.parentNode.insertBefore(decoration, node.nextSibling);

  return decoration;
};
