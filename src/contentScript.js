'use strict';

import './content.css';

import {getPrInfo, getReviews, getOwnersMatchers} from './github';

// For more information on Content Scripts,
// See https://developer.chrome.com/extensions/content_scripts

const decorateFileHeader = (node, folders) => {
  const path = node.dataset.path;
  const match = folders.find(({folderMatch}) => folderMatch.ignores(path));
  console.log('File Header', path, match.teams);

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

// If we are on a PR files page, check which files have been approved
const checkPrFilesPage = async () => {
  const pr = getPrInfo();
  console.log('PR', pr);
  if (!pr) {
    return;
  }

  const folderMatchers = await getOwnersMatchers(pr);
  console.log('Owners', folderMatchers);

  const fileHeaders = getFileHeadersForDecoration();
  console.log('File headers', fileHeaders);
  if (!fileHeaders) {
    return;
  }

  const reviews = await getReviews(pr);
  console.log('Reviews', reviews);
  if (!Array.isArray(reviews)) {
    return;
  }

  fileHeaders.forEach((node) => decorateFileHeader(node, folderMatchers));
};

// Potentially refresh after every mutation, with debounce
let mutationTimeout;
const observer = new MutationObserver((_mutations) => {
  clearTimeout(mutationTimeout);
  mutationTimeout = setTimeout(checkPrFilesPage, 200);
});
observer.observe(document.body, {childList: true, subtree: true});
