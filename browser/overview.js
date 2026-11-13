import * as github from './github';
import chevronRightSvg from './chevron-right-12.svg';
import chevronDownSvg from './chevron-down-12.svg';

import overviewCss from './overview.css';
import {injectStyles} from './inject-styles';

// The Code owners section on GitHub's Overview page: our cell in its summary
// grid and what the cell opens, or a card on merged and closed PRs. The
// section itself, its header and owner groups, is merge-box.js's.

// Inject CSS into page head for DevTools inspection
injectStyles(overviewCss, 'ghco-overview-styles');

const parser = new DOMParser();
const xmlDeclRegex = /<\?xml[^?]*\?>\s*/g;
const chevronRightSvgDoc = parser.parseFromString(
  chevronRightSvg.replace(xmlDeclRegex, ''),
  'image/svg+xml'
);
const chevronDownSvgDoc = parser.parseFromString(
  chevronDownSvg.replace(xmlDeclRegex, ''),
  'image/svg+xml'
);

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
  // GitHub's loading skeleton until the first data arrives (still undefined)
  if (approvalStatus === undefined) {
    bar.classList.add('ghco-skeleton');
    return bar;
  }
  // Hatched, like GitHub's Comments cell with no comments: for good without
  // CODEOWNERS or files (null)
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

// One of GitHub's cell classes: from its own cells, else from its stylesheets,
// as for a state (expanded, …) no cell is in at the moment
const githubCellClass = (mergeStatus, name) =>
  github.findModuleClass(
    mergeStatus?.querySelector(
      github.moduleClassSelector(name, `:scope > :not(.${OVERVIEW_CELL}) `)
    ),
    name
  ) ?? github.findStylesheetModuleClass(name);

const createOverviewCell = (mergeStatus, section) => {
  const status = section.ghcoApprovalStatus;
  const description =
    section.querySelector('.ghco-section-description')?.textContent ?? '';
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

  // GitHub's label row, with its classes; ours style it only where those
  // weren't found
  const classes = (...names) =>
    names.map((name) => githubCellClass(mergeStatus, name)).filter(Boolean);
  const label = document.createElement('div');
  label.classList.add(
    'ghco-mini-status-label',
    ...classes('MiniStatusLabelRow')
  );
  const name = document.createElement('span');
  name.classList.add(...classes('MiniStatusLabel'));
  const title = document.createElement('strong');
  title.classList.add(...classes('MiniStatusLabelText'));
  title.textContent = 'Code owners';
  name.appendChild(title);
  const summary = document.createElement('span');
  summary.classList.add(
    'ghco-mini-status-summary',
    ...classes('MiniStatusSummary')
  );
  summary.textContent = describeOverviewCell(status);
  label.append(name, summary);
  // GitHub's chevrons: right while collapsed, down while locked open. Shown
  // while loading too, as on GitHub's cells; only no CODEOWNERS has none.
  if (headerButton || status === undefined) {
    const chevron = (isLocked ? chevronDownSvgDoc : chevronRightSvgDoc)
      .documentElement;
    const icon = chevron.cloneNode(true);
    icon.classList.add(
      'ghco-mini-status-chevron',
      ...classes('NavigationIcon')
    );
    icon.classList.toggle('ghco-locked', isLocked);
    // Muted unless active: both or neither, or a locked chevron stays muted
    const [rowIcon, active] = classes(
      'MiniStatusLabelRowIcon',
      'MiniStatusLabelRowIconActive'
    );
    if (rowIcon && active) {
      icon.classList.add(rowIcon);
      if (isLocked) icon.classList.add(active);
    }
    label.appendChild(icon);
  }
  cell.appendChild(label);
  cell.appendChild(createOverviewCellBar(status));
  return cell;
};

// A column per cell in the grid's wide layout, ours included, so a cell
// GitHub adds doesn't push ours onto a row of its own. Set on <html>, for
// GitHub's drawers beside the grid and its overlays outside it to line up
// with its columns too.
const updateOverviewCellCount = (mergeStatus) => {
  const count = String(mergeStatus.querySelectorAll(':scope > section').length);
  const root = document.documentElement;
  if (root.style.getPropertyValue('--ghco-cells') !== count) {
    root.style.setProperty('--ghco-cells', count);
  }
};

// Fake data for screenshots: GitHub's own cells to go with our fake owners
// (only Athena approved, code owner review still required), in place of the
// screenshot PR's empty ones
const FAKE_GITHUB_CELLS = {
  checks: {
    segments: [
      [10, 'success'],
      [2, 'neutral'],
    ],
  },
  comments: {segments: [[4, 'success']]},
  approvals: {
    summary: '1 still required',
    segments: [
      [1, 'success'],
      [1, 'attention'],
      [1, 'neutral'],
    ],
  },
};

