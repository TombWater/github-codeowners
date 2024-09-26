'use strict';

import './content.css';
import {tokenStorage} from './storage';

// For more information on Content Scripts,
// See https://developer.chrome.com/extensions/content_scripts

const decorateFileHeader = (node) => {
  node.classList.add('approved');
};


const getPrInfo = () => {
  const url = window.location.href;
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\/files/);
  if (!match) {
    return null;
  }
  return {
    user: match[1],
    repo: match[2],
    num: match[3],
   };
};

let cachedLastFileHeader;

const getFileHeadersForDecoration = () => {
  const fileHeaders = document.querySelectorAll('div.file-header');
  if (fileHeaders.length === 0  || cachedLastFileHeader === fileHeaders[fileHeaders.length - 1]) {
    return [];
  }
  cachedLastFileHeader = fileHeaders[fileHeaders.length - 1];
  return fileHeaders;
}

let cachedReviews = {};

const getReviews = async (pr) => {
  const token = await tokenStorage.get();
  console.log('Token', token);

  const url = `https://api.github.com/repos/${pr.user}/${pr.repo}/pulls/${pr.num}/reviews`;
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (cachedReviews.url === url && cachedReviews.token === token) {
    return cachedReviews.reviews;
  }

  const response = await fetch(url, {headers});
  const reviews = await response.json();

  cachedReviews = {url, token, reviews};
  return reviews;
};

// If we are on a PR files page, check which files have been approved
const checkPrFilesPage = async () => {
  const pr = getPrInfo();
  console.log('PR', pr);
  if (!pr) {
    return;
  }

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

  // TODO: Use reviews to decorate file headers
  fileHeaders.forEach(decorateFileHeader);
};

// Potentially refresh after every mutation, with debounce
let mutationTimeout;
const observer = new MutationObserver((_mutations) => {
  clearTimeout(mutationTimeout);
  mutationTimeout = setTimeout(checkPrFilesPage, 200);
});
observer.observe(document.body, { childList: true, subtree: true });
