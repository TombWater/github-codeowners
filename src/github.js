import ignore from 'ignore';
import {memoize} from 'lodash-es';

import './content.css';

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
const prBaseCacheKey = () => {
  const pr = getPrInfo();
  return pr.num ? `${pr.owner}/${pr.repo}/${pr.base}` : '';
};

// Swap the arguments to memoize to make it easier to see the cache key
const cacheResult = (cacheKey, fn) => memoize(fn, cacheKey);

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

  const base = document.querySelector('#partial-discussion-header .base-ref, #partial-discussion-header .commit-ref')?.textContent;

  return {page, owner, repo, num, base};
};

export const getReviewers = cacheResult(urlCacheKey, async () => {
  const pr = getPrInfo();
  const url = `https://github.com/${pr.owner}/${pr.repo}/pull/${pr.num}`;
  const doc = await loadPage(url);
  const reviewerNodes = doc?.querySelectorAll('[data-assignee-name], .js-reviewer-team');
  const reviewers = Array.from(reviewerNodes || []).reduce((acc, node) => {
    const statusIcon  = node.parentElement.querySelector('.reviewers-status-icon');
    if (statusIcon && !statusIcon.classList.contains('v-hidden')) {
      const name = node.dataset.assigneeName || node.textContent.trim();
      const approved = Boolean(statusIcon.querySelector('.octicon-check'));
      acc.set(name, approved);
    }
    return acc;
  }, new Map());
  console.log('[GHCO] Reviewers', reviewers);
  return reviewers;
});

export const getFolderOwners = cacheResult(prBaseCacheKey, async () => {
  const pr = getPrInfo();
  if (!pr.num || !pr.base) {
    return [];
  }

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
});

const loadTeamMembers = async (org, teamSlug) => {
  const teamMembers = [];
  for (let page = 1, hasNext = true; hasNext; page++) {
    const url = `https://github.com/orgs/${org}/teams/${teamSlug}?page=${page}`;
    const doc = await loadPage(url);
    const memberNodes = doc?.querySelectorAll('.member-list-item');
    const members = Array.from(memberNodes || []).map((member) => member.dataset.bulkActionsId);
    teamMembers.push(...members);

    const next = doc?.querySelector('.next_page');
    hasNext = next && !next.classList.contains('disabled');
  }
  return teamMembers;
};

export const getTeamMembers = cacheResult(repoCacheKey, async (folderOwners) => {
  const pr = getPrInfo();
  const {owner: org} = pr;
  if (!org) {
    return [];
  }

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
        const members = await loadTeamMembers(org, teamSlug);
        return [teamName, members];
      })
    )
  );

  // Map owner teams to an array of members, or if not a team then a pseudo-team with just the owner
  const owners = new Map(
    allOwners.map((teamName) => {
      const members = orgTeams.get(teamName) || [teamName];
      return [teamName, members];
    })
  );

  console.log('[GHCO] Teams', owners);
  return owners;
});

export const isBranchProtected = cacheResult(prBaseCacheKey, async () => {
  const pr = getPrInfo();
  const {owner, repo, base} = pr;

  if (!owner || !repo || !base) {
    console.warn('[GHCO] Branch protection: missing info, defaulting true.');
    return true;
  }

  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/branches/${base}/protection`;

  try {
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github.v3+json',
      },
      credentials: 'include',
    });

    if (response.status === 200) return true;
    if (response.status === 404) return false;
    console.error(`[GHCO] Branch protection API error: ${response.status} for ${apiUrl}`);
    return false;
  } catch (error) {
    console.error(`[GHCO] Branch protection fetch error: ${apiUrl}`, error);
    return false;
  }
});