const fakeGithubCells = (mergeStatus) => {
  // Only in place of an unavailable bar: on a PR whose cell has data, React
  // can keep the element it showed while loading for the real bar, ours too
  mergeStatus.querySelectorAll('.ghco-fake-bar').forEach((bar) => {
    if (
      !bar.parentElement.matches(
        '[data-testid="multicolor-progress-unavailable"]'
      )
    ) {
      bar.remove();
    }
  });
  mergeStatus
    .querySelectorAll(`:scope > section:not(.${OVERVIEW_CELL})`)
    .forEach((cell) => {
      const name = cell.querySelector('strong')?.textContent.trim();
      const fake = FAKE_GITHUB_CELLS[name?.toLowerCase()];
      const progress = cell.querySelector(
        '[data-testid="multicolor-progress-unavailable"]'
      );
      if (!fake || !progress || progress.querySelector('.ghco-fake-bar')) {
        return;
      }
      [...progress.children].forEach((child) => {
        child.style.display = 'none';
      });
      const bar = document.createElement('div');
      bar.classList.add('ghco-mini-status-bar', 'ghco-fake-bar');
      fake.segments.forEach(([count, tone]) => {
        const segment = document.createElement('span');
        segment.classList.add('ghco-segment', `ghco-segment--${tone}`);
        segment.style.flexGrow = count;
        bar.appendChild(segment);
      });
      progress.appendChild(bar);

      const label = cell.querySelector(
        github.moduleClassSelector('MiniStatusLabel', 'span')
      );
      if (fake.summary && label) {
        const summary = document.createElement('span');
        summary.classList.add(
          'ghco-mini-status-summary',
          ...[githubCellClass(mergeStatus, 'MiniStatusSummary')].filter(Boolean)
        );
        summary.textContent = fake.summary;
        label.after(summary);
      }
    });
};

// Fake data for screenshots: the do-not-merge draft PR shown as open and
// waiting for approval, as an open PR's header and recommended action are
const OPEN_PR_PATH =
  'M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z';
const CLOCK_PATH =
  'M8.5 4.75v2.992l2.028.812a.75.75 0 0 1-.557 1.392l-2.5-1A.751.751 0 0 1 7 8.25v-3.5a.75.75 0 0 1 1.5 0Z';

const setText = (element, text) => {
  const node = [...(element?.childNodes ?? [])].find(
    (child) => child.nodeType === Node.TEXT_NODE && child.textContent.trim()
  );
  if (node) node.textContent = text;
};

const fakeReadyForReview = () => {
  const label = document.querySelector('[data-status="draft"]');
  if (label) {
    label.setAttribute('data-status', 'pullOpened');
    const icon = label.querySelector('svg.octicon-git-pull-request-draft');
    icon?.classList.replace(
      'octicon-git-pull-request-draft',
      'octicon-git-pull-request'
    );
    icon?.querySelector('path')?.setAttribute('d', OPEN_PR_PATH);
    setText(label, 'Open');
  }

  const item = document.querySelector(
    'section[aria-label="Recommended action"] li[data-item-id="draft-pr"]'
  );
  if (!item) return;
  item.setAttribute('data-item-id', 'approval-required');
  const statusIcon = item.querySelector('[class*="statusIcon__"]');
  if (statusIcon) {
    statusIcon.style.backgroundColor = 'var(--bgColor-attention-muted)';
  }
  const glyph = item.querySelector('[class*="glyph__"]');
  if (glyph) {
    glyph.style.backgroundColor = 'var(--bgColor-attention-emphasis)';
  }
  const glyphIcon = glyph?.querySelector('svg');
  if (glyphIcon) {
    glyphIcon.setAttribute('width', '24');
    glyphIcon.setAttribute('height', '24');
    glyphIcon.classList.remove('octicon-git-pull-request-draft');
    glyphIcon.querySelector('path')?.setAttribute('d', CLOCK_PATH);
  }
  setText(
    item.querySelector('[data-testid="for-you-item-title"]'),
    'Approval required'
  );
  setText(
    item.querySelector('[data-testid="for-you-item-subtext"]'),
    'Request another approving review before this can merge.'
  );
  setText(
    item.querySelector('.prc-Button-Label-FWkx3, [data-component="text"]'),
    'Enable auto-merge (squash)'
  );
};

