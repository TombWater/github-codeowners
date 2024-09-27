'use strict';

import {debounce} from 'lodash-es';

import './content.css';

import {
  getReviews,
  getFolderOwners,
  getApprovals,
  getTeamMembers,
} from './github';

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
      `.owners-team[data-owner="${owner}"]`
    );
    toggleOpen(container, open);
  });
};

const decorateFileHeader = (node, folderOwners, teamApprovals) => {
  const path = node.dataset.path;
   // ignore() is a function from the ignore package, meant to match in .gitignore style
  const {teams} = folderOwners.find(({folderMatch}) => folderMatch.ignores(path));

  node.parentNode
    .querySelectorAll('.owners-decoration')
    .forEach((decoration) => {
      decoration.remove();
    });

  if (!teams) {
    return;
  }

  const decoration = document.createElement('div');
  decoration.classList.add('owners-decoration', 'js-skip-tagsearch');
  teams.forEach((team) => {
    const span = document.createElement('span');
    span.classList.add('owners-team');
    if (teamApprovals.has(team)) {
      span.classList.add('owners-team-approved');
    }
    span.textContent = team;
    span.dataset.owner = team;
    span.addEventListener('click', (ev) => {
      const oldTop = ev.target.getBoundingClientRect().top;
      expandOwnerFiles(team);
      const newTop = ev.target.getBoundingClientRect().top;
      const top = window.scrollY + newTop - oldTop;
      window.scrollTo({top});
    });
    decoration.appendChild(span);
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
  const folderOwners = await getFolderOwners();

  // Bail out if the repo doesn't have a CODEOWNERS file
  if (folderOwners.length === 0) {
    return;
  }

  // Reviews and team members are cached, so get them every time to invalidate the cache when needed
  let reviews, teamMembers;
  [reviews, teamMembers] = await Promise.all([
    getReviews(),
    getTeamMembers(folderOwners),
  ]);

  const approvals = await getApprovals(reviews, teamMembers);

  fileHeaders.forEach((node) =>
    decorateFileHeader(node, folderOwners, approvals.teams)
  );
};

// Potentially refresh after every mutation, with debounce
const observer = new MutationObserver(debounce(checkPrFilesPage, 100));
observer.observe(document.body, {childList: true, subtree: true});
