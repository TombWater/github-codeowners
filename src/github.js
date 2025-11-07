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

// Extract PR author from various sources on the page
export const getPrAuthor = cacheResult(urlCacheKey, async () => {
  const isMerged = getIsMerged();

  // Priority 1: React embedded data (new files page) - most reliable, includes merged PRs
  const reactData = document.querySelector(
    '[data-target="react-app.embeddedData"]'
  );
  if (reactData) {
    try {
      const data = JSON.parse(reactData.textContent);
      const author = data?.payload?.pullRequest?.author?.login;
      if (author) return author;
    } catch (e) {
      // Ignore parse errors, fall through to DOM selectors
    }
  }

  // Priority 2: Timeline avatar (conversation page - both open and merged PRs)
  const timelineAvatar = document.querySelector(
    '.TimelineItem-avatar[href^="/"]'
  );
  if (timelineAvatar) {
    const author = timelineAvatar.getAttribute('href')?.replace(/^\//, '');
    if (author) return author;
  }

  // Priority 3: Header selectors (files/conversation pages - open/draft PRs ONLY)
  // Skip this for merged PRs because header shows the merger (e.g. "zattoo-merge"), not the PR author
  if (!isMerged) {
    const authorSelectors = [
      '.gh-header-meta .author', // Old UI
      '[class*="PullRequestHeaderSummary"] a[data-hovercard-url*="/users/"]', // New UI
    ];
    for (const selector of authorSelectors) {
      const authorEl = document.querySelector(selector);
      if (authorEl) {
        const author =
          authorEl.textContent.trim() ||
          authorEl.getAttribute('href')?.replace(/^\//, '');
        if (author) return author;
      }
    }
  }

  // Fallback: If merged PR and no author found (old files page), fetch from conversation page
  if (isMerged) {
    const {owner, repo, num} = getPrInfo();
    if (num) {
      const conversationUrl = `https://github.com/${owner}/${repo}/pull/${num}`;
      const doc = await loadPage(conversationUrl);
      const timelineAvatar = doc?.querySelector(
        '.TimelineItem-avatar[href^="/"]'
      );
      if (timelineAvatar) {
        const author = timelineAvatar.getAttribute('href')?.replace(/^\//, '');
        if (author) return author;
      }
    }
  }

  return null;
});

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

const loadConversationPage = cacheResult(urlCacheKey, () => {
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
