import {debounce} from './utils';
import * as github from './github';
import iconSvg from '../public/icons/icon.svg';
import chevronUpSvg from './chevron-up.svg';
import xIconSvg from './x-icon.svg';
import lockSvg from './lock.svg';
import unlockSvg from './unlock.svg';
import {getPrOwnershipData} from './ownership';
import {
  approversOf,
  calculateApprovalStatus,
  describeApprovalStatus,
  sortOwnerGroups,
} from '../core/approval';
import {
  createOwnerLabels,
  clearHighlightedOwner,
  setProgrammaticExpansion,
} from './labels';

import mergeBoxCss from './merge-box.css';
import {injectStyles} from './inject-styles';

// Inject CSS into page head for DevTools inspection
injectStyles(mergeBoxCss, 'ghco-merge-box-styles');

const parser = new DOMParser();
const xmlDeclRegex = /<\?xml[^?]*\?>\s*/g;
const iconSvgDoc = parser.parseFromString(
  iconSvg.replace(xmlDeclRegex, ''),
  'image/svg+xml'
);
const chevronSvgDoc = parser.parseFromString(
  chevronUpSvg.replace(xmlDeclRegex, ''),
  'image/svg+xml'
);
const lockSvgDoc = parser.parseFromString(
  lockSvg.replace(xmlDeclRegex, ''),
  'image/svg+xml'
);
const unlockSvgDoc = parser.parseFromString(
  unlockSvg.replace(xmlDeclRegex, ''),
  'image/svg+xml'
);

const DISMISSED_VERSION_KEY = 'ghco-dismissedNewVersionBanner';

const ignoreException = (fn) => {
  try {
    return fn();
  } catch (e) {
    // Extension context invalidated - silently ignore
  }
};

const safeExtensionVersion = () =>
  ignoreException(() => chrome.runtime.getManifest().version);
const safeStorageGet = (keys, callback) =>
  ignoreException(() => chrome.storage.local.get(keys, callback));
const safeStorageSet = (items) =>
  ignoreException(() => chrome.storage.local.set(items));

const checkAndShowNewVersionBanner = (section) => {
  const BANNER_CLASS = 'ghco-new-version-banner';
  // Once per section: the storage read is async, and updates that arrive
  // before it answers would each add a banner
  if (section.dataset.bannerChecked) return;
  section.dataset.bannerChecked = 'true';

  const currentVersion = safeExtensionVersion();
  if (!currentVersion) return;

  safeStorageGet([DISMISSED_VERSION_KEY], (result) => {
    // Stop if storage read failed or if the user navigated away (prevents memory leaks)
    if (chrome.runtime.lastError || !section.isConnected) return;

    const dismissedVersion = result?.[DISMISSED_VERSION_KEY];
    if (dismissedVersion === currentVersion) return;

    const bannerHtml = `
      <div class="${BANNER_CLASS}">
        <div class="ghco-new-version-banner-content">
          <span>
            <strong>Updated!</strong> GitHub Codeowners ${currentVersion} is here.
          </span>
          <a href="https://github.com/TombWater/github-codeowners/blob/main/CHANGELOG.md"
             target="_blank">See what's new</a>
        </div>
        <button class="ghco-dismiss-button" aria-label="Dismiss" data-version="${currentVersion}">
          ${xIconSvg.replace(xmlDeclRegex, '')}
        </button>
      </div>
    `;
    const banner = parser.parseFromString(bannerHtml, 'text/html').body
      .firstElementChild;

    // Insert after the header so it's visible even when collapsed
    section.querySelector('.ghco-section-header')?.after(banner);
  });
};

