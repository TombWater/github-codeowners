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

const decorateFileHeader = (
  node,
  {folderOwners, ownerApprovals, userTeams, teamMembers}
) => {
  const path = node.dataset.path;
  const {owners} = folderOwners.find(({folderMatch}) =>
    // ignores() means it matches, as it's meant to match in .gitignore files
    folderMatch.ignores(path)
  );

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
  owners.forEach((owner) => {
    const label = document.createElement('span');
    const userOwns = userTeams.has(owner);
    const approved = ownerApprovals.has(owner);
    const star = approved ? '☆' : '★';

    label.classList.add('owners-label');
    label.classList.toggle('owners-label--user', userOwns);
    label.classList.toggle('owners-label--approved', approved);

    label.textContent = `${owner}${userOwns ? ` ${star}` : ''}`;
    label.dataset.owner = owner;

    const tooltip = teamMembers.get(owner).join('\n');
    if (tooltip) {
      label.classList.add('tooltipped', 'tooltipped-s');
      label.setAttribute('aria-label', tooltip);
    }

    label.addEventListener('click', onClickOwner);
    decoration.appendChild(label);
  });
  node.parentNode.insertBefore(decoration, node.nextSibling);
};

let cachedLastFileHeader;

const getFileHeadersForDecoration = () => {
  const fileHeaders = document.querySelectorAll('div.file-header');
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

let alreadySawOnePr = false;

// If we are on a PR files page, check which files have been approved
const checkPrFilesPage = async () => {
  const fileHeaders = getFileHeadersForDecoration();
  // Don't do anything until the first time we're on a PR files page
  if (!alreadySawOnePr && fileHeaders.length === 0) {
    return;
  }
  alreadySawOnePr = true;

  // Owners is cached, so get it every time to invalidate the cache when needed
  const folderOwners = await github.getFolderOwners();

  // Bail out if the repo doesn't have a CODEOWNERS file
  if (folderOwners.length === 0) {
    return;
  }

  // Get these every time to invalidate their cache when needed
  let reviews, teamMembers;
  [reviews, teamMembers] = await Promise.all([
    github.getReviews(),
    github.getTeamMembers(folderOwners),
  ]);

  const userTeamsMap = github.getUserTeamsMap(teamMembers);
  const ownerApprovals = await github.getOwnerApprovals(reviews, userTeamsMap);
  const userTeams = new Set(userTeamsMap.get(getUserLogin()) ?? []);

  fileHeaders.forEach((node) =>
    decorateFileHeader(node, {
      folderOwners,
      ownerApprovals,
      userTeams,
      teamMembers,
    })
  );
};

// Potentially refresh after every mutation, with debounce
const observer = new MutationObserver(debounce(checkPrFilesPage, 100));
observer.observe(document.body, {childList: true, subtree: true});
