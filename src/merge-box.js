import * as github from './github';
import iconSvg from '../public/icons/icon.svg';
import chevronUpSvg from './chevron-up.svg';
import {getPrOwnershipData} from './ownership';
import {createOwnerLabels} from './labels';

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

const createOwnerGroupsMap = (diffFilesMap, folderOwners) => {
  const ownerGroupsMap = new Map();

  for (const [digest, path] of diffFilesMap.entries()) {
    const {owners} = folderOwners.find(({folderMatch}) =>
      folderMatch.ignores(path)
    ) || {owners: new Set()};

    const ownerKey = Array.from(owners).sort().join(',') || '__any__';

    if (!ownerGroupsMap.has(ownerKey)) {
      ownerGroupsMap.set(ownerKey, {
        owners: owners.size > 0 ? owners : null, // null means "any reviewer"
        paths: [],
        digests: [],
      });
    }

    ownerGroupsMap.get(ownerKey).paths.push(path);
    ownerGroupsMap.get(ownerKey).digests.push(digest);
  }

  return ownerGroupsMap;
};

export const updateMergeBox = async () => {
  const mergeBox = document.querySelector('div[class*="MergeBox-module"]');
  if (!mergeBox) {
    return;
  }

  let section = mergeBox.querySelector('section[aria-label="Code owners"]');

  // Find the container by looking for siblings, which have section header wrappers
  const sectionHeader = mergeBox.querySelector(
    'div[class*="MergeBoxSectionHeader-module__wrapper"]'
  );

  // If the section header is inside a section or is the section itself,
  // we want the section's parent. If it's a naked wrapper, we want its parent.
  const siblingSection = sectionHeader?.closest('section');
  let container = (siblingSection || sectionHeader)?.parentElement;

  // Fallback: try to find the container by class name if no siblings found
  if (!container) {
    container = mergeBox.querySelector(
      'div[class*="MergeBox-module__mergeBoxAdjustBorders"]'
    );
  }

  if (!container) {
    console.info('[GHCO] Could not find merge box container');
    return;
  }

  // Calculate current state (synchronous checks only)
  const isMerged = github.getIsMerged();
  const reviewers = Array.from(github.getReviewersFromDoc(document).entries());
  const approvers = reviewers
    .filter(([, approved]) => approved)
    .map(([approver]) => approver)
    .sort();

  // Count timeline items to detect commits, review requests, etc.
  const timelineItems = document.querySelectorAll('.TimelineItem');
  const timelineCount = timelineItems.length;

  const newState = [isMerged, timelineCount, ...approvers].join(',');
  const oldState = section?.dataset.state || '';

  // Check if merge status changed (requires recreating for correct positioning)
  const oldMergeStatus = oldState.split(',')[0];
  const newMergeStatus = newState.split(',')[0];

  if (section && oldMergeStatus !== newMergeStatus) {
    saveExpandState(false);
  }

  // Create section if it doesn't exist
  if (!section) {
    section = createLoadingMergeBoxSection(container, isMerged);
    if (!section) {
      return;
    }
  } else {
    // Check if section is in the correct position (merge box structure may have changed)
    ensureCorrectPosition(section, container);
  }

  // Update state early
  section.dataset.state = newState;

  // If state hasn't changed and section has content, we're done (fast path!)
  const hasContent = section.querySelector('div[class*="__expandableWrapper"]');
  if (oldState === newState && hasContent) {
    return;
  }

  // Fetch ownership data and update section content
  const [ownershipData, diffFilesMap] = await Promise.all([
    getPrOwnershipData(),
    github.getDiffFilesMap(),
  ]);
  if (!ownershipData || !diffFilesMap || diffFilesMap.size === 0) {
    const description = section.querySelector('p');
    if (description) {
      description.textContent = ownershipData
        ? 'No files to review'
        : 'No CODEOWNERS file found';
    }
    return;
  }

  const {folderOwners} = ownershipData;
  const ownerGroupsMap = createOwnerGroupsMap(diffFilesMap, folderOwners);
  updateMergeBoxSectionWithContent(section, {
    isMerged,
    ownerGroupsMap,
    ownershipData,
  });
};

