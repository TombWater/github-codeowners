import * as github from './github';
import iconSvg from '../public/icons/icon.svg';
import chevronUpSvg from './chevron-up.svg';
import {getPrOwnershipData} from './ownership';
import {createOwnerLabels} from './labels';

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

const findCssomClassName = (pattern) => {
  for (const styleSheet of document.styleSheets) {
    try {
      for (const rule of styleSheet.cssRules || styleSheet.rules) {
        if (rule.selectorText) {
          const match = rule.selectorText.match(pattern);
          if (match) {
            return match[1]; // Return the class name without the dot
          }
        }
      }
    } catch (e) {
      // Skip stylesheets that can't be accessed (e.g., cross-origin)
      continue;
    }
  }
  return null;
};

const findExpandedClassName = () =>
  findCssomClassName(
    /\.(MergeBoxExpandable-module__isExpanded--[a-zA-Z0-9_-]+)/
  );

const findWrapperClassName = () =>
  findCssomClassName(
    /\.(MergeBoxSectionHeader-module__wrapper--[a-zA-Z0-9_-]+)/
  );

const findWrapperCanExpandClassName = () =>
  findCssomClassName(
    /\.(MergeBoxSectionHeader-module__wrapperCanExpand--[a-zA-Z0-9_-]+)/
  );

const findExpandableWrapperClassName = () =>
  findCssomClassName(
    /\.(MergeBoxExpandable-module__expandableWrapper--[a-zA-Z0-9_-]+)/
  );

const findExpandableContentClassName = () =>
  findCssomClassName(
    /\.(MergeBoxExpandable-module__expandableContent--[a-zA-Z0-9_-]+)/
  );

const findButtonClassName = () =>
  findCssomClassName(
    /\.(MergeBoxSectionHeader-module__button--[a-zA-Z0-9_-]+)/
  );

// Update the merge box section with owner groups
export const updateMergeBox = async () => {
  const pr = github.getPrInfo();
  const mergeBox = document.querySelector('div[class*="MergeBox-module"]');
  if (!mergeBox) {
    return;
  }

  let section = mergeBox.querySelector('section[aria-label="Code owners"]');

  if (!section) {
    // No existing section, create new one with loading state immediately
    console.log('[GHCO] Decorate merge box', pr);
    section = createLoadingMergeBoxSection(mergeBox, pr.isMerged);
    if (!section) {
      return;
    }
  }

  // Async load ownership then update the section
  const [ownershipData, diffFilesMap] = await Promise.all([
    getPrOwnershipData(),
    github.getDiffFilesMap(),
  ]);

  // Check if state changed (to avoid infinite loop)
  const state = Array.from(ownershipData?.ownerApprovals ?? []).sort();
  state.unshift(pr.isMerged ? 'MERGED' : 'UNMERGED');
  const newState = state.join(',');

  if (section.dataset.state === newState) {
    return; // No changes, skip update
  }

  section.dataset.state = newState;

  if (!ownershipData || !diffFilesMap || diffFilesMap.size === 0) {
    const description = section.querySelector('p');
    if (description) {
      description.textContent = ownershipData ? 'No files to review' : 'No CODEOWNERS file found';
    }
    return;
  }

  const {folderOwners} = ownershipData;

  const ownerGroupsMap = createOwnerGroupsMap(diffFilesMap, folderOwners);
  updateMergeBoxSectionWithContent(section, {
    pr,
    ownerGroupsMap,
    ownershipData,
  });
};