export const updateMergeBox = async () => {
  // Clears what an open overlay leaves on the page (<html> class, box mark)
  // once its section is gone, e.g. after navigating to the files page, where
  // that class would still restack GitHub's own overlays
  updateOverviewOpen();

  const container =
    github.findOverviewContainer() ?? github.findMergeBoxContainer();

  // Nothing to anchor to yet — the merge box is still a bare spinner
  if (!container) {
    return;
  }

  // Create the section, and on the Overview page its cell, before anything is
  // awaited: they show while the data loads, and overlapping updates that
  // awaited between looking for the section and creating it would each
  // create one
  let section = container.querySelector('section[aria-label="Code owners"]');
  if (!section) {
    section = createLoadingMergeBoxSection(container);
    if (!section) {
      return;
    }
  } else {
    // Check if section is in the correct position (merge box structure may have changed)
    ensureCorrectPosition(section, container);
  }

  checkAndShowNewVersionBanner(section);
  syncOverviewCell(section);

  // Fetched on the Overview page
  const reviewStatus = await github.getReviewStatus();
  const approvers = approversOf(await github.getReviewers());
  if (!section.isConnected) {
    return;
  }

  // Calculate current state (synchronous checks only)
  const isMerged = github.getIsMerged();

  // Count timeline items to detect commits, review requests, etc.
  const timelineItems = document.querySelectorAll('.TimelineItem');
  const timelineCount = timelineItems.length;

  const isClosed = github.getIsClosed();

  const stateParts = [
    isMerged,
    isClosed,
    reviewStatus.ownerApprovalRequired,
    reviewStatus.reviewsBlocking,
    timelineCount,
    ...approvers,
  ];
  if (__DEBUG__) {
    const simulated = window.__ghcoDebugPanel?.getSimulatedApprovals?.();
    if (simulated?.size) {
      stateParts.push(...Array.from(simulated.entries()).flat());
    }
  }
  const newState = stateParts.join(',');
  const oldState = section?.dataset.state || '';

  // Check if merge status changed (requires recreating for correct positioning)
  const oldMergeStatus = oldState.split(',')[0];
  const newMergeStatus = newState.split(',')[0];

  if (oldState && oldMergeStatus !== newMergeStatus) {
    saveExpandState(false);
  }

  // Update state early
  section.dataset.state = newState;

  // If state hasn't changed and section has content, we're done (fast path!)
  const hasContent = section.querySelector(
    '.ghco-merge-box-expandable-wrapper'
  );
  if (oldState === newState && hasContent) {
    return;
  }

  // Fetch ownership data and update section content
  const ownershipData = await getPrOwnershipData();
  const {diffFilesMap, ownerGroupsMap} = ownershipData || {};
  if (!ownershipData || !diffFilesMap || diffFilesMap.size === 0) {
    const existingHeader = section.querySelector('.ghco-section-header');
    if (existingHeader) {
      const newHeader = createMergeBoxSectionHeader(null);
      const description = newHeader.querySelector('p');
      if (description) {
        description.textContent = ownershipData
          ? 'No files to review'
          : 'No CODEOWNERS file found';
      }
      section.replaceChild(newHeader, existingHeader);
    }
    section.ghcoApprovalStatus = null;
    syncOverviewCell(section);
    return;
  }

  const approvalStatus = calculateApprovalStatus(ownershipData, {
    approvers,
    reviewStatus,
    isMerged,
    isClosed,
  });
  updateMergeBoxSectionWithContent(
    section,
    approvalStatus,
    ownerGroupsMap,
    ownershipData
  );
  section.ghcoApprovalStatus = approvalStatus;
  syncOverviewCell(section);
};

const OVERHANG_LINE = 'ghco-overview-overhang';
const removeOverhangLines = () =>
  document.querySelectorAll(`.${OVERHANG_LINE}`).forEach((el) => el.remove());

// Position section correctly in the merge box and set border classes
const ensureCorrectPosition = (section, container) => {
  // Overview page, open PR: our cell goes in GitHub's summary grid, and this
  // section, without its header, is the overlay the cell opens below itself.
  // Outside the grid's bordered box, which would clip it.
  const borderedBox = github.findOverviewMergeStatusBox();
  if (borderedBox) {
    if (borderedBox.nextElementSibling !== section) {
      borderedBox.after(section);
    }
    section.classList.add('ghco-overview-panel');
    section.classList.remove('ghco-overview-card');
    // The overlay's line where it hangs under other cells, right after it
    if (!section.nextElementSibling?.classList.contains(OVERHANG_LINE)) {
      removeOverhangLines();
      const line = document.createElement('div');
      line.classList.add(OVERHANG_LINE);
      section.after(line);
    }
    return;
  }
  removeOverhangLines();

  // Overview page, merged or closed PR: no summary grid, so a card of our own
  const overviewAnchor = github.findOverviewAnchor();
  if (overviewAnchor) {
    if (overviewAnchor.previousElementSibling !== section) {
      overviewAnchor.before(section);
    }
    section.classList.add('ghco-overview-card');
    section.classList.remove('ghco-overview-panel');
    return;
  }

  // Preferred anchor: insert after Reviews section or merged PR success message
  const previousSection = container.querySelector(
    [
      'section[aria-label="Reviews"]',
      // The "merged" message: a section header with no <section> around it
      github.moduleClassSelector('wrapper', ':scope > div'),
    ].join(', ')
  );

  if (previousSection) {
    if (previousSection.nextElementSibling !== section) {
      previousSection.after(section);
    }
  } else {
    // No Reviews section: insert before Checks section if present
    const checksSection = container.querySelector(
      'section[aria-label="Checks"]'
    );
    if (checksSection) {
      if (checksSection.previousElementSibling !== section) {
        checksSection.before(section);
      }
    } else {
      // No Checks section either: append at the end
      if (container.lastElementChild !== section) {
        container.appendChild(section);
      }
    }
  }

  const hasNextSibling = Boolean(section.nextElementSibling);

  section.classList.toggle('border-bottom', hasNextSibling);
  section.classList.add('color-border-subtle');
};

