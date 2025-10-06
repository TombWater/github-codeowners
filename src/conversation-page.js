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

const findExpandedClassName = () => {
  for (const styleSheet of document.styleSheets) {
    try {
      for (const rule of styleSheet.cssRules || styleSheet.rules) {
        if (rule.selectorText) {
          const match = rule.selectorText.match(
            /\.(MergeBoxExpandable-module__isExpanded--[a-zA-Z0-9_-]+)/
          );
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

// Update the merge box section with owner groups
export const updateMergeBox = async () => {
  const pr = github.getPrInfo();

  const priorSection = document.querySelector('section[aria-label="Reviews"]');
  if (
    !priorSection ||
    priorSection.parentNode.querySelector('section[aria-label="Code owners"]')
  ) {
    return;
  }

  console.log('[GHCO] Decorate merge box', pr);

  // Show loading state immediately
  const section = createLoadingMergeBoxSection(priorSection);

  // Async load ownership then update the section
  const [ownershipData, diffFilesMap] = await Promise.all([
    getPrOwnershipData(),
    github.getDiffFilesMap(),
  ]);
  if (!ownershipData || !diffFilesMap || diffFilesMap.size === 0) {
    const description = section.querySelector('p');
    if (description) {
      if (!ownershipData) {
        description.textContent = 'No CODEOWNERS file found';
      } else {
        description.textContent = 'No files to review';
      }
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

const createHeaderIcon = (approvalStatus) => {
  const iconWrapper = document.createElement('div');
  iconWrapper.classList.add('mr-2', 'flex-shrink-0');

  const iconCircle = document.createElement('div');
  iconCircle.style.cssText =
    'overflow: hidden; border-width: 0px; border-radius: 50%; border-style: solid; border-color: var(--borderColor-default); width: 32px; height: 32px;';

  const iconInner = document.createElement('div');
  iconInner.classList.add('bgColor-neutral-muted');
  if (approvalStatus) {
    const allApproved =
      approvalStatus.approvalsReceived === approvalStatus.totalApprovalsNeeded;
    iconInner.classList.add(allApproved ? 'fgColor-success' : 'fgColor-danger');
  }
  iconInner.style.cssText =
    'display: flex; width: 32px; height: 32px; align-items: center; justify-content: center;';

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

  if (approvalStatus) {
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
    console.warn('[GHCO] Could not find existing heading to copy classes from');
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

const createMergeBoxSectionHeader = (expandedClassName, approvalStatus) => {
  const existingHeader = document.querySelector(
    'div[class*="MergeBox-module"] section > div[class*="MergeBoxSectionHeader-module__wrapper"]'
  );

  const header = document.createElement('div');
  if (existingHeader) {
    header.className = existingHeader.className;
  } else {
    console.warn('[GHCO] Could not find existing header to copy classes from');
  }

  const wrapper = document.createElement('div');
  wrapper.classList.add('d-flex', 'width-full');

  const headerContent = document.createElement('div');
  headerContent.classList.add('d-flex', 'width-full');

  headerContent.appendChild(createHeaderIcon(approvalStatus));
  headerContent.appendChild(createHeaderText(approvalStatus));
  wrapper.appendChild(headerContent);

  // If we can't find the expanded class name, gracefully degrade to a non-expandable header
  if (expandedClassName) {
    const isExpanded = getSavedExpandState();

    const existingButton = document.querySelector(
      'div[class*="MergeBox-module"] section button[class*="MergeBoxSectionHeader-module__button"]'
    );

    const expandButton = document.createElement('button');
    expandButton.setAttribute('aria-label', 'Code owners');
    expandButton.setAttribute('type', 'button');
    expandButton.setAttribute('aria-expanded', isExpanded.toString());
    if (existingButton) {
      expandButton.className = existingButton.className;
    } else {
      console.warn('[GHCO] Could not find existing button to copy classes from');
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
  const mergeBox = document.querySelector('div[class*="MergeBox-module"]');

  const expandableWrapper = document.createElement('div');
  const existingExpandable = mergeBox?.querySelector(
    'div[class*="MergeBoxExpandable-module__expandableWrapper"]'
  );

  if (existingExpandable) {
    expandableWrapper.classList.add(...existingExpandable.classList);
  } else {
    console.warn(
      '[GHCO] Could not find existing expandable wrapper to copy classes from'
    );
  }
  expandableWrapper.style.visibility = 'visible';

  const expandableContent = document.createElement('div');
  const existingContent = mergeBox?.querySelector(
    'div[class*="MergeBoxExpandable-module__expandableContent"]'
  );

  if (existingContent) {
    expandableContent.classList.add(...existingContent.classList);
  } else {
    console.warn(
      '[GHCO] Could not find existing expandable content to copy classes from'
    );
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
const createLoadingMergeBoxSection = (priorSection) => {
  const section = document.createElement('section');
  section.classList.add('border-bottom', 'color-border-subtle');
  section.setAttribute('aria-label', 'Code owners');

  // Create header WITHOUT expand functionality (no expandedClassName passed)
  const sectionHeader = createMergeBoxSectionHeader(null, null);
  section.appendChild(sectionHeader);

  priorSection.parentNode.insertBefore(section, priorSection.nextSibling);
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

  // Replace the loading header with an expandable one
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
      approvalStatus
    );
    section.replaceChild(newHeader, existingHeader);
  }

  // Add the expandable content to the section
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

  // Create owner labels section
  const labelsDiv = document.createElement('div');
  labelsDiv.classList.add('ghco-merge-box-labels');

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
