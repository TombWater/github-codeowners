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

  // Check if PR is merged by looking for the merged state badge in the header
  const mergedSelectors = [
    '#partial-discussion-header .State--merged', // Old UI (both conversation and files pages)
    '[data-status="pullMerged"]', // New React UI (files page)
  ];
  let isMerged = Boolean(document.querySelector(mergedSelectors.join(', ')));

  // Apply simulated merge state if in debug mode
  if (__DEBUG__) {
    try {
      // Use dynamic import to avoid circular dependency
      const debugPanel = window.__ghcoDebugPanel;
      if (debugPanel?.getSimulatedMergeState) {
        const simulatedState = debugPanel.getSimulatedMergeState();
        if (simulatedState !== null) {
          isMerged = simulatedState;
        }
      }
    } catch (err) {
      // Ignore errors from debug panel
    }
  }

  return {page, owner, repo, num, base, isMerged};
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
  // Try to get files from current page first
  let diffFilesMap = parseDiffFilesFromDoc(document);

  // If not on files page or no files found, fetch from files tab
  if (diffFilesMap.size === 0) {
    const pr = getPrInfo();
    if (pr.num) {
      const url = `https://github.com/${pr.owner}/${pr.repo}/pull/${pr.num}/files`;
      const doc = await loadPage(url);
      if (doc) {
        diffFilesMap = parseDiffFilesFromDoc(doc);
      }
    }
  }

  console.log('[GHCO] Diff files map', diffFilesMap);
  return diffFilesMap;
});

export const getReviewers = cacheResult(urlCacheKey, async () => {
  const pr = getPrInfo();
  const url = `https://github.com/${pr.owner}/${pr.repo}/pull/${pr.num}`;
  const doc = await loadPage(url);
  const reviewerNodes = doc?.querySelectorAll(
    '[data-assignee-name], .js-reviewer-team'
  );
  const reviewers = Array.from(reviewerNodes || []).reduce((acc, node) => {
    const statusIcon = node.parentElement.querySelector(
      '.reviewers-status-icon'
    );
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
    const jsonData = doc.querySelector(
      'react-app[app-name="react-code-view"] [data-target="react-app.embeddedData"]'
    )?.textContent;
    const data = JSON.parse(jsonData);
    const lines = data?.payload?.blob?.rawLines ?? [];
    const ownerLines = lines
      .map((line) => line.trim())
      .filter((line) => line.length && !line.startsWith('#'));
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

export const getGithubClassNames = (() => {
  let cache = null;

  return () => {
    if (cache) return cache;

    const patterns = {
      wrapper: /\.(MergeBoxSectionHeader-module__wrapper--[a-zA-Z0-9_-]+)/,
      wrapperCanExpand:
        /\.(MergeBoxSectionHeader-module__wrapperCanExpand--[a-zA-Z0-9_-]+)/,
      expanded: /\.(MergeBoxExpandable-module__isExpanded--[a-zA-Z0-9_-]+)/,
      expandableWrapper:
        /\.(MergeBoxExpandable-module__expandableWrapper--[a-zA-Z0-9_-]+)/,
      expandableContent:
        /\.(MergeBoxExpandable-module__expandableContent--[a-zA-Z0-9_-]+)/,
      headingButton: /\.(MergeBoxSectionHeader-module__button--[a-zA-Z0-9_-]+)/,
      headingModule:
        /\.(MergeBoxSectionHeader-module__MergeBoxSectionHeading--[a-zA-Z0-9_-]+)/,
      headingPrimer: /\.(prc-Heading-Heading-[a-zA-Z0-9_-]+)/,
    };

    const selectors = Array.from(document.styleSheets).flatMap((sheet) => {
      try {
        return Array.from(sheet.cssRules || sheet.rules)
          .map((rule) => rule.selectorText)
          .filter(Boolean);
      } catch (e) {
        return []; // Skip stylesheets that can't be accessed (cross-origin)
      }
    });

    cache = Object.fromEntries(
      Object.entries(patterns).map(([key, pattern]) => {
        const selector = selectors.find((s) => pattern.test(s));
        const match = selector?.match(pattern);
        return [key, match?.[1]];
      })
    );

    console.log('[GHCO] GitHub class names:', cache);

    return cache;
  };
})();