const OVERVIEW_CELL = 'ghco-mini-status';

// The cell's short summary; the section's full line becomes its tooltip.
// None while loading or without CODEOWNERS or files, as on GitHub's own cells
// with nothing to show.
const describeOverviewCell = (approvalStatus) => {
  if (!approvalStatus) return '';
  const {
    groupApprovalsReceived: received,
    groupApprovalsRequired: required,
    ownerApprovalRequired,
    allApprovalsReceived,
  } = approvalStatus;
  // Same wording as GitHub's Approvals cell beside it
  if (ownerApprovalRequired && !allApprovalsReceived && received < required) {
    return `${required - received} still required`;
  }
  return `${received} of ${required} approved`;
};

// Approved owner groups, then the rest: waiting (yellow) while owner approval
// holds the merge, otherwise just not approved (gray)
const createOverviewCellBar = (approvalStatus) => {
  const bar = document.createElement('div');
  bar.classList.add('ghco-mini-status-bar');
  // Hatched, like GitHub's Comments cell with no comments: while loading,
  // and for good without CODEOWNERS or files
  if (!approvalStatus) {
    bar.classList.add('ghco-mini-status-bar--unavailable');
    return bar;
  }

  const {groupApprovalsReceived, groupApprovalsRequired} = approvalStatus;
  const waiting =
    approvalStatus.ownerApprovalRequired &&
    !approvalStatus.allApprovalsReceived;
  [
    [groupApprovalsReceived, 'success'],
    [
      groupApprovalsRequired - groupApprovalsReceived,
      waiting ? 'attention' : 'neutral',
    ],
  ]
    .filter(([count]) => count > 0)
    .forEach(([count, tone]) => {
      const segment = document.createElement('span');
      segment.classList.add('ghco-segment', `ghco-segment--${tone}`);
      segment.style.flexGrow = count;
      bar.appendChild(segment);
    });
  return bar;
};

const createOverviewCell = (mergeStatus, section) => {
  const status = section.ghcoApprovalStatus;
  const description =
    section.querySelector(`#${APPROVALS_DESCRIPTION_ID}`)?.textContent ?? '';
  const headerButton = section.querySelector('.ghco-header-button');

  const cell = document.createElement('section');
  cell.setAttribute('aria-label', 'Code owners approvals');
  cell.title = description;
  // GitHub's cell classes, read from its own cells, for padding and borders
  const githubCell = mergeStatus.querySelector(
    `:scope > section:not(.${OVERVIEW_CELL})`
  );
  const githubInteractiveCell = mergeStatus.querySelector(
    github.moduleClassSelector('MiniStatusInteractive', ':scope > section')
  );
  cell.classList.add(
    OVERVIEW_CELL,
    ...[
      github.findModuleClass(githubCell, 'MiniStatus'),
      github.findModuleClass(githubCell, 'MiniStatusRefresh'),
      headerButton &&
        github.findModuleClass(githubInteractiveCell, 'MiniStatusInteractive'),
    ].filter(Boolean)
  );

  // Locks the overlay open, by clicking the section's hidden header
  const isLocked = headerButton?.getAttribute('aria-expanded') === 'true';
  if (headerButton) {
    const isExpanded = isLocked;
    const button = document.createElement('button');
    button.type = 'button';
    button.classList.add('ghco-mini-status-button');
    button.setAttribute('aria-expanded', isExpanded.toString());
    button.setAttribute(
      'aria-label',
      `${isExpanded ? 'Collapse' : 'Expand'} code owners`
    );
    cell.appendChild(button);
  }

  const label = document.createElement('div');
  label.classList.add('ghco-mini-status-label');
  const title = document.createElement('strong');
  title.textContent = 'Code owners';
  const summary = document.createElement('span');
  summary.classList.add('ghco-mini-status-summary');
  summary.textContent = describeOverviewCell(status);
  label.append(title, summary);
  // GitHub's lock icons: unlocked shows on hover, locked shows always
  if (headerButton) {
    const lock = (isLocked ? lockSvgDoc : unlockSvgDoc).documentElement;
    const icon = lock.cloneNode(true);
    icon.classList.add('ghco-mini-status-lock');
    icon.classList.toggle('ghco-locked', isLocked);
    label.appendChild(icon);
  }
  cell.appendChild(label);
  cell.appendChild(createOverviewCellBar(status));
  return cell;
};

// A column per cell in the grid's wide layout, ours included, so a cell
// GitHub adds doesn't push ours onto a row of its own
const updateOverviewCellCount = (mergeStatus) => {
  const count = String(mergeStatus.querySelectorAll(':scope > section').length);
  if (mergeStatus.style.getPropertyValue('--ghco-cells') !== count) {
    mergeStatus.style.setProperty('--ghco-cells', count);
  }
};

