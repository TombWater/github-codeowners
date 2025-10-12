import ignore from 'ignore';
import {memoize} from 'lodash-es';

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
  const response = await fetch(url, {credentials: 'include'});
  if (!response.ok) {
    return null;
  }
  const text = await response.text();
  const doc = new DOMParser().parseFromString(text, 'text/html');
  return doc;
};

export const getPrInfo = () => {
  const url = window.location.href;
  const match = url.match(
    /github\.com\/([^/]+)\/([^/]+)(\/pull\/(\d+)(\/([^/]+))?)?/
  );

  let owner, repo, num, page;
  [, owner, repo, , num, , page] = match || {};

  const selectors = [
    // Old Files Changed page
    '#partial-discussion-header .base-ref',
    '#partial-discussion-header .commit-ref',
    // New Files Changed page
    'div[class*="PageHeader-Description"] a[class*="BranchName-BranchName"]',
  ];
  const base = document.querySelector(selectors.join(', '))?.textContent;

  return {page, owner, repo, num, base};
};

const parseDiffFilesFromDoc = (doc) => {
  const jsonData = doc.querySelector(
    '[data-target="react-app.embeddedData"]'
  )?.textContent;
  let diffEntries = [];

  if (jsonData) {
    // New Files Changed page
    const data = JSON.parse(jsonData);
    const diffSummaries = data?.payload?.diffSummaries || [];
    diffEntries = diffSummaries.map((file) => [file.pathDigest, file.path]);
  }

  if (diffEntries.length === 0) {
    // Old Files Changed page - fallback
    const nodes = Array.from(doc.querySelectorAll('div.file-header'));
    diffEntries = nodes.map((node) => [
      node.dataset.anchor?.replace('diff-', ''),
      node.dataset.path,
    ]);
  }

  return new Map(diffEntries);
};

export const getDiffFilesMap = cacheResult(urlCacheKey, async () => {
  // Fake data for diverse team ownership showcase
  return new Map([
    ['diff-abc123', 'src/ownership.js'],
    ['diff-def456', 'src/github.js'],
    ['diff-ghi789', 'config/webpack.config.js'],
    ['diff-jkl012', 'public/manifest.json'],
    ['diff-mno345', 'README.md']
  ]);
});

export async function getReviewers(prNumber) {
  // Fake data for Athena (ops) approved only
  return new Map([
    ['Athena', true]
  ]);
}

export async function getFolderOwners() {
  return [
    {folderMatch: ignore().add('*'), owners: new Set(['@org/admins'])},
    {folderMatch: ignore().add('src/**/*'), owners: new Set(['@org/admins', '@org/engineers'])},
    {folderMatch: ignore().add('config/**/*'), owners: new Set(['@org/admins', '@org/engineers', '@org/ops'])},
  ].reverse();

  // Fake data for org teams with proper folderMatch structure
  const srcMatcher = ignore().add('src/**');
  const configMatcher = ignore().add('config/**');
  const globalMatcher = ignore().add('**');

  return [
    {
      folderMatch: srcMatcher,
      owners: new Set(['@org/engineers'])
    },
    {
      folderMatch: configMatcher,
      owners: new Set(['@org/ops'])
    },
    {
      folderMatch: globalMatcher,
      owners: new Set(['@org/admins'])
    }
  ];
}

const loadTeamMembers = async (org, teamSlug) => {
  const teamMembers = [];
  for (let page = 1, hasNext = true; hasNext; page++) {
    const url = `https://github.com/orgs/${org}/teams/${teamSlug}?page=${page}`;
    const doc = await loadPage(url);
    const memberNodes = doc?.querySelectorAll('.member-list-item');
    const members = Array.from(memberNodes || []).map(
      (member) => member.dataset.bulkActionsId
    );
    teamMembers.push(...members);

    const next = doc?.querySelector('.next_page');
    hasNext = next && !next.classList.contains('disabled');
  }
  return teamMembers;
};

export const getTeamMembers = cacheResult(
  repoCacheKey,
  async (folderOwners) => {
    return new Map([
      ['@org/admins', ['Admin', 'Zeus']],
      ['@org/engineers', ['TombWater', 'Apollo']],
      ['@org/ops', ['Hermes', 'Athena']],
    ]);

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
    const teamNames = allOwners.filter((teamName) =>
      teamName.startsWith(prefix)
    );

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
  }
);
