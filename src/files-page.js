import {getPrOwnershipData} from './ownership';
import {createOwnerLabels, clearHighlightedOwner} from './labels';
import * as github from './github';

let headersCache = new WeakSet();

const getFileHeadersForDecoration = () => {
  const selectors = [
    // Old Files Changed page
    'div.file-header',
    // New Files Changed page
    'div[class^="Diff-module__diffHeaderWrapper"]',
  ];
  const fileHeaders = document.querySelectorAll(selectors.join(', '));
  const newHeaders = Array.from(fileHeaders).filter(
    (node) => !headersCache.has(node)
  );
  headersCache = new WeakSet(fileHeaders);
  return newHeaders;
};

// If we are on a PR files page, update reviewer decorations on the files
export const updatePrFilesPage = async () => {
  const fileHeaders = getFileHeadersForDecoration();

  // Don't do anything when not on a PR files page, or the files haven't changed
  if (fileHeaders.length === 0) {
    return;
  }
  console.log('[GHCO] Decorate PR', github.getPrInfo());

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
  decoration.classList.add('ghco-decoration', 'js-skip-tagsearch');

  const labels = createOwnerLabels({
    owners,
    ownershipData,
  });

  labels.forEach((label) => decoration.appendChild(label));
  node.parentNode.insertBefore(decoration, node.nextSibling);
};
