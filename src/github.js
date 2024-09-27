import ignore from 'ignore';

import './content.css';
import {tokenStorage} from './storage';

export const getPrInfo = () => {
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

export const getReviews = async (pr) => {
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

export const getOwnersMatchers = async (pr) => {
  if (ownersCache) {
    return ownersCache;
  }

  const paths = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'];

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
