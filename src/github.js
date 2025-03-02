import ignore from 'ignore';
import {memoize} from 'lodash-es';

import './content.css';
import {tokenStorage} from './storage';

// Cache just one key-value pair to refresh data when the key changes.
memoize.Cache = function () {
  let key, value;
  const cache = {
    clear: () => (key = value = undefined),
    delete: (k) => key === k && ((key = value = undefined), true),
    has: (k) => key === k,
    get: (k) => (key === k ? value : undefined),
    set: (k, v) => ((key = k), (value = v), cache),
  };
  return cache;
};

const urlCacheKey = () => window.location.href;
const repoCacheKey = () => {
  const pr = getPrInfo();
  return pr.repo ? `${pr.owner}/${pr.repo}` : '';
};
const prCacheKey = () => {
  const pr = getPrInfo();
  return pr.num ? `${pr.owner}/${pr.repo}/${pr.num}` : '';
};

const loadPage = async (url) => {
  const response = await fetch(url, {credentials: "include"});
  if (!response.ok) {
    return null;
  }
  const text = await response.text();
  const doc = new DOMParser().parseFromString(text, 'text/html');
  return doc;
}

export const getPrInfo = () => {
  const url = window.location.href;
  const match = url.match(
    /github\.com\/([^/]+)\/([^/]+)(\/pull\/(\d+)(\/([^/]+))?)?/
  );

  let owner, repo, num, page;
  [, owner, repo, , num, , page] = match || {};

  const base = document.querySelector('#partial-discussion-header .base-ref')?.textContent;

  return {page, owner, repo, num, base};
};

const apiHeaders = memoize(async () => {
  const token = await tokenStorage.get();

  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}, urlCacheKey);

export const getApprovers = memoize(async () => {
  const pr = getPrInfo();
  if (pr.page !== 'files') {
    return [];
  }

  const url = `https://github.com/${pr.owner}/${pr.repo}/pull/${pr.num}`;
  const doc = await loadPage(url);
  const assigneeNodes = doc?.querySelectorAll('[data-assignee-name]');
  const approverNodes = Array.from(assigneeNodes || []).filter((assignee) => assignee.parentElement.querySelector('.octicon-check'));
  const approvers = approverNodes.map((assignee) => assignee.dataset.assigneeName);
  console.log('[GHCO] Approvers', approvers);
  return approvers;
}, urlCacheKey);

export const getFolderOwners = memoize(async () => {
  const pr = getPrInfo();
  if (!pr.num) {
    return [];
  }
  console.log('[GHCO] PR', pr);

  const paths = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'];
  for (const path of paths) {
    const url = `https://github.com/${pr.owner}/${pr.repo}/blob/${pr.base}/${path}`;
    const doc = await loadPage(url);
    if (!doc) {
      continue;
    }
    const jsonData = doc.querySelector('react-app[app-name="react-code-view"] [data-target="react-app.embeddedData"]')?.textContent;
    const data = JSON.parse(jsonData);
    const lines = data?.payload?.blob?.rawLines ?? [];
    const ownerLines = lines.map((line) => line.trim()).filter((line) => line.length && !line.startsWith('#'));
    console.log('[GHCO] CODEOWNERS', url, ownerLines);

    const folders = ownerLines.map((line) => {
      const [folder, ...owners] = line.split(/\s+/);
      return {
        folderMatch: ignore().add(folder),
        owners: new Set(owners),
      };
    });
    return folders.reverse();
  }
  return [];
}, prCacheKey);

export const getTeamMembers = memoize(async (folderOwners) => {
  const pr = getPrInfo();
  const {owner: org} = pr;
  if (!org) {
    return [];
  }
  const headers = await apiHeaders();

  // Array of all unique owner names mentioned in CODEOWNERS file
  const allOwners = Array.from(
    new Set(folderOwners.flatMap(({owners}) => Array.from(owners)))
  );

  // Filter out names that are not teams in the org owning the PR
  const prefix = `@${org}/`;
  const teamNames = allOwners.filter((teamName) => teamName.startsWith(prefix));

  // Fetch all org teams in parallel, mapping team names to their members
  const orgTeams = new Map(
    await Promise.all(
      teamNames.map(async (teamName) => {
        const teamSlug = teamName.replace(prefix, '');
        const url = `https://api.github.com/orgs/${org}/teams/${teamSlug}/members`;
        const response = await fetch(url, {headers});
        const members = await response.json();
        return [teamName, members];
      })
    )
  );

  // Map owner teams to an array of members, or if not a team then a pseudo-team with just the owner
  const owners = new Map(
    allOwners.map((owner) => {
      const members = orgTeams.get(owner);
      const logins = Array.isArray(members)
        ? members.map((member) => member.login)
        : [owner];
      return [owner, logins];
    })
  );

  return owners;
}, repoCacheKey);