// Keep our cell in GitHub's summary grid in step with the section. React
// re-renders the grid, so this also puts the cell back when it's dropped.
const syncOverviewCell = (section) => {
  const mergeStatus = github.findOverviewMergeStatus();
  const cells = document.querySelectorAll(`.${OVERVIEW_CELL}`);
  if (!mergeStatus || !section.isConnected) {
    cells.forEach((cell) => cell.remove());
    return;
  }

  const cell = createOverviewCell(mergeStatus, section);
  const signature = cell.innerHTML + cell.title;
  const current = cells.length === 1 ? cells[0] : null;
  if (
    current?.parentElement === mergeStatus &&
    current.dataset.signature === signature
  ) {
    // Back to the end if React put one of its cells after ours
    if (mergeStatus.lastElementChild !== current) {
      mergeStatus.appendChild(current);
    }
    updateOverviewCellCount(mergeStatus);
    return;
  }
  cells.forEach((old) => old.remove());
  cell.dataset.signature = signature;
  mergeStatus.appendChild(cell);
  updateOverviewCellCount(mergeStatus);
  updateOverviewOpen();
};

// Like GitHub's cells beside it, ours opens its overlay while hovered, and a
// click pins it open (the section's expand state) until clicked again
let overviewHovered = false;
let overviewHoverTimer;

const updateOverviewOpen = () => {
  const section = document.querySelector('section.ghco-overview-panel');
  if (!section) {
    overviewHovered = false;
  }
  const cell = document.querySelector(`.${OVERVIEW_CELL}`);
  const pinned =
    section
      ?.querySelector('.ghco-header-button')
      ?.getAttribute('aria-expanded') === 'true';
  // Nothing to open while loading or without CODEOWNERS: the hatched cell
  // ignores hover, as GitHub's Comments cell does with no comments
  const hasContent = Boolean(cell?.querySelector('.ghco-mini-status-button'));
  const isOpen = Boolean(section && hasContent && (pinned || overviewHovered));
  section?.classList.toggle('ghco-open', isOpen);
  cell?.classList.toggle('ghco-open', isOpen);
  // For the z-order between GitHub's overlays, which live outside the page
  document.documentElement.classList.toggle('ghco-overview-open', isOpen);
  // The grid's box squares the corners the overlay meets: the right one, and
  // stacked into one column (GitHub's container query), where the overlay
  // spans the box, both. CSS can't tell the box which layout its grid has.
  const mergeStatus = cell?.parentElement;
  const isStacked =
    mergeStatus &&
    getComputedStyle(mergeStatus).gridTemplateColumns.trim().split(/\s+/)
      .length === 1;
  const box = isOpen ? github.findOverviewMergeStatusBox() : null;
  document.querySelectorAll('[data-ghco-open]').forEach((el) => {
    if (el !== box) delete el.dataset.ghcoOpen;
  });
  if (box) box.dataset.ghcoOpen = isStacked ? 'stacked' : 'open';
};

window.addEventListener('resize', debounce(updateOverviewOpen, 100));

// Close only after a moment, so the pointer can cross from the cell into the
// overlay without it closing on the way
document.addEventListener('pointerover', (event) => {
  const hovered = Boolean(
    event.target.closest?.(`.${OVERVIEW_CELL}, .ghco-overview-panel`)
  );
  clearTimeout(overviewHoverTimer);
  if (hovered === overviewHovered) return;
  overviewHoverTimer = setTimeout(
    () => {
      overviewHovered = hovered;
      updateOverviewOpen();
    },
    hovered ? 0 : 150
  );
});

