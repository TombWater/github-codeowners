'use strict';

import './content.css';

import {getPrInfo, getReviews, getFolderOwners} from './github';

// For more information on Content Scripts,
// See https://developer.chrome.com/extensions/content_scripts

const decorateFileHeader = (node, folders) => {
  const path = node.dataset.path;
  const match = folders.find(({folderMatch}) => folderMatch.ignores(path));

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

  // Owners and reviewers are cached, so get them every time in order to invalidate the cache as needed.
  const folderOwners = await getFolderOwners();
  if (folderOwners.length === 0) {
    return;
  }

  const reviews = await getReviews();
  if (reviews.length === 0) {
    return;
  }

  fileHeaders.forEach((node) => decorateFileHeader(node, folderOwners));
};

// Potentially refresh after every mutation, with debounce
let mutationTimeout;
const observer = new MutationObserver((_mutations) => {
  clearTimeout(mutationTimeout);
  mutationTimeout = setTimeout(checkPrFilesPage, 200);
});
observer.observe(document.body, {childList: true, subtree: true});
