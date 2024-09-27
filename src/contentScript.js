'use strict';

import {debounce} from 'lodash-es';

import './content.css';

import {
  getReviews,
  getFolderOwners,
  getApprovals,
  getTeamMembers,
} from './github';

// For more information on Content Scripts,
// See https://developer.chrome.com/extensions/content_scripts

const decorateFileHeader = (node, folderOwners, teamApprovals) => {
  const path = node.dataset.path;
  const match = folderOwners.find(({folderMatch}) => folderMatch.ignores(path));

  node.parentNode
    .querySelectorAll('.owners-decoration')
    .forEach((decoration) => {
      decoration.remove();
    });

  if (match) {
    const decoration = document.createElement('div');
    decoration.classList.add('owners-decoration', 'js-skip-tagsearch');
    match.teams.forEach((team) => {
      const span = document.createElement('span');
      span.classList.add('owners-team');
      if (teamApprovals.has(team)) {
        span.classList.add('owners-team-approved');
      }
      span.classList.add('owners-team');
      span.textContent = team;
      decoration.appendChild(span);
    });
    node.parentNode.insertBefore(decoration, node.nextSibling);
  }
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