const createHeaderIcon = (approvalStatus, isMerged) => {
  const iconWrapper = document.createElement('div');
  iconWrapper.classList.add('mr-2', 'flex-shrink-0');

  const iconCircle = document.createElement('div');
  iconCircle.style.cssText =
    'overflow: hidden; border-width: 0px; border-radius: 50%; border-style: solid; border-color: var(--borderColor-default); width: 32px; height: 32px;';

  const iconInner = document.createElement('div');

  // Determine the color based on merge status and approval status
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

  iconInner.style.cssText = `
    ${iconInner.style.cssText || ''}
    display: flex;
    width: 32px;
    height: 32px;
    align-items: center;
    justify-content: center;
  `.trim();

  // Extension icon SVG (GitHub octocat with checkmarks)
  const svgString = iconSvg.replace(/<\?xml[^?]*\?>\s*/g, '');
  const parser = new DOMParser();
  const svgDoc = parser.parseFromString(svgString, 'image/svg+xml');
  const svg = svgDoc.documentElement;
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
  const existingHeading = document.querySelector(
    'div[class*="MergeBox-module"] section h3[class*="MergeBoxSectionHeading"]'
  );
  if (existingHeading) {
    heading.className = existingHeading.className;
  } else {
    console.info('[GHCO] Could not find existing heading to copy classes from');
  }
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

const getSavedExpandState = () => {
  const saved = sessionStorage.getItem(getExpandStateKey()) ?? 'false';
  return saved === 'true';
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

const createMergeBoxSectionHeader = (
  expandedClassName,
  approvalStatus,
  isMerged
) => {
  const header = document.createElement('div');

  // Use CSSOM to find GitHub's wrapper class
  const wrapperClassName = findWrapperClassName();
  const wrapperCanExpandClassName = expandedClassName
    ? findWrapperCanExpandClassName()
    : null;

  if (wrapperClassName) {
    header.classList.add(wrapperClassName);
    if (wrapperCanExpandClassName) {
      header.classList.add(wrapperCanExpandClassName);
    }
  } else {
    console.info('[GHCO] Could not find wrapper class via CSSOM');
  }

  const wrapper = document.createElement('div');
  wrapper.classList.add('d-flex', 'width-full');

  const headerContent = document.createElement('div');
  headerContent.classList.add('d-flex', 'width-full');

  headerContent.appendChild(createHeaderIcon(approvalStatus, isMerged));
  headerContent.appendChild(createHeaderText(approvalStatus));
  wrapper.appendChild(headerContent);

  // If we can't find the expanded class name, gracefully degrade to a non-expandable header
  if (expandedClassName) {
    const isExpanded = getSavedExpandState();

    const expandButton = document.createElement('button');
    expandButton.setAttribute('aria-label', 'Code owners');
    expandButton.setAttribute('type', 'button');
    expandButton.setAttribute('aria-expanded', isExpanded.toString());

    // Use CSSOM to find GitHub's button class
    const buttonClassName = findButtonClassName();
    if (buttonClassName) {
      expandButton.classList.add(buttonClassName);
    } else {
      console.info('[GHCO] Could not find button class via CSSOM');
    }

    expandButton.dataset.expandedClassName = expandedClassName;
    expandButton.addEventListener('click', onClickHeader);
    wrapper.appendChild(expandButton);

    const chevronContainer = document.createElement('div');
    chevronContainer.className = 'fgColor-muted pr-2 pt-2';

    const chevronWrapper = document.createElement('div');
    chevronWrapper.style.transition = 'transform 0.15s ease-in-out';
    chevronWrapper.style.transform = `rotate(${isExpanded ? 0 : 180}deg)`;
    chevronWrapper.innerHTML = chevronUpSvg;

    chevronContainer.appendChild(chevronWrapper);
    wrapper.appendChild(chevronContainer);
  }

  header.appendChild(wrapper);

  return header;
};

const createMergeBoxOwnerGroupsContent = (
  ownerGroupsMap,
  pr,
  ownershipData
) => {
  const content = document.createElement('div');
  content.classList.add('ghco-merge-box-container', 'px-3', 'pb-3');

  const {userTeams, ownerApprovals} = ownershipData;

  // Sort groups by relevance to current user:
  // Within each priority, sort by number of files (descending)
  const sortedGroups = Array.from(ownerGroupsMap.entries()).sort(
    ([, a], [, b]) => {
      const aPriority = getMergeBoxOwnerGroupPriority(
        a,
        userTeams,
        ownerApprovals
      );
      const bPriority = getMergeBoxOwnerGroupPriority(
        b,
        userTeams,
        ownerApprovals
      );

      if (aPriority !== bPriority) return aPriority - bPriority;
      return b.paths.length - a.paths.length;
    }
  );

  sortedGroups.forEach(([, {owners, paths, digests}]) => {
    content.appendChild(
      createMergeBoxOwnerGroup({
        pr,
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
  expandedClassName
) => {
  const expandableWrapper = document.createElement('div');
  const wrapperClassName = findExpandableWrapperClassName();

  if (wrapperClassName) {
    expandableWrapper.classList.add(wrapperClassName);
  } else {
    console.info('[GHCO] Could not find expandable wrapper class via CSSOM');
  }
  expandableWrapper.style.visibility = 'visible';

  const expandableContent = document.createElement('div');
  const contentClassName = findExpandableContentClassName();

  if (contentClassName) {
    expandableContent.classList.add(contentClassName);
  } else {
    console.info('[GHCO] Could not find expandable content class via CSSOM');
  }

  if (expandedClassName) {
    const isExpanded = getSavedExpandState();
    expandableContent.classList.toggle(expandedClassName, isExpanded);
    expandableWrapper.classList.toggle(expandedClassName, isExpanded);
  }

  expandableContent.appendChild(ownerGroupsContent);

  expandableWrapper.appendChild(expandableContent);

  return expandableWrapper;
};

// Create the merge box section in loading state
const createLoadingMergeBoxSection = (mergeBox, isMerged) => {
  // Find the container to insert into
  const container = mergeBox.querySelector(
    'div[class*="MergeBox-module__mergeBoxAdjustBorders"], div.border.rounded-2'
  );
  if (!container) {
    console.info('[GHCO] Could not find merge box container');
    return null;
  }

  // Create the section
  const section = document.createElement('section');
  section.setAttribute('aria-label', 'Code owners');

  // Check if there are existing sections to determine border styling
  const existingSections = Array.from(container.querySelectorAll('section'));

  section.classList.add(
    existingSections.length > 0 ? 'border-bottom' : 'border-top',
    'color-border-subtle'
  );

  // Create header WITHOUT expand functionality (no expandedClassName passed)
  const sectionHeader = createMergeBoxSectionHeader(null, null, isMerged);
  section.appendChild(sectionHeader);

  // Find the element to insert before, or undefined to append at the end
  const reviewsSection = mergeBox.querySelector(
    'section[aria-label="Reviews"]'
  );
  const firstSection = existingSections[0];
  const insertBefore = reviewsSection?.nextSibling || firstSection;

  // Insert the section at the appropriate location
  if (insertBefore) {
    container.insertBefore(section, insertBefore);
  } else {
    container.appendChild(section);
  }

  return section;
};

const calculateApprovalStatus = (ownerGroupsMap, ownerApprovals) => {
  if (!ownerGroupsMap || !ownerApprovals) return null;

  let approvalsReceived = 0;
  let totalApprovalsNeeded = 0;

  for (const [, group] of ownerGroupsMap.entries()) {
    if (group.owners && group.owners.size > 0) {
      totalApprovalsNeeded++;
      const hasApproval = Array.from(group.owners).some((owner) =>
        ownerApprovals.has(owner)
      );
      if (hasApproval) {
        approvalsReceived++;
      }
    }
  }

  return {approvalsReceived, totalApprovalsNeeded};
};

// Update the section with actual content after data is loaded
const updateMergeBoxSectionWithContent = (
  section,
  {pr, ownerGroupsMap, ownershipData}
) => {
  const expandedClassName = findExpandedClassName();

  // Set aria-describedby only after loading to avoid screen readers announcing the brief loading state
  section.setAttribute('aria-describedby', APPROVALS_DESCRIPTION_ID);

  // Replace the header with an updated one
  const existingHeader = section.querySelector(
    'div[class*="MergeBoxSectionHeader"]'
  );
  if (existingHeader) {
    const approvalStatus = calculateApprovalStatus(
      ownerGroupsMap,
      ownershipData.ownerApprovals
    );
    const newHeader = createMergeBoxSectionHeader(
      expandedClassName,
      approvalStatus,
      pr.isMerged
    );
    section.replaceChild(newHeader, existingHeader);
  }

  // Remove existing expandable content if present
  section.querySelector('div[class*="__expandableWrapper"]')?.remove();

  // Add the new expandable content to the section
  const ownerGroupsContent = createMergeBoxOwnerGroupsContent(
    ownerGroupsMap,
    pr,
    ownershipData
  );

  const sectionContent = createMergeBoxSectionContent(
    ownerGroupsContent,
    expandedClassName
  );
  section.appendChild(sectionContent);

  console.log(
    '[GHCO] Updated merge box section with content:',
    ownerGroupsMap.size,
    'groups'
  );
};

const getMergeBoxOwnerGroupPriority = (group, userTeams, ownerApprovals) => {
  // If there are no specific owners, use user's teams since they are "any reviewer" who can approve
  const owners = Array.from(group.owners || userTeams);

  const userOnlyOwner = owners.every((owner) => userTeams.has(owner));
  const userOwns = owners.some((owner) => userTeams.has(owner));
  const approved = group.owners
    ? // Specific owners: check if any owner approved
      owners.some((owner) => ownerApprovals.has(owner))
    : // Any reviewer: check if anyone approved
      ownerApprovals.size > 0;

  // Priority 0: User is ONLY owner and needs to approve (red ★ - on all labels)
  if (userOnlyOwner && !approved) return 0;

  // Priority 1: User is one of multiple owners and needs to approve (red ★ - one of several labels)
  if (userOwns && !approved) return 1;

  // Priority 2: User's teams that are approved (green ✓ ☆)
  if (userOwns && approved) return 2;

  // Priority 3: Other teams that need approval (yellow no icon)
  if (!approved) return 3;

  // Priority 4: Other teams that are approved (green ✓)
  return 4;
};

const createMergeBoxOwnerGroup = ({
  pr,
  owners,
  paths,
  digests,
  ownershipData,
}) => {
  const listDiv = document.createElement('div');
  listDiv.classList.add('ghco-merge-box-owner-group');

  // Create owner labels section with file count
  const labelsDiv = document.createElement('div');
  labelsDiv.classList.add('ghco-merge-box-labels');

  // Add file count before labels
  const fileCountContainer = document.createElement('span');
  fileCountContainer.classList.add('ghco-file-count-container');

  const fileCount = document.createElement('span');
  fileCount.classList.add('Counter');
  fileCount.textContent = paths.length;
  fileCountContainer.appendChild(fileCount);

  const fileText = document.createElement('span');
  fileText.classList.add('ghco-file-text');
  fileText.textContent = paths.length === 1 ? 'file' : 'files';
  fileCountContainer.appendChild(fileText);

  labelsDiv.appendChild(fileCountContainer);

  const labels = createOwnerLabels({
    owners,
    ownershipData,
  });

  labels.forEach((label) => labelsDiv.appendChild(label));

  listDiv.appendChild(labelsDiv);

  // Create file links section
  const filesDiv = document.createElement('div');
  filesDiv.classList.add('ghco-merge-box-files-list');

  paths.forEach((path, index) => {
    const fileLink = document.createElement('a');
    fileLink.href = `https://github.com/${pr.owner}/${pr.repo}/pull/${pr.num}/files#diff-${digests[index]}`;
    fileLink.textContent = path;
    fileLink.classList.add('ghco-merge-box-file-link');
    filesDiv.appendChild(fileLink);
  });

  listDiv.appendChild(filesDiv);
  return listDiv;
};
