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

const parseDiffFilesFromDoc = (doc) => {
  let diffEntries = [];

  // Try new Files UI
  const diffSummaries = getEmbeddedData(
    doc,
    (payload) =>
      payload?.pullRequestsFilesRoute?.diffSummaries || payload?.diffSummaries
  );
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
  // Fake data for diverse team ownership showcase
  return new Map([
    ['diff-abc123', 'src/ownership.js'],
    ['diff-def456', 'src/github.js'],
    ['diff-ghi789', 'config/webpack.config.js'],
    ['diff-jkl012', 'public/manifest.json'],
    ['diff-mno345', 'README.md'],
  ]);
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
  // Fake data for Athena (ops) approved only
  return new Map([['Athena', true]]);
};

export const getFolderOwners = cacheResult(prBaseCacheKey, async () => {
  // Fake data for org teams with proper folderMatch structure
  return [
    {folderMatch: ignore().add('*'), owners: new Set(['@org/admins'])},
    {
      folderMatch: ignore().add('src/**'),
      owners: new Set(['@org/admins', '@org/engineers']),
    },
    {
      folderMatch: ignore().add('config/**'),
      owners: new Set(['@org/admins', '@org/engineers', '@org/ops']),
    },
  ].reverse();
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
    // Fake data for org teams
    return new Map([
      ['@org/admins', ['Admin', 'Zeus']],
      ['@org/engineers', ['TombWater', 'Apollo']],
      ['@org/ops', ['Hermes', 'Athena']],
    ]);
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
