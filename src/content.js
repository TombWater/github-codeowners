'use strict';

import {debounce} from 'lodash-es';

import './content.css';
import * as github from './github';

const toggleOpen = (container, open) => {
  container.classList.toggle('open', open);
  container.classList.toggle('Details--on', open);

  const containerTargets = [
    ...container.querySelectorAll('.js-details-target'),
  ].filter((target) => target.closest('.js-details-container') === container);
  for (const target of containerTargets) {
    target.setAttribute('aria-expanded', open.toString());
    const ariaLabel = target.getAttribute(
      `data-aria-label-${open ? 'open' : 'closed'}`
    );
    if (ariaLabel) {
      target.setAttribute('aria-label', ariaLabel);
    }
  }
};

const expandOwnerFiles = (owner) => {
  const containers = document.querySelectorAll('div.file');
  containers.forEach((container) => {
    const open = !!container.querySelector(
      `.owners-label[data-owner="${owner}"]`
    );
    toggleOpen(container, open);
  });
};

const onClickOwner = (ev) => {
  const oldTop = ev.target.getBoundingClientRect().top;
  expandOwnerFiles(ev.target.dataset.owner);
  const newTop = ev.target.getBoundingClientRect().top;
  const top = window.scrollY + newTop - oldTop;
  window.scrollTo({top});
};

const createLabel = (owner, {userOwns, approved, members, reviewers}) => {
  const label = document.createElement('span');
  const checkmark = approved ? '✓ ' : '';
  const star = !userOwns ? '' : approved ? ' ☆' : ' ★';

  label.classList.add('owners-label');
  label.classList.toggle('owners-label--user', userOwns);
  label.classList.toggle('owners-label--approved', approved);

  label.textContent = `${checkmark}${owner}${star}`;
  label.dataset.owner = owner;

  const tooltip = members?.map((member) => {
      const memberCheckmark = reviewers.get(member) ? '  ✓\t' : '\t';
      return `${approved ? memberCheckmark : ''}${member}`;
    }).join('\n');
  if (tooltip) {
    label.classList.add('tooltipped', 'tooltipped-s');
    label.setAttribute('aria-label', tooltip);
  }

  label.addEventListener('click', onClickOwner);
  return label;
};

const decorateFileHeader = (
  node,
  {reviewers, folderOwners, ownerApprovals, userTeams, teamMembers, diffFilesMap}
) => {
  const link = node?.dataset.anchor || node.querySelector('[class^="DiffFileHeader-module__file-name"] a')?.href;
  const digest = link?.split('diff-')[1];
  const path = diffFilesMap.get(digest);
  if (!path) {
    console.log('[GHCO] No path found for file header', node);
    return;
  }
  const {owners} = folderOwners.find(({folderMatch}) =>
    // ignores() means it matches, as it's meant to match in .gitignore files
    folderMatch.ignores(path)
  );
  console.log('[GHCO] File', path, owners);

  // Remove any previous owners decoration
  node.parentNode
    .querySelectorAll('.owners-decoration')
    .forEach((decoration) => {
      decoration.remove();
    });

  if (!owners) {
    return;
  }

  // Create the new owners decoration containing labels for each owner
  const decoration = document.createElement('div');
  decoration.classList.add('owners-decoration', 'js-skip-tagsearch');
  if (owners.size) {
    owners.forEach((owner) => {
      const userOwns = userTeams.has(owner);
      const approved = ownerApprovals.has(owner);
      const members = teamMembers.get(owner);

      const label = createLabel(owner, {userOwns, approved, members, reviewers});
      decoration.appendChild(label);
    });
  } else {
    const userOwns = true;
    const approved = ownerApprovals.size > 0;
    const members = Array.from(reviewers.keys());

    const label = createLabel('anybody', {userOwns, approved, members, reviewers});
    decoration.appendChild(label);
  }
  node.parentNode.insertBefore(decoration, node.nextSibling);
};

let cachedLastFileHeader;

const getFileHeadersForDecoration = () => {
  const selectors = [
    // Old Files Changed page
    'div.file-header',
    // New Files Changed page
    'div[class^="Diff-module__diffHeaderWrapper"]',
  ];
  const fileHeaders = document.querySelectorAll(selectors.join(', '));
  if (
    fileHeaders.length === 0 ||
    cachedLastFileHeader === fileHeaders[fileHeaders.length - 1]
  ) {
    return [];
  }
  cachedLastFileHeader = fileHeaders[fileHeaders.length - 1];
  return fileHeaders;
};

const getUserLogin = () => {
  return document.head.querySelector('meta[name="user-login"]')?.content;
};

// If we are on a PR files page, update reviewer decorations on the files
const updatePrFilesPage = async () => {
  const fileHeaders = getFileHeadersForDecoration();

  // Don't do anything when not on a PR files page, or the files haven't changed
  if (fileHeaders.length === 0) {
    return;
  }
  console.log('[GHCO] Decorate PR', github.getPrInfo());

  // Owners is cached, so get it every time to invalidate the cache when needed
  const folderOwners = await github.getFolderOwners();

  // Bail out if the repo doesn't have a CODEOWNERS file
  if (folderOwners.length === 0) {
    return;
  }

  // Get these every time to invalidate their cache when needed
  let reviewers, teamMembers;
  [reviewers, teamMembers] = await Promise.all([
    github.getReviewers(),
    github.getTeamMembers(folderOwners),
  ]);

  // Map of users to a set of teams they are a member of
  const userTeamsMap = new Map();
  for (const [team, members] of teamMembers.entries()) {
    for (const member of members) {
      // Initialize the set with a pseudo-team that is the member's own login
      const teams = userTeamsMap.get(member) ?? new Set([member]);
      userTeamsMap.set(member, teams.add(team));
    }
  }

  // Set of owners/teams who approved the PR
  const ownerApprovals = new Set(
    Array.from(reviewers.entries())
      .filter(([, approved]) => approved)
      .flatMap(([approver]) => Array.from(userTeamsMap.get(approver)))
  );

  // Set of teams the current user is a member of
  const userTeams = new Set(userTeamsMap.get(getUserLogin()) ?? []);

  const diffFilesMap = await github.getDiffFilesMap();
  if (!diffFilesMap) {
    console.warn('[GHCO] No diff files found, cannot decorate file headers');
    return;
  }

  fileHeaders.forEach((node) =>
    decorateFileHeader(node, {
      reviewers,
      folderOwners,
      ownerApprovals,
      userTeams,
      teamMembers,
      diffFilesMap,
    })
  );
};

// Potentially refresh after every mutation, with debounce
const observer = new MutationObserver(debounce(updatePrFilesPage, 100));
observer.observe(document.body, {childList: true, subtree: true});

// Delete the disused access token that may still be in storage from the previous version
chrome.storage.local.remove('token');