// Position section correctly in the merge box and set border classes
const ensureCorrectPosition = (section, container) => {
  // Our section goes after either the Reviews section or the merged PR message,
  // or at the end if neither exists
  const previousSection = container.querySelector(
    [
      'section[aria-label="Reviews"]',
      ':scope > div[class*="MergeBoxSectionHeader-module__wrapper"].flex-column',
    ].join(', ')
  );

  // Only move if not already in correct position
  if (previousSection) {
    if (previousSection.nextElementSibling !== section) {
      previousSection.after(section);
    }
  } else {
    if (container.lastElementChild !== section) {
      container.appendChild(section);
    }
  }

  const isAfterDiv = previousSection && !previousSection.matches('section');
  const hasNextSibling = Boolean(section.nextElementSibling);

  section.classList.toggle('border-top', isAfterDiv);
  section.classList.toggle('border-bottom', hasNextSibling);
  section.classList.add('color-border-subtle');
};

const createHeaderIcon = (approvalStatus, isMerged) => {
  const iconWrapper = document.createElement('div');
  iconWrapper.classList.add('mr-2', 'flex-shrink-0');

  const iconCircle = document.createElement('div');
  iconCircle.style.overflow = 'hidden';
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

  if (isMerged) {
    iconInner.style.backgroundColor = 'var(--bgColor-default)';
    iconInner.style.color = 'var(--bgColor-done-emphasis)';
  } else {
    iconInner.classList.add('bgColor-neutral-muted');
    if (approvalStatus) {
      const allApproved =
        approvalStatus.approvalsReceived ===
        approvalStatus.totalApprovalsNeeded;
      iconInner.classList.add(
        allApproved ? 'fgColor-success' : 'fgColor-danger'
      );
    }
  }

  const svg = iconSvgDoc.documentElement.cloneNode(true);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('width', '32');
  svg.setAttribute('height', '32');
  svg.style.verticalAlign = 'text-bottom';

  if (approvalStatus || isMerged) {
    svg.setAttribute('fill', 'currentColor');
    // Remove inline fill attributes so currentColor works
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
  const classNames = github.getGithubClassNames();
  heading.classList.add(classNames.headingModule, classNames.headingPrimer);
  heading.textContent = 'Code owners';

  const description = document.createElement('p');
  description.classList.add('fgColor-muted', 'mb-0');
  description.id = APPROVALS_DESCRIPTION_ID;
  description.textContent = approvalStatus
    ? `${approvalStatus.approvalsReceived} of ${approvalStatus.totalApprovalsNeeded} required approvals received`
    : 'Loading approval status...';

  textInner.appendChild(heading);
  textInner.appendChild(description);
  textWrapper.appendChild(textInner);
  return textWrapper;
};

const EXPAND_STATE_KEY = 'ghco-codeownersExpanded';
const APPROVALS_DESCRIPTION_ID = 'ghco-approvals-description';

const getExpandStateKey = () => {
  const prId = document.querySelector('#partial-discussion-header')?.dataset
    .gid;
  return `${prId}:${EXPAND_STATE_KEY}`;
};

const getDefaultExpandState = (approvalStatus, isMerged) => {
  const saved = sessionStorage.getItem(getExpandStateKey());
  if (saved !== null) {
    return saved === 'true';
  }

  // Default: expanded if PR is not merged and there are still approvals required
  if (isMerged) return false;

  // Check if there are approvals still needed
  if (approvalStatus) {
    return (
      approvalStatus.approvalsReceived < approvalStatus.totalApprovalsNeeded
    );
  }

  return false;
};

const saveExpandState = (isExpanded) => {
  sessionStorage.setItem(getExpandStateKey(), isExpanded.toString());
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
    chevronWrapper.style.transform = `rotate(${isExpanded ? 0 : 180}deg)`;
  }

  const section = expandButton.closest('section[aria-label="Code owners"]');
  const expandableWrapper = section?.querySelector(
    'div[class*="__expandableWrapper"]'
  );
  const expandableContent = expandableWrapper?.querySelector(
    'div[class*="__expandableContent"]'
  );

  const expandedClassName = expandButton.dataset.expandedClassName;
  if (expandedClassName) {
    expandableWrapper?.classList.toggle(expandedClassName, isExpanded);
    expandableContent?.classList.toggle(expandedClassName, isExpanded);
  }
};

