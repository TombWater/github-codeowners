import {getPrOwnershipData} from './ownership';
import {
  createOwnerLabels,
  clearHighlightedOwner,
  setProgrammaticExpansion,
} from './labels';
import * as github from './github';

import fileLabelsCss from './file-labels.css';
import {injectStyles} from './inject-styles';

// Inject CSS into page head for DevTools inspection
injectStyles(fileLabelsCss, 'ghco-file-labels-styles');

const fileHeaderSelectors = [
  // Old Files Changed page
  'div.file-header',
  // New Files Changed page
  'div[class^="Diff-module__diffHeaderWrapper"]',
].join(', ');

const getFileHeaderLink = (node) =>
  node?.dataset.anchor ||
  node.querySelector('[class*="DiffFileHeader-module"] a[href*="#diff-"]')
    ?.href;

const getFileHeadersForDecoration = () => {
  const fileHeaders = Array.from(
    document.querySelectorAll(fileHeaderSelectors)
  );

  // Only return headers that don't already have our decoration AND have the data we need
  const newHeaders = fileHeaders.filter((node) => {
    // Skip if already decorated
    if (node.parentNode?.querySelector('.ghco-decoration')) {
      return false;
    }
    return !!getFileHeaderLink(node);
  });

  return newHeaders;
};

const findExpandButton = (header) => {
  // 1. Try generic button with aria-expanded
  let button = header.querySelector('button[aria-expanded]');

  // 2. In new UI, the expander is a chevron without aria-expanded,
  //    and the button WITH aria-expanded is often the Comment button (octicon-comment) or Menu.
  //    If we found a button but it's the comment button, ignore it.
  if (button?.querySelector('.octicon-comment')) {
    button = null;
  }

  // 3. If no valid button yet, look for the chevron specifically
  if (!button) {
    button = header
      .querySelector(
        'button .octicon-chevron-down, button .octicon-chevron-right'
      )
      ?.closest('button');
  }
  return button;
};

const toggleFileHeader = (header, expandOwner) => {
  // The decoration is the next sibling
  const decoration = header.nextElementSibling;
  if (!decoration || !decoration.classList.contains('ghco-decoration')) {
    return;
  }

  const labels = decoration.querySelectorAll('.ghco-label');
  const isViewed =
    // New UI: button with MarkAsViewedButton-module class and aria-pressed="true"
    header
      .querySelector('button[class*="MarkAsViewedButton-module"]')
      ?.getAttribute('aria-pressed') === 'true' ||
    // Old UI: checkbox with js-reviewed-checkbox class and checked attribute
    header.querySelector('input.js-reviewed-checkbox')?.checked === true;

  const expandFile = expandOwner
    ? Array.from(labels).some((label) => label.dataset.owner === expandOwner)
    : !isViewed;

  const button = findExpandButton(header);
  if (!button) return;

  // Determine current state
  let isExpanded = false;
  if (button.hasAttribute('aria-expanded')) {
    isExpanded = button.getAttribute('aria-expanded') === 'true';
  } else {
    // In new UI without aria-expanded, chevron-down means expanded
    isExpanded = Boolean(button.querySelector('.octicon-chevron-down'));
  }

  if (expandFile !== isExpanded) {
    button.click();
  }
};

const onOwnerClick = (clickedOwner, event) => {
  setProgrammaticExpansion(true);

  // Capture the header that was clicked to maintain its scroll position
  const clickedLabel = event?.target;
  const clickedHeader =
    clickedLabel?.closest('.ghco-decoration')?.previousElementSibling;
  const targetY = clickedHeader?.getBoundingClientRect().top;

  const fileHeaders = document.querySelectorAll(fileHeaderSelectors);

  fileHeaders.forEach((header) => {
    toggleFileHeader(header, clickedOwner);
  });

  // If no scroll restoration needed, finish immediately
  if (!clickedHeader || targetY === undefined) {
    setProgrammaticExpansion(false);
    return;
  }

  // Continuously restore scroll position until layout stabilizes
  let framesRemaining = 20; // Monitor for up to ~300ms (20 * 16ms per frame)

  const restoreScroll = () => {
    const currentY = clickedHeader.getBoundingClientRect().top;
    const deltaY = currentY - targetY;

    if (Math.abs(deltaY) > 0.5) {
      window.scrollBy({top: deltaY, behavior: 'instant'});
    }

    if (--framesRemaining > 0) {
      requestAnimationFrame(restoreScroll);
    } else {
      setProgrammaticExpansion(false);
    }
  };

  requestAnimationFrame(restoreScroll);
};

// Mutation observer to detect file expansion changes
const expansionObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    // Check for aria-expanded attribute change (Old UI)
    if (
      mutation.type === 'attributes' &&
      mutation.attributeName === 'aria-expanded' &&
      mutation.target.closest('.file-header')
    ) {
      clearHighlightedOwner();
      return;
    }

    // Check for chevron icon change (New UI)
    // The mutation target is likely the button or a wrapper, and children (svg) changed
    if (mutation.type === 'childList' || mutation.type === 'attributes') {
      const target = mutation.target;
      // If we see a chevron change in a header wrapper
      const chevronClasses = '.octicon-chevron-down, .octicon-chevron-right';
      const chevron =
        target.matches?.(chevronClasses) ||
        target.querySelector?.(chevronClasses);
      const header = target.closest(fileHeaderSelectors);
      if (chevron && header) {
        clearHighlightedOwner();
        return;
      }
    }
  }
});

let observedContainers = [];

const attachExpansionObserver = () => {
  const containerSelectors = [
    'div[data-testid="progressive-diffs-list"]', // New UI
    'div.js-diff-container', // Old UI
  ].join(', ');
  // Convert NodeList to Array for comparison and consistent storage
  const containers = Array.from(document.querySelectorAll(containerSelectors));

  // Check if containers have changed (shallow equality check of DOM nodes)
  // This prevents observer thrashing (disconnect/reconnect) on unrelated mutations
  const hasChanged =
    containers.length !== observedContainers.length ||
    containers.some((container, i) => container !== observedContainers[i]);

  if (!hasChanged) {
    return;
  }

  // Always disconnect first to avoid duplicate observations and memory leaks
  expansionObserver.disconnect();
  observedContainers = containers;

  containers.forEach((container) => {
    expansionObserver.observe(container, {
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-expanded', 'class'],
      childList: true,
    });
  });
};

// If we are on a PR files page, update reviewer decorations on the files
export const updatePrFilesPage = async () => {
  // Ensure expansion observer is watching current containers.
  // Run this before early returns to ensure we disconnect from old containers
  // if the user navigates away (e.g. to conversation tab), avoiding memory leaks.
  attachExpansionObserver();

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

  fileHeaders.forEach((node) =>
    decorateFileHeader(node, {
      folderOwners,
      ownershipData,
      diffFilesMap,
      onOwnerClick,
    })
  );
};

const decorateFileHeader = (
  node,
  {folderOwners, ownershipData, diffFilesMap, onOwnerClick}
) => {
  // Try to get path directly from data-path attribute first (old UI, always present)
  let path = node?.dataset.path;
  // If not found, try to look up by digest in the map (new UI)
  if (!path) {
    const link = getFileHeaderLink(node);
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
    onOwnerClick,
  });

  labels.forEach((label) => decoration.appendChild(label));
  node.parentNode.insertBefore(decoration, node.nextSibling);
};