const createHeaderIcon = (approvalStatus) => {
  const iconWrapper = document.createElement('div');
  iconWrapper.classList.add('mr-2', 'flex-shrink-0');

  const iconCircle = document.createElement('div');
  iconCircle.style.borderWidth = '0px';
  iconCircle.style.borderRadius = '50%';
  iconCircle.style.borderStyle = 'solid';
  iconCircle.style.borderColor = 'var(--borderColor-default)';
  iconCircle.style.width = '32px';
  iconCircle.style.height = '32px';

  const iconInner = document.createElement('div');
  iconInner.style.display = 'flex';
  iconInner.style.width = '32px';
  iconInner.style.height = '32px';
  iconInner.style.alignItems = 'center';
  iconInner.style.justifyContent = 'center';

  const GREEN = 'var(--bgColor-success-emphasis)';
  const RED = 'var(--bgColor-danger-emphasis)';
  const GRAY = 'var(--bgColor-draft-emphasis)';
  const PURPLE = 'var(--bgColor-done-emphasis)';

  let iconColor;

  if (!approvalStatus) {
    // Loading — leave iconColor unset so SVG renders its native orange fills
  } else if (approvalStatus.isMerged) {
    iconColor = PURPLE;
  } else if (approvalStatus.isClosed) {
    // Closed without merging — nothing is required, so nothing is outstanding
    iconColor = GRAY;
  } else if (approvalStatus.allApprovalsReceived) {
    // GitHub's Reviews section shows success — all required approvals satisfied
    iconColor = GREEN;
  } else if (approvalStatus.approvalNotRequired) {
    // Nothing is blocking merge, but nobody has approved — informational, not success
    iconColor = GRAY;
  } else if (approvalStatus.ownerApprovalRequired) {
    iconColor = RED;
  } else {
    iconColor = GRAY;
  }

  const svg = iconSvgDoc.documentElement.cloneNode(true);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('width', '32');
  svg.setAttribute('height', '32');
  svg.style.verticalAlign = 'text-bottom';

  // Use currentColor when we have a color to apply; otherwise leave the SVG's
  // native fills intact (shows orange during loading).
  if (iconColor) {
    iconInner.style.color = iconColor;
    svg.setAttribute('fill', 'currentColor');
    svg.querySelectorAll('[fill]').forEach((el) => el.removeAttribute('fill'));
  }

  iconInner.appendChild(svg);

  iconCircle.appendChild(iconInner);
  iconWrapper.appendChild(iconCircle);
  return iconWrapper;
};

const createHeaderText = (approvalStatus) => {
  const textWrapper = document.createElement('div');
  textWrapper.classList.add(
    'd-flex',
    'flex-1',
    'flex-column',
    'flex-sm-row',
    'gap-2'
  );

  const textInner = document.createElement('div');
  textInner.classList.add('flex-1');

  const heading = document.createElement('h3');
  const classNames = githubClassNames();
  heading.classList.add(
    ...[classNames.headingModule, classNames.headingPrimer].filter(Boolean)
  );
  heading.textContent = 'Code owners';

  const description = document.createElement('p');
  description.classList.add('fgColor-muted', 'mb-0');
  description.id = APPROVALS_DESCRIPTION_ID;

  if (approvalStatus) {
    description.textContent = describeApprovalStatus(approvalStatus);
  } else {
    description.textContent = 'Loading approval status...';
  }

  textInner.appendChild(heading);
  textInner.appendChild(description);
  textWrapper.appendChild(textInner);
  return textWrapper;
};

const EXPAND_STATE_KEY = 'ghco-codeownersExpanded';
const APPROVALS_DESCRIPTION_ID = 'ghco-approvals-description';

const getExpandStateKey = () => {
  const {owner, repo, num} = github.getPrInfo();
  return `${owner}/${repo}/${num}:${EXPAND_STATE_KEY}`;
};

// GitHub's merge box classes, which our section copies to look like one of its
// sections. The Overview page has no merge box to match, and a stylesheet may
// still define them, so none there: our own CSS styles the card instead.
const githubClassNames = () =>
  github.isOverviewPage() ? {} : github.getGithubClassNames();

// On the Overview page expanded means the overlay is locked open. GitHub's
// own locks don't survive leaving the page, so ours is kept on the section
// instead of in sessionStorage: a new page has a new, unlocked section.
const overviewSection = () =>
  document.querySelector('section[aria-label="Code owners"]');

const getDefaultExpandState = (approvalStatus) => {
  if (github.findOverviewMergeStatus()) {
    return overviewSection()?.dataset.locked === 'true';
  }

  const saved = sessionStorage.getItem(getExpandStateKey());
  if (saved !== null) {
    return saved === 'true';
  }

  // Only start expanded when owner approvals are still needed
  return (
    approvalStatus?.ownerApprovalRequired &&
    approvalStatus.groupApprovalsReceived <
      approvalStatus.groupApprovalsRequired
  );
};

const saveExpandState = (isExpanded) => {
  if (github.findOverviewMergeStatus()) {
    const section = overviewSection();
    if (section) section.dataset.locked = isExpanded.toString();
  } else {
    sessionStorage.setItem(getExpandStateKey(), isExpanded.toString());
  }
};

const onClickHeader = (event) => {
  const expandButton = event.currentTarget;
  const wasExpanded = expandButton.getAttribute('aria-expanded') === 'true';
  const isExpanded = !wasExpanded;

  event.preventDefault();
  event.stopPropagation();

  expandButton.setAttribute('aria-expanded', isExpanded.toString());
  saveExpandState(isExpanded);

  const chevronWrapper = expandButton.parentElement?.querySelector(
    'div[style*="transition"]'
  );
  if (chevronWrapper) {
    chevronWrapper.style.transform = `rotate(${isExpanded ? 180 : 90}deg)`;
  }

  const section = expandButton.closest('section[aria-label="Code owners"]');
  const expandableWrapper = section?.querySelector(
    '.ghco-merge-box-expandable-wrapper'
  );
  const expandableContent = expandableWrapper?.querySelector(
    github.moduleClassSelector('expandableContent', 'div')
  );

  const expandedClassName = expandButton.dataset.expandedClassName;
  if (expandedClassName) {
    expandableContent?.classList.toggle(expandedClassName, isExpanded);
    expandableWrapper?.classList.toggle(expandedClassName, isExpanded);
  }
  expandableWrapper?.classList.toggle('ghco-expanded', isExpanded);
};

