import ignore from 'ignore';
import {memoize} from 'lodash-es';

import './content.css';
import {tokenStorage} from './storage';

// Cache just one key-value pair to refresh data when the key changes.
class CacheOneKey {
  constructor() {
    this.clear();
  }

  clear() {
    this.key = undefined;
    this.value = undefined;
  }

  delete(key) {
    if (this.key === key) {
      this.clear();
    }
  }

  get(key) {
    return this.key === key ? this.value : undefined;
  }

  has(key) {
    return this.key === key;
  }

  set(key, value) {
    this.key = key;
    this.value = value;
    return this;
  }
}

memoize.Cache = CacheOneKey;

export const getPrInfo = () => {
  const url = window.location.href;
  const match = url.match(
    /github\.com\/([^/]+)\/([^/]+)(\/pull\/(\d+)(\/([^/]+))?)?/
  );

  // Return null when not on a PR page
  if (!match) {
    return null;
  }
  let owner, repo, num, page;
  [, owner, repo, , num, , page] = match;

  return {
    owner,
    repo,
    num,
    page,
  };
};

const headersKey = () => window.location.href;
const apiHeaders = memoize(async () => {
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
}, headersKey);

const reviewsKey = () => window.location.href;
export const getReviews = memoize(async () => {
  const pr = getPrInfo();
  if (pr?.page !== 'files') {
    return [];
  }
  const url = `https://api.github.com/repos/${pr.owner}/${pr.repo}/pulls/${pr.num}/reviews`;
  const headers = await apiHeaders();

  const response = await fetch(url, {headers});
  const reviews = await response.json();
  return Array.isArray(reviews) ? reviews : [];
}, reviewsKey);

const ownersKey = () => {
  const pr = getPrInfo();
  return pr ? `${pr.owner}/${pr.repo}` : '';
};
export const getFolderOwners = memoize(async () => {
  const pr = getPrInfo();
  if (!pr) {
    return [];
  }
  const paths = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'];

  const headers = await apiHeaders();

  for (const path of paths) {
    const url = `https://api.github.com/repos/${pr.owner}/${pr.repo}/contents/${path}`;
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

      return folders.reverse();
    }
  }
  return [];
}, ownersKey);
