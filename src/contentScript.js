'use strict';
import ignore from 'ignore';

import './content.css';
import {tokenStorage} from './storage';

// For more information on Content Scripts,
// See https://developer.chrome.com/extensions/content_scripts

const decorateFileHeader = (node, folders) => {
  const path = node.dataset.path;
  const match = folders.find(({folderMatch}) => folderMatch.ignores(path));
  console.log('File Header', path, match.teams);

  node.parentNode.querySelectorAll('.owners-decoration').forEach((decoration) => {
    decoration.remove();
  });

  if (match) {
    const decoration = document.createElement('div');
    decoration.classList.add('owners-decoration');
    match.teams.forEach((team) => {
      const span = document.createElement('span');
      span.classList.add('owners-team');
      span.textContent = team;
      decoration.appendChild(span);
    });
    node.parentNode.insertBefore(decoration, node.nextSibling);
  }
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

const apiHeaders = async (pr) => {
  const token = await tokenStorage.get();
  console.log('Token', token);

  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
};

let cachedReviews = {};

const getReviews = async (pr) => {
  const url = `https://api.github.com/repos/${pr.user}/${pr.repo}/pulls/${pr.num}/reviews`;
  const headers = await apiHeaders(pr);
  const key = JSON.stringify({url, headers});

  if (cachedReviews.key === key) {
    return cachedReviews.reviews;
  }

  const response = await fetch(url, {headers});
  const reviews = await response.json();

  cachedReviews = {key, reviews};
  return reviews;
};

let ownersCache = null;

const getOwnersMatchers = async (pr) => {
  if (ownersCache) {
    return ownersCache;
  }

  const paths = [
    '.github/CODEOWNERS',
    'CODEOWNERS',
    'docs/CODEOWNERS',
  ];

  const headers = await apiHeaders(pr);

  for (const path of paths) {
    const url = `https://api.github.com/repos/${pr.user}/${pr.repo}/contents/${path}`;
    const response = await fetch(url, {headers});
    const file = await response.json();
    if (file.encoding === 'base64') {
      const codeowners = atob(file.content);
      const folders = [];
      for (const line of codeowners.split('\n')) {
          const trimmed = line.trim();

          if (!trimmed.length || trimmed.startsWith('#')) {
              continue;
          }

          const [folder, ...teams] = trimmed.split(/\s+/);

          folders.push({
              folderMatch: ignore().add(folder),
              teams: new Set(teams),
          });
      }

      ownersCache = folders.reverse();

      return ownersCache;
    }
  }
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
observer.observe(document.body, { childList: true, subtree: true });