const createMergeBoxSectionHeader = (approvalStatus) => {
  const header = document.createElement('div');
  const classNames = githubClassNames();
  const isExpandable = Boolean(approvalStatus);

  // Our own class to find it by: GitHub's class names change format
  header.classList.add(
    'ghco-section-header',
    ...[classNames.wrapper].filter(Boolean)
  );
  if (isExpandable) {
    header.classList.add(...[classNames.wrapperCanExpand].filter(Boolean));
  }

  const wrapper = document.createElement('div');
  wrapper.classList.add('d-flex', 'width-full');

  const headerContent = document.createElement('div');
  headerContent.classList.add('d-flex', 'width-full');

  headerContent.appendChild(createHeaderIcon(approvalStatus));
  headerContent.appendChild(createHeaderText(approvalStatus));
  wrapper.appendChild(headerContent);

  if (isExpandable) {
    const isExpanded = getDefaultExpandState(approvalStatus);

    const expandButton = document.createElement('button');
    expandButton.setAttribute('aria-label', 'Code owners');
    expandButton.setAttribute('type', 'button');
    expandButton.setAttribute('aria-expanded', isExpanded.toString());
    expandButton.classList.add(
      ...[classNames.headingButton, 'ghco-header-button'].filter(Boolean)
    );
    expandButton.dataset.expandedClassName = classNames.expanded ?? '';

    wrapper.appendChild(expandButton);

    const chevronContainer = document.createElement('div');
    chevronContainer.className = 'fgColor-muted pr-2 pt-2';

    const chevronWrapper = document.createElement('div');
    chevronWrapper.style.transition = 'transform 0.15s ease-in-out';
    chevronWrapper.style.transform = `rotate(${isExpanded ? 180 : 90}deg)`;
    const svg = chevronSvgDoc.documentElement.cloneNode(true);
    chevronWrapper.appendChild(svg);

    chevronContainer.appendChild(chevronWrapper);
    wrapper.appendChild(chevronContainer);
  }

  header.appendChild(wrapper);

  return header;
};

const createMergeBoxOwnerGroupsContent = (ownerGroupsMap, ownershipData) => {
  const content = document.createElement('div');
  content.classList.add('ghco-merge-box-container');

  // Sort groups by relevance to current user:
  // Within each priority, sort by number of files (descending)
  const sortedGroups = sortOwnerGroups(ownerGroupsMap, ownershipData);

  sortedGroups.forEach(({owners, paths, digests}, index) => {
    try {
      const group = createMergeBoxOwnerGroup({
        owners,
        paths,
        digests,
        ownershipData,
      });
      content.appendChild(group);
    } catch (error) {
      console.error('[GHCO] Error creating owner group', index, error);
    }
  });

  return content;
};

const createMergeBoxSectionContent = (ownerGroupsContent, approvalStatus) => {
  const classNames = githubClassNames();
  const expandableWrapper = document.createElement('div');
  expandableWrapper.classList.add(
    ...[
      classNames.expandableWrapper,
      'ghco-merge-box-expandable-wrapper',
    ].filter(Boolean)
  );
  expandableWrapper.style.visibility = 'visible';

  const expandableContent = document.createElement('div');
  expandableContent.classList.add(
    ...[classNames.expandableContent].filter(Boolean)
  );

  const isExpanded = getDefaultExpandState(approvalStatus);
  if (classNames.expanded) {
    expandableContent.classList.toggle(classNames.expanded, isExpanded);
    expandableWrapper.classList.toggle(classNames.expanded, isExpanded);
  }
  expandableWrapper.classList.toggle('ghco-expanded', isExpanded);

  expandableContent.appendChild(ownerGroupsContent);

  expandableWrapper.appendChild(expandableContent);

  return expandableWrapper;
};

const createLoadingMergeBoxSection = (container) => {
  const section = document.createElement('section');
  section.setAttribute('aria-label', 'Code owners');

  const sectionHeader = createMergeBoxSectionHeader(null);
  section.appendChild(sectionHeader);

  ensureCorrectPosition(section, container);

  return section;
};

