import ignore from 'ignore';
import {memoize, isObject} from 'lodash-es';

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

const urlTimelineCacheKey = () => {
  // Include timeline count to detect updates on conversation page
  const timelineCount = document.querySelectorAll('.TimelineItem').length;
  return `${window.location.href}::timeline=${timelineCount}`;
};
const urlPeriodicCacheKey = () => {
  // Cache with 30-second granularity - auto-invalidates to catch server-side updates
  const timeWindow = Math.floor(Date.now() / 30000);
  return `${window.location.href}::time=${timeWindow}`;
};
const prCacheKey = () => {
  const pr = getPrInfo();
  return pr.num ? `${pr.owner}/${pr.repo}/${pr.num}` : '';
};
const repoCacheKey = () => {
  const pr = getPrInfo();
  return pr.repo ? `${pr.owner}/${pr.repo}` : '';
};
const prBaseCacheKey = () => {
  const pr = getPrInfo();
  return pr.base ? `${pr.owner}/${pr.repo}/${pr.base}` : '';
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

export const getIsMerged = () => {
  const mergedSelectors = [
    '#partial-discussion-header .State--merged',
    '[data-status="pullMerged"]',
  ];
  let isMerged = Boolean(document.querySelector(mergedSelectors.join(', ')));

  // Apply simulated merge state if in debug mode
  if (__DEBUG__) {
    try {
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

  return isMerged;
};

export const getPrAuthor = cacheResult(prCacheKey, async () => {
  // Try extracting from current page first
  let author = extractAuthorFromDoc(document);
  if (author) return author;

  // Fallback: If no author found (old files page), fetch from conversation page
  const {owner, repo, num} = getPrInfo();
  if (num) {
    const conversationUrl = `https://github.com/${owner}/${repo}/pull/${num}`;
    const doc = await loadPage(conversationUrl);
    if (doc) {
      author = extractAuthorFromDoc(doc);
      if (author) return author;
    }
  }

  return null;
});

const extractAuthorFromDoc = (doc) => {
  // OG meta tag works on conversation pages and new Files UI
  const ogAuthor = doc.querySelector('meta[property="og:author:username"]');
  if (ogAuthor) {
    const author = ogAuthor.getAttribute('content');
    if (author) return author;
  }

  // Fallback for merged PR conversation pages that don't have og:author meta tag
  const timelineAvatar = doc.querySelector('.TimelineItem-avatar[href^="/"]');
  return normalizeAuthorHref(timelineAvatar?.getAttribute('href'));
};

export const normalizeAuthorHref = (href) => {
  const normalized = href
    ?.replace(/^\//, '')
    ?.replace(/^apps\/(.+)/, '$1[bot]'); // "/apps/dependabot" → "dependabot[bot]"
  return normalized ? decodeURIComponent(normalized) : null;
};

// Synchronous helper to extract basic PR info from URL and DOM (no author)
export const getPrInfo = () => {
  const url = window.location.href;

  // Check for compare view URL pattern: /owner/repo/compare/range
  const compareMatch = url.match(
    /github\.com\/([^/]+)\/([^/]+)\/compare\/([^?#]+)/
  );

  if (compareMatch) {
    const [, owner, repo, range] = compareMatch;
    // Extract base branch from range (e.g., "master...feature/branch" -> "master")
    const base = range.split('...')[0];
    return {page: 'compare', owner, repo, num: null, base};
  }

  // Standard PR URL pattern
  const match = url.match(
    /github\.com\/([^/]+)\/([^/]+)(\/pull\/(\d+)(\/([^/]+))?)?/
  );

  let owner, repo, num, page;
  [, owner, repo, , num, , page] = match || {};

  const baseSelectors = [
    '#partial-discussion-header .base-ref',
    '#partial-discussion-header .commit-ref',
    'div[class*="PageHeader-Description"] a[class*="BranchName-BranchName"]',
  ];
  const base = document.querySelector(baseSelectors.join(', '))?.textContent;

  return {page, owner, repo, num, base};
};

const getEmbeddedData = (doc, extractor) => {
  const targets = ['react-app.embeddedData', 'react-partial.embeddedData'];
  const selectors = targets.map((t) => `[data-target="${t}"]`);
  const scripts = Array.from(doc.querySelectorAll(selectors.join(', ')));

  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent);
      // Normalize: react-app uses 'payload', react-partial uses 'props'
      const payload = data?.payload || data?.props;
      const result = payload && extractor(payload);
      if (result) return result;
    } catch (e) {
      // Skip invalid JSON
    }
  }
  return null;
};

const findDiffSummaries = (obj) => {
  if (!isObject(obj)) return null;
  if (Array.isArray(obj.diffSummaries)) return obj.diffSummaries;

  for (const value of Object.values(obj)) {
    const result = findDiffSummaries(value);
    if (result) return result;
  }
  return null;
};

const parseDiffFilesFromDoc = (doc) => {
  let diffEntries = [];

  // Try new Files UI
  const diffSummaries = getEmbeddedData(doc, findDiffSummaries);
  if (diffSummaries) {
    diffEntries = diffSummaries.map((file) => [file.pathDigest, file.path]);
  }

  // Try old Files UI (DOM-based) if JSON didn't work
  if (diffEntries.length === 0) {
    const nodes = Array.from(doc.querySelectorAll('div.file-header'));
    diffEntries = nodes.map((node) => [
      node.dataset.anchor?.replace('diff-', ''),
      node.dataset.path,
    ]);
  }

  return new Map(diffEntries);
};

export const getDiffFilesMap = cacheResult(urlTimelineCacheKey, async () => {
  // Try to get files from current page first
  let diffFilesMap = parseDiffFilesFromDoc(document);

  // If not on files page or no files found, fetch from files tab (only works for PRs)
  if (diffFilesMap.size === 0) {
    const {owner, repo, num} = getPrInfo();
    if (num) {
      const url = `https://github.com/${owner}/${repo}/pull/${num}/files`;
      const doc = await loadPage(url);
      if (doc) {
        diffFilesMap = parseDiffFilesFromDoc(doc);
      }
    }
  }

  return diffFilesMap;
});

const prConversationUrl = () => {
  const {owner, repo, num} = getPrInfo();
  return num ? `https://github.com/${owner}/${repo}/pull/${num}` : null;
};

const loadConversationPage = cacheResult(urlPeriodicCacheKey, () => {
  const url = prConversationUrl();
  return url ? loadPage(url) : null;
});

export const getReviewers = async () => {
  const url = prConversationUrl();
  if (!url) {
    return new Map(); // No reviewers on compare pages
  }
  if (window.location.pathname === new URL(url).pathname) {
    return getReviewersFromDoc(document);
  } else {
    return getReviewersFromDoc(await loadConversationPage());
  }
};

export const getReviewersFromDoc = (doc) => {
  const reviewerNodes = doc?.querySelectorAll(
    '[data-assignee-name], .js-reviewer-team'
  );
  let reviewers = Array.from(reviewerNodes || []).reduce((acc, node) => {
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

  // Apply simulated approvals if in debug mode
  if (__DEBUG__) {
    const {getSimulatedApprovals} = window.__ghcoDebugPanel;
    const simulatedApprovals = getSimulatedApprovals();

    if (simulatedApprovals.size > 0) {
      console.log(
        '[GHCO] Applying simulated approvals:',
        Array.from(simulatedApprovals.entries())
      );

      // Create a new reviewers map with simulated approvals applied
      const modifiedReviewers = new Map(reviewers);

      for (const [owner, approved] of simulatedApprovals.entries()) {
        modifiedReviewers.set(owner, approved);
      }

      reviewers = modifiedReviewers;
    }
  }

  return reviewers;
};

export const getFolderOwners = cacheResult(prBaseCacheKey, async () => {
  const {owner, repo, base} = getPrInfo();
  if (!base) {
    return [];
  }

  const paths = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'];
  for (const path of paths) {
    const url = `https://github.com/${owner}/${repo}/blob/${base}/${path}`;
    const doc = await loadPage(url);
    if (!doc) {
      continue;
    }

    const lines =
      getEmbeddedData(doc, (payload) => payload?.blob?.rawLines) ?? [];
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
    const {owner: org} = getPrInfo();
    if (!org || !folderOwners || !Array.isArray(folderOwners)) {
      return new Map();
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
    const teamResults = await Promise.all(
      teamNames.map(async (teamName) => {
        const teamSlug = teamName.replace(prefix, '');
        const members = await loadTeamMembers(org, teamSlug);
        return [teamName, members];
      })
    );
    const orgTeams = new Map(teamResults);

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

    return cache;
  };
})();