// Keep our cell in GitHub's summary grid in step with the section. React
// re-renders the grid, so this also puts the cell back when it's dropped.
export const syncOverviewCell = (section) => {
  const mergeStatus = github.findOverviewMergeStatus();
  const cells = document.querySelectorAll(`.${OVERVIEW_CELL}`);
  if (!mergeStatus || !section.isConnected) {
    cells.forEach((cell) => cell.remove());
    return;
  }
  fakeGithubCells(mergeStatus);
  fakeReadyForReview();

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

// Like GitHub's cells beside it, ours opens an overlay while hovered, and a
// click pins it open as a drawer (the section's expand state) until clicked
// again
let overviewHovered = false;
let overviewHoverTimer;
// Unpinning closes it even under the pointer, as GitHub's do: hover opens it
// again only once the pointer has left and come back
let overviewHoverSuppressed = false;

const isOverviewPinned = (section) =>
  section
    ?.querySelector('.ghco-header-button')
    ?.getAttribute('aria-expanded') === 'true';

// The overlay goes after the grid's bordered box, which would clip it. The
// drawer goes in that box, beside the grid, where GitHub puts its own
// drawers; anywhere among them, so React adding one before ours moves nothing.
const placeOverviewPanel = (section) => {
  const mergeStatus = github.findOverviewMergeStatus();
  const box = github.findOverviewMergeStatusBox();
  if (!mergeStatus || !box) return;
  if (isOverviewPinned(section)) {
    if (section.parentElement !== mergeStatus.parentElement) {
      mergeStatus.after(section);
    }
  } else if (box.nextElementSibling !== section) {
    box.after(section);
  }
};

export const updateOverviewOpen = () => {
  const section = document.querySelector('section.ghco-overview-panel');
  if (!section) {
    overviewHovered = false;
  }
  const cell = document.querySelector(`.${OVERVIEW_CELL}`);
  const pinned = isOverviewPinned(section);
  // Nothing to open while loading or without CODEOWNERS: the hatched cell
  // ignores hover, as GitHub's Comments cell does with no comments
  const hasContent = Boolean(cell?.querySelector('.ghco-mini-status-button'));
  const isOpen = Boolean(section && hasContent && (pinned || overviewHovered));
  const isOverlay = isOpen && !pinned;
  section?.classList.toggle('ghco-open', isOpen);
  section?.classList.toggle('ghco-overlay', isOverlay);
  cell?.classList.toggle('ghco-open', isOpen);
  cell?.classList.toggle('ghco-expanded', isOpen && pinned);
  // GitHub's own states for a cell: expanded when pinned, connected to its
  // overlay when hovered
  const mergeStatus = cell?.parentElement;
  [
    ['MiniStatusExpanded', isOpen && pinned],
    ['MiniStatusConnected', isOverlay],
  ].forEach(([name, on]) => {
    const className = githubCellClass(mergeStatus, name);
    if (cell && className) cell.classList.toggle(className, on);
  });
  // The line between the open section and the other cells, from the grid's
  // left edge to our cell: none when stacked, where our cell spans the grid.
  // Measured, as GitHub does for its own: anchor-size() of our cell doesn't
  // resolve inside the section. Rects are in zoomed pixels under a CSS zoom,
  // which then applies to the property again.
  if (isOpen && cell) {
    const overhang =
      (cell.getBoundingClientRect().left -
        cell.parentElement.getBoundingClientRect().left) /
      (section.currentCSSZoom ?? 1);
    section.style.setProperty('--ghco-overhang', `${overhang}px`);
  }
  // The overlay continues the grid's bordered box, so the box squares its
  // bottom corners
  const box = isOverlay ? github.findOverviewMergeStatusBox() : null;
  document.querySelectorAll('[data-ghco-open]').forEach((el) => {
    if (el !== box) delete el.dataset.ghcoOpen;
  });
  if (box) box.dataset.ghcoOpen = '';
};

// Clicks keep the pinned state; the grid's box applies it whenever it
// resizes. GitHub's layout follows the box's width (a container query),
// which the window changes, and so do GitHub's side panels, and a drawer
// appearing or closing changes its height. A switch to stacked may change
// nothing else in the DOM, as when ours emptied GitHub's set while wide.
let observedOverviewBox = null;
// At most once a frame, and cheap: no debounce, which would hold the re-pins
// back until a drag of the window's edge stops
// GitHub switches to stacked a frame after the box does, often without
// resizing the box again: until then, look again each frame, a few at most
const applyOverviewPins = (framesLeft = 10) => {
  yieldToGithubDrawer();
  repinOverviewWhenStacked();
  updateOverviewOpen();
  if (framesLeft && isOverviewStacked() && findGithubDrawer()) {
    requestAnimationFrame(() => applyOverviewPins(framesLeft - 1));
  }
};
const overviewBoxObserver = new ResizeObserver(() => applyOverviewPins());

export const observeOverviewBox = () => {
  const box = github.findOverviewMergeStatusBox();
  if (box === observedOverviewBox) return;
  overviewBoxObserver.disconnect();
  observedOverviewBox = box;
  if (box) overviewBoxObserver.observe(box);
};

// Close only after a moment, so the pointer can cross from the cell into the
// overlay without it closing on the way
document.addEventListener('pointerover', (event) => {
  // Our cell by position, not by target: rebuilding it (on every pin and
  // unpin) reports the grid under a pointer that hasn't moved, which would
  // count as leaving it
  const rect = document
    .querySelector(`.${OVERVIEW_CELL}`)
    ?.getBoundingClientRect();
  const overCell =
    rect &&
    event.clientX >= rect.left &&
    event.clientX < rect.right &&
    event.clientY >= rect.top &&
    event.clientY < rect.bottom;
  const hovered = Boolean(
    overCell || event.target.closest?.('.ghco-overview-panel')
  );
  if (!hovered) overviewHoverSuppressed = false;
  if (hovered && overviewHoverSuppressed) return;
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

const toggleOverviewDrawer = () => {
  const section = document.querySelector('section[aria-label="Code owners"]');
  if (!section) return;
  section.querySelector('.ghco-header-button')?.click();
  placeOverviewPanel(section);
  syncOverviewCell(section);
  updateOverviewOpen();
};

// GitHub keeps a set of pinned cells. Stacked, each pinned drawer shows
// inside the grid after its cell, and ours stays pinned beside them. Wide,
// only the last-pinned shows, beside the grid, so there ours and GitHub's
// close each other, and switching to wide with both pinned keeps the one
// pinned last. Whichever gave way is pinned again back in stacked.
let overviewPinnedLast = false;
// Ours, unpinned while wide for one of GitHub's, stays in the set as
// GitHub's own would, and is pinned again back in stacked. Unless the set is
// cleared in between: unpinning a GitHub cell or clicking ours.
let overviewRepinWhenStacked = false;

const isOverviewStacked = () => {
  const mergeStatus = github.findOverviewMergeStatus();
  return (
    !!mergeStatus &&
    getComputedStyle(mergeStatus).gridTemplateColumns.trim().split(/\s+/)
      .length === 1
  );
};

// GitHub's drawer beside the grid: only in the wide layout
const findGithubDrawer = () => {
  const mergeStatus = github.findOverviewMergeStatus();
  return [...(mergeStatus?.parentElement?.children ?? [])].find(
    (el) =>
      el.tagName === 'SECTION' &&
      el !== mergeStatus &&
      !el.classList.contains('ghco-overview-panel')
  );
};

// The drawer ours closed, still there until React removes it
let closingGithubDrawer = null;
// GitHub's set of pinned cells as we've seen it, which ours emptying it
// doesn't change: those cells are pinned again back in stacked. Wide hides
// all but the last-pinned, so the record follows real clicks: a cell pinned
// joins it, and unpinning the drawer that shows clears it, as it does
// GitHub's whole set. Stacked, where they all show, it is read back after
// the re-pins.
let githubPinned = [];

const pinnedGithubCells = () =>
  Array.from(
    github
      .findOverviewMergeStatus()
      ?.querySelectorAll(
        `:scope > section:not(.${OVERVIEW_CELL}) > button[aria-expanded="true"]`
      ) ?? [],
    (button) => button.parentElement
  );

// Closing the drawer that shows, as GitHub does when it's clicked, unpins
// every one of GitHub's cells. Nothing to close when stacked.
const closeGithubDrawer = () => {
  closingGithubDrawer = findGithubDrawer() ?? null;
  if (!closingGithubDrawer) return;
  const button = github
    .findOverviewMergeStatus()
    ?.querySelector(
      `:scope > section:not(.${OVERVIEW_CELL}) > button[aria-expanded="true"]`
    );
  button?.click();
};

// A GitHub drawer beside the grid while ours is pinned: one of GitHub's was
// pinned, or the layout just turned wide. The one pinned last stays. Not
// once the box is stacked: GitHub switches its layout a frame after the
// box's width does, and closing its drawer in that frame empties its set.
const yieldToGithubDrawer = () => {
  const drawer = findGithubDrawer();
  if (
    !drawer ||
    isOverviewStacked() ||
    drawer === closingGithubDrawer ||
    !isOverviewPinned(document.querySelector('section.ghco-overview-panel'))
  ) {
    return;
  }
  if (overviewPinnedLast) {
    closeGithubDrawer();
  } else {
    toggleOverviewDrawer();
    overviewRepinWhenStacked = true;
  }
};

// Set after clicking GitHub's cells open, until the record is read back
let githubRepinClicked = false;

// Only once GitHub has drawn its stacked layout, with no drawer left beside
// the grid: it switches a frame after the box's width does, and until then
// shows only the last-pinned of its cells as pinned
const repinOverviewWhenStacked = () => {
  if (!isOverviewStacked() || findGithubDrawer()) return;
  if (overviewRepinWhenStacked) {
    overviewRepinWhenStacked = false;
    const section = document.querySelector('section.ghco-overview-panel');
    if (section && !isOverviewPinned(section)) toggleOverviewDrawer();
  }
  // Clicked once, and read back on a later resize, once GitHub has drawn
  // them: never clicked again, should one not pin
  const buttons = githubRepinClicked
    ? []
    : githubPinned
        .filter((cell) => cell.isConnected)
        .map((cell) =>
          cell.querySelector(':scope > button[aria-expanded="false"]')
        )
        .filter(Boolean);
  if (buttons.length) {
    githubRepinClicked = true;
    buttons.forEach((button) => button.click());
    return;
  }
  githubRepinClicked = false;
  githubPinned = pinnedGithubCells();
};

// After a click on one of GitHub's cells, once React has handled it, its
// state is the record's. Read after the click, never from it: a click that
// lands as GitHub's hover overlay opens doesn't look like one that pins, and
// pins all the same.
document.addEventListener('click', (event) => {
  const mergeStatus = github.findOverviewMergeStatus();
  if (!mergeStatus?.contains(event.target)) return;
  // Our own clicks on GitHub's cells change nothing we keep track of
  if (!event.isTrusted) return;
  const githubCell = event.target.closest(`section:not(.${OVERVIEW_CELL})`);
  requestAnimationFrame(() => {
    const button =
      githubCell?.parentElement === mergeStatus
        ? githubCell.querySelector(':scope > button')
        : null;
    if (button?.getAttribute('aria-expanded') === 'true') {
      overviewPinnedLast = false;
      githubPinned = [
        ...githubPinned.filter((c) => c !== githubCell),
        githubCell,
      ];
    } else if (button) {
      // Unpinned: wide clears the whole set, and stacked shows what's left
      overviewRepinWhenStacked = false;
      githubPinned = isOverviewStacked() ? pinnedGithubCells() : [];
    }
    yieldToGithubDrawer();
  });
});

// Places the section on the Overview page; false on other pages, where the
// merge box takes it
export const placeOverviewSection = (section) => {
  // Open PR: our cell goes in GitHub's summary grid, and this section,
  // without its header, is what the cell opens
  if (github.findOverviewMergeStatusBox()) {
    placeOverviewPanel(section);
    section.classList.add('ghco-overview-panel');
    section.classList.remove('ghco-overview-card');
    return true;
  }

  // Merged or closed PR: no summary grid, so a card of our own
  const overviewAnchor = github.findOverviewAnchor();
  if (overviewAnchor) {
    if (overviewAnchor.previousElementSibling !== section) {
      overviewAnchor.before(section);
    }
    section.classList.add('ghco-overview-card');
    section.classList.remove('ghco-overview-panel');
    return true;
  }

  return false;
};

// Our cell in the summary grid: toggle the section below it. True when the
// click was on it.
export const handleOverviewCellClick = (event) => {
  const cellButton = event.target.closest('.ghco-mini-status-button');
  if (!cellButton) return false;
  const section = document.querySelector('section.ghco-overview-panel');
  const wasPinned = isOverviewPinned(section);
  overviewPinnedLast = !wasPinned;
  overviewRepinWhenStacked = false;
  // Unpinning ours while wide, where it's the drawer that shows, clears
  // the whole set, as unpinning GitHub's does
  if (wasPinned && !isOverviewStacked()) githubPinned = [];
  if (wasPinned) {
    clearTimeout(overviewHoverTimer);
    overviewHovered = false;
    overviewHoverSuppressed = true;
  } else {
    closeGithubDrawer();
  }
  toggleOverviewDrawer();
  return true;
};