const updateMergeBoxSectionWithContent = (
  section,
  approvalStatus,
  ownerGroupsMap,
  ownershipData
) => {
  // Set aria-describedby only after loading to avoid screen readers announcing the brief loading state
  section.setAttribute('aria-describedby', APPROVALS_DESCRIPTION_ID);

  const existingHeader = section.querySelector('.ghco-section-header');
  if (existingHeader) {
    const oldGroupApprovalsReceived = Number(
      existingHeader.dataset.approvalCount || 0
    );
    if (
      approvalStatus.ownerApprovalRequired &&
      oldGroupApprovalsReceived !== approvalStatus.groupApprovalsReceived &&
      approvalStatus.groupApprovalsReceived ===
        approvalStatus.groupApprovalsRequired
    ) {
      saveExpandState(false);
    }

    const newHeader = createMergeBoxSectionHeader(approvalStatus);
    newHeader.dataset.approvalCount = approvalStatus.groupApprovalsReceived;
    section.replaceChild(newHeader, existingHeader);
  }

  // Remove all old wrappers (defensive against any bugs that create multiple)
  const oldWrappers = section.querySelectorAll(
    '.ghco-merge-box-expandable-wrapper'
  );
  oldWrappers.forEach((wrapper) => wrapper.remove());

  const ownerGroupsContent = createMergeBoxOwnerGroupsContent(
    ownerGroupsMap,
    ownershipData
  );

  const sectionContent = createMergeBoxSectionContent(
    ownerGroupsContent,
    approvalStatus
  );
  section.appendChild(sectionContent);
};

const onClickFileGroupExpander = (event) => {
  const button = event.currentTarget;
  const wasExpanded = button.getAttribute('aria-expanded') === 'true';
  const isExpanded = !wasExpanded;

  event.preventDefault();
  event.stopPropagation();

  if (event.isTrusted) {
    clearHighlightedOwner();
  }

  // Option/Alt key: expand/collapse all file groups (not on our recursive call, though)
  if (event.altKey && event.isTrusted) {
    const section = button.closest('section[aria-label="Code owners"]');
    const allButtons = section?.querySelectorAll('.ghco-file-count-button');

    allButtons?.forEach((btn) => {
      const btnExpanded = btn.getAttribute('aria-expanded') === 'true';
      if (btnExpanded !== isExpanded) btn.click();
    });
    return; // Don't toggle the clicked button again - already handled in loop
  }

  button.setAttribute('aria-expanded', isExpanded.toString());

  const fileCount = button.querySelector('.Counter')?.textContent || '0';
  const fileWord = fileCount === '1' ? 'file' : 'files';
  button.setAttribute(
    'aria-label',
    `${
      isExpanded ? 'Collapse' : 'Expand'
    } ${fileCount} ${fileWord} for this owner group`
  );

  const chevronWrapper = button.querySelector('.ghco-chevron-wrapper');
  if (chevronWrapper) {
    chevronWrapper.style.transform = `rotate(${isExpanded ? 180 : 90}deg)`;
  }

  const wrapper = button
    .closest('.ghco-merge-box-owner-group')
    ?.querySelector('.ghco-files-wrapper');
  const content = wrapper?.querySelector('.ghco-files-content');

  if (wrapper && content) {
    wrapper.classList.toggle('ghco-files-wrapper--expanded', isExpanded);
    content.classList.toggle('ghco-files-content--expanded', isExpanded);
  }
};

const onOwnerClick = (clickedOwner, event) => {
  setProgrammaticExpansion(true);

  // Capture the group that was clicked to maintain its scroll position
  const clickedLabel = event?.target;
  const clickedGroup = clickedLabel?.closest('.ghco-merge-box-owner-group');
  const oldRect = clickedGroup?.getBoundingClientRect();

  const section = document.querySelector('section[aria-label="Code owners"]');
  if (!section) return;

  const groups = section.querySelectorAll('.ghco-merge-box-owner-group');
  groups.forEach((group) => {
    const labels = group.querySelectorAll('.ghco-label');
    const expandGroup = Array.from(labels).some(
      (label) => label.dataset.owner === clickedOwner
    );

    const button = group.querySelector('.ghco-file-count-button');
    if (!button) return;

    const isExpanded = button.getAttribute('aria-expanded') === 'true';

    if (expandGroup !== isExpanded) {
      button.click();
    }
  });

  // Restore scroll position of the clicked group
  // logic: if group moved down (newTop > oldTop), we scroll the container down to compensate
  if (clickedGroup && oldRect) {
    const container = clickedGroup.closest('.ghco-merge-box-container');

    // Wait for frame to handle any immediate layout shifts
    requestAnimationFrame(() => {
      // Logic for preserving position:
      // Current viewport Y + (New Element Y - Old Element Y)
      const newRect = clickedGroup.getBoundingClientRect();
      const deltaY = newRect.top - oldRect.top;
      if (deltaY !== 0 && container) {
        container.scrollBy({top: deltaY, behavior: 'auto'});
      }
    });
  }

  // Reset flag after animations/updates have likely occurred
  setTimeout(() => {
    setProgrammaticExpansion(false);
  }, 1000);
};