const createMergeBoxSectionHeader = (approvalStatus, isMerged) => {
  const header = document.createElement('div');
  const classNames = github.getGithubClassNames();
  const isExpandable = Boolean(approvalStatus);

  header.classList.add(classNames.wrapper);
  if (isExpandable) {
    header.classList.add(classNames.wrapperCanExpand);
  }

  const wrapper = document.createElement('div');
  wrapper.classList.add('d-flex', 'width-full');

  const headerContent = document.createElement('div');
  headerContent.classList.add('d-flex', 'width-full');

  headerContent.appendChild(createHeaderIcon(approvalStatus, isMerged));
  headerContent.appendChild(createHeaderText(approvalStatus));
  wrapper.appendChild(headerContent);

  if (isExpandable) {
    const isExpanded = getDefaultExpandState(approvalStatus, isMerged);

    const expandButton = document.createElement('button');
    expandButton.setAttribute('aria-label', 'Code owners');
    expandButton.setAttribute('type', 'button');
    expandButton.setAttribute('aria-expanded', isExpanded.toString());
    expandButton.classList.add(classNames.headingButton);

    expandButton.dataset.expandedClassName = classNames.expanded;
    expandButton.addEventListener('click', onClickHeader);
    wrapper.appendChild(expandButton);

    const chevronContainer = document.createElement('div');
    chevronContainer.className = 'fgColor-muted pr-2 pt-2';

    const chevronWrapper = document.createElement('div');
    chevronWrapper.style.transition = 'transform 0.15s ease-in-out';
    chevronWrapper.style.transform = `rotate(${isExpanded ? 0 : 180}deg)`;
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
  const sortedGroups = Array.from(ownerGroupsMap.entries()).sort(
    ([, a], [, b]) => {
      const aPriority = getMergeBoxOwnerGroupPriority(a, ownershipData);
      const bPriority = getMergeBoxOwnerGroupPriority(b, ownershipData);

      if (aPriority !== bPriority) return aPriority - bPriority;
      return b.paths.length - a.paths.length;
    }
  );

  sortedGroups.forEach(([, {owners, paths, digests}]) => {
    content.appendChild(
      createMergeBoxOwnerGroup({
        owners,
        paths,
        digests,
        ownershipData,
      })
    );
  });

  return content;
};

const createMergeBoxSectionContent = (
  ownerGroupsContent,
  approvalStatus,
  isMerged
) => {
  const classNames = github.getGithubClassNames();
  const expandableWrapper = document.createElement('div');
  expandableWrapper.classList.add(
    classNames.expandableWrapper,
    'ghco-merge-box-expandable-wrapper'
  );
  expandableWrapper.style.visibility = 'visible';

  const expandableContent = document.createElement('div');
  expandableContent.classList.add(classNames.expandableContent);

  const isExpanded = getDefaultExpandState(approvalStatus, isMerged);
  expandableContent.classList.toggle(classNames.expanded, isExpanded);
  expandableWrapper.classList.toggle(classNames.expanded, isExpanded);

  expandableContent.appendChild(ownerGroupsContent);

  expandableWrapper.appendChild(expandableContent);

  return expandableWrapper;
};

const createLoadingMergeBoxSection = (container, isMerged) => {
  const section = document.createElement('section');
  section.setAttribute('aria-label', 'Code owners');

  const sectionHeader = createMergeBoxSectionHeader(null, isMerged);
  section.appendChild(sectionHeader);

  ensureCorrectPosition(section, container);

  return section;
};

const calculateApprovalStatus = (ownerGroupsMap, ownerApprovals) => {
  if (!ownerGroupsMap || !ownerApprovals) return null;

  let approvalsReceived = 0;
  let totalApprovalsNeeded = 0;

  for (const [, group] of ownerGroupsMap.entries()) {
    totalApprovalsNeeded++;

    const hasApproval =
      group.owners && group.owners.size > 0
        ? Array.from(group.owners).some((owner) => ownerApprovals.has(owner))
        : ownerApprovals.size > 0;

    if (hasApproval) {
      approvalsReceived++;
    }
  }

  return {approvalsReceived, totalApprovalsNeeded};
};

const updateMergeBoxSectionWithContent = (
  section,
  {isMerged, ownerGroupsMap, ownershipData}
) => {
  // Set aria-describedby only after loading to avoid screen readers announcing the brief loading state
  section.setAttribute('aria-describedby', APPROVALS_DESCRIPTION_ID);

  const approvalStatus = calculateApprovalStatus(
    ownerGroupsMap,
    ownershipData.ownerApprovals
  );

  const existingHeader = section.querySelector(
    'div[class*="MergeBoxSectionHeader"]'
  );
  if (existingHeader) {
    const existingButton = existingHeader.querySelector(
      'button[aria-label="Code owners"]'
    );
    existingButton?.removeEventListener('click', onClickHeader);

    const oldApprovalsReceived = Number(
      existingHeader.dataset.approvalCount || 0
    );
    if (
      oldApprovalsReceived !== approvalStatus.approvalsReceived &&
      approvalStatus.approvalsReceived === approvalStatus.totalApprovalsNeeded
    ) {
      saveExpandState(false);
    }

    const newHeader = createMergeBoxSectionHeader(approvalStatus, isMerged);
    newHeader.dataset.approvalCount = approvalStatus.approvalsReceived;
    section.replaceChild(newHeader, existingHeader);
  }

  // Clean up event listeners before removing old content
  const oldWrapper = section.querySelector('div[class*="__expandableWrapper"]');
  if (oldWrapper) {
    oldWrapper.querySelectorAll('.ghco-file-count-button').forEach((button) => {
      button.removeEventListener('click', onClickFileGroupExpander);
    });
    oldWrapper.remove();
  }

  const ownerGroupsContent = createMergeBoxOwnerGroupsContent(
    ownerGroupsMap,
    ownershipData
  );

  const sectionContent = createMergeBoxSectionContent(
    ownerGroupsContent,
    approvalStatus,
    isMerged
  );
  section.appendChild(sectionContent);
};

const getMergeBoxOwnerGroupPriority = (group, ownershipData) => {
  const {userTeams, ownerApprovals, prAuthor, user} = ownershipData;

  // If there are no specific owners, use user's teams since they are "any reviewer" who can approve
  const owners = Array.from(group.owners || userTeams);

  const approved = group.owners
    ? // Specific owners: check if any owner approved
      owners.some((owner) => ownerApprovals.has(owner))
    : // Any reviewer: check if anyone approved
      ownerApprovals.size > 0;

  // If the user is the PR author, they can't approve their own PR
  if (user !== prAuthor) {
    const userOnlyOwner = owners.every((owner) => userTeams.has(owner));
    const userOwns = owners.some((owner) => userTeams.has(owner));

    // Priority 0: User is ONLY owner and needs to approve (red ★ - on all labels)
    if (userOnlyOwner && !approved) return 0;

    // Priority 1: User is one of multiple owners and needs to approve (red ★ - one of several labels)
    if (userOwns && !approved) return 1;

    // Priority 2: User's teams that are approved (green ✓ ☆)
    if (userOwns && approved) return 2;
  }

  // Priority 3: Other teams that need approval (yellow no icon)
  if (!approved) return 3;

  // Priority 4: Other teams that are approved (green ✓)
  return 4;
};

const onClickFileGroupExpander = (event) => {
  const button = event.currentTarget;
  const wasExpanded = button.getAttribute('aria-expanded') === 'true';
  const isExpanded = !wasExpanded;

  event.preventDefault();
  event.stopPropagation();

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
  fileCountButton.addEventListener('click', onClickFileGroupExpander);

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
  });

  labels.forEach((label) => labelsDiv.appendChild(label));

  listDiv.appendChild(labelsDiv);

  // Wrap file list in expandable structure (default collapsed)
  const filesWrapper = document.createElement('div');
  filesWrapper.classList.add('ghco-files-wrapper');

  const filesContent = document.createElement('div');
  filesContent.classList.add('ghco-files-content');

  // Get PR info synchronously from the URL for file links
  const {owner, repo, num} = github.getPrInfo();

  paths.forEach((path, index) => {
    const fileLink = document.createElement('a');
    fileLink.href = `https://github.com/${owner}/${repo}/pull/${num}/files#diff-${digests[index]}`;
    fileLink.textContent = path;
    fileLink.classList.add('ghco-merge-box-file-link');
    filesContent.appendChild(fileLink);
  });

  filesWrapper.appendChild(filesContent);
  listDiv.appendChild(filesWrapper);
  return listDiv;
};