const createMergeBoxOwnerGroup = ({owners, paths, digests, ownershipData}) => {
  const listDiv = document.createElement('div');
  listDiv.classList.add('ghco-merge-box-owner-group');

  const fileWord = paths.length === 1 ? 'file' : 'files';

  // Create expander button for file list (default collapsed)
  const fileCountButton = document.createElement('button');
  fileCountButton.type = 'button';
  fileCountButton.classList.add('ghco-file-count-button');
  fileCountButton.setAttribute('aria-expanded', 'false');
  fileCountButton.setAttribute(
    'aria-label',
    `Expand ${paths.length} ${fileWord} for this owner group`
  );

  const chevronWrapper = document.createElement('span');
  chevronWrapper.classList.add('ghco-chevron-wrapper');
  chevronWrapper.style.transform = 'rotate(90deg)'; // Default collapsed (pointing right)
  const svg = chevronSvgDoc.documentElement.cloneNode(true);
  chevronWrapper.appendChild(svg);
  fileCountButton.appendChild(chevronWrapper);

  const fileCount = document.createElement('span');
  fileCount.classList.add('Counter');
  fileCount.textContent = paths.length;
  fileCountButton.appendChild(fileCount);

  const fileText = document.createElement('span');
  fileText.classList.add('ghco-file-text');
  fileText.textContent = fileWord;
  fileCountButton.appendChild(fileText);

  listDiv.appendChild(fileCountButton);

  const labelsDiv = document.createElement('div');
  labelsDiv.classList.add('ghco-merge-box-labels');

  const labels = createOwnerLabels({
    owners,
    ownershipData,
    onOwnerClick,
  });

  labels.forEach((label) => labelsDiv.appendChild(label));

  listDiv.appendChild(labelsDiv);

  // Wrap file list in expandable structure (default collapsed)
  const filesWrapper = document.createElement('div');
  filesWrapper.classList.add('ghco-files-wrapper');

  const filesContent = document.createElement('div');
  filesContent.classList.add('ghco-files-content');

  const filesUrl = github.getFilesUrl();

  paths.forEach((path, index) => {
    const fileLink = document.createElement('a');
    fileLink.href = `${filesUrl}#diff-${digests[index]}`;
    fileLink.textContent = path;
    fileLink.classList.add('ghco-merge-box-file-link');
    filesContent.appendChild(fileLink);
  });

  filesWrapper.appendChild(filesContent);
  listDiv.appendChild(filesWrapper);
  return listDiv;
};

// Delegate click listener for merge box interactions
document.addEventListener('click', (event) => {
  // Handle main header expand/collapse
  const headerButton = event.target.closest(
    'button[aria-label="Code owners"].ghco-header-button'
  );
  if (headerButton) {
    // Manually set currentTarget to the button for the handler
    const syntheticEvent = {
      ...event,
      currentTarget: headerButton,
      preventDefault: () => event.preventDefault(),
      stopPropagation: () => event.stopPropagation(),
    };
    onClickHeader(syntheticEvent);
    return;
  }

  // Our cell in the Overview page's summary grid: toggle the section below it
  const cellButton = event.target.closest('.ghco-mini-status-button');
  if (cellButton) {
    const section = document.querySelector('section[aria-label="Code owners"]');
    section?.querySelector('.ghco-header-button')?.click();
    if (section) syncOverviewCell(section);
    updateOverviewOpen();
    return;
  }

  // Handle file group expand/collapse
  const fileGroupButton = event.target.closest('.ghco-file-count-button');
  if (fileGroupButton) {
    // Manually set currentTarget to the button for the handler
    const syntheticEvent = {
      ...event,
      currentTarget: fileGroupButton,
      preventDefault: () => event.preventDefault(),
      stopPropagation: () => event.stopPropagation(),
      altKey: event.altKey,
      isTrusted: event.isTrusted,
    };
    onClickFileGroupExpander(syntheticEvent);
    return;
  }

  // Handle file links - force full page navigation to preserve anchors
  const fileLink = event.target.closest('.ghco-merge-box-file-link');
  if (fileLink) {
    event.preventDefault();
    window.location.href = fileLink.href;
    return;
  }

  // Handle dismiss button for version banner
  const dismissBtn = event.target.closest('.ghco-dismiss-button');
  if (dismissBtn) {
    event.stopPropagation();
    const banner = dismissBtn.closest('.ghco-new-version-banner');
    banner?.remove();
    const version = dismissBtn.dataset.version;
    if (version) {
      safeStorageSet({[DISMISSED_VERSION_KEY]: version});
    }
    return;
  }
});
