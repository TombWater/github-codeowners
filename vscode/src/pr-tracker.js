import * as vscode from 'vscode';
import {parseCodeowners} from '../../core/codeowners';
import {resolveOwnerTeams} from '../../core/teams';
import {buildOwnershipData} from '../../core/ownership';
import {approversOf, calculateApprovalStatus} from '../../core/approval';
import * as api from './github-api';
import {log} from './log';

// Matches the refresh interval in extension.js, so a decoration request
// alone doesn't reload more often than that
const PR_TTL = 5 * 60 * 1000;
// Retry while the PR extension can't name the workspace's repository yet
const REPO_RETRY = 3 * 1000;
const REPO_TTL = 10 * 60 * 1000;

// Async value cache with a time-to-live. Concurrent callers share one fetch.
const ttlCache = (ttl) => {
  const entries = new Map();
  return (key, load) => {
    const entry = entries.get(key);
    if (entry && Date.now() - entry.time < ttl) return entry.promise;
    const promise = load();
    entries.set(key, {promise, time: Date.now()});
    promise.catch(() => entries.delete(key));
    return promise;
  };
};

const codeownersCache = ttlCache(REPO_TTL);
const teamsCache = ttlCache(REPO_TTL);
// Keyed by commit SHAs, so it never goes stale
const mergeBaseCache = ttlCache(Infinity);

// The API counterpart of getReviewStatusFromDoc() in browser/github.js:
// the same {ownerApprovalRequired, reviewsBlocking, requiredCount}, read
// from GraphQL fields instead of the merge box and sidebar
const reviewStatusFromApi = (pr) => {
  const rule = pr.baseRef?.refUpdateRule;
  return {
    // Two independent yeses, neither trusted to say no: the base branch
    // rule, and owners requested as code owners (they drop off once they
    // review)
    ownerApprovalRequired: Boolean(
      rule?.requiresCodeOwnerReviews ||
        pr.reviewRequests.nodes.some((r) => r.asCodeOwner)
    ),
    reviewsBlocking: ['REVIEW_REQUIRED', 'CHANGES_REQUESTED'].includes(
      pr.reviewDecision
    ),
    requiredCount: rule?.requiredApprovingReviewCount ?? null,
  };
};

// ownershipData from core/, as the browser builds it, plus approvalStatus,
// the org and the PR's diff data
const loadOwnershipData = async (owner, repo, number) => {
  const pr = await api.getPullRequest(owner, repo, number);

  // The base branch tip, as GitHub uses; its base commit when the branch is
  // gone (deleted after merge)
  const text = await codeownersCache(
    `${owner}/${repo}@${pr.baseRefName}`,
    async () =>
      (await api.getCodeownersText(owner, repo, pr.baseRefName)) ??
      api.getCodeownersText(owner, repo, pr.baseRefOid)
  );
  if (!text) return null;
  const folderOwners = parseCodeowners(text.split('\n'));

  const teamMembers = await teamsCache(
    `${owner}/${repo}@${pr.baseRefName}`,
    () => resolveOwnerTeams(owner, folderOwners, api.getTeamMembers)
  );

  // Login → approved, like the sidebar rows: requested users are pending
  const reviewers = new Map();
  for (const {requestedReviewer} of pr.reviewRequests.nodes) {
    if (requestedReviewer?.login) reviewers.set(requestedReviewer.login, false);
  }
  for (const {state, author} of pr.latestOpinionatedReviews.nodes) {
    if (author?.login) reviewers.set(author.login, state === 'APPROVED');
  }

  const ownershipData = buildOwnershipData({
    folderOwners,
    reviewers,
    teamMembers,
    user: pr.viewer,
    diffFilesMap: new Map(pr.files.map(({path}) => [path, path])),
    prAuthor: pr.author?.login,
  });
  // For the view's short owner names
  ownershipData.org = owner;
  // For opening a file's PR diff
  ownershipData.pr = {
    owner,
    repo,
    number,
    headRefOid: pr.headRefOid,
    mergeBase: await mergeBaseCache(
      `${owner}/${repo}@${pr.baseRefOid}...${pr.headRefOid}`,
      () => api.getMergeBase(owner, repo, pr.baseRefOid, pr.headRefOid)
    ).catch((e) => {
      log('Merge base lookup failed, using the base branch tip:', e.message);
      return pr.baseRefOid;
    }),
    baseRefOid: pr.baseRefOid,
    changeTypes: new Map(pr.files.map((f) => [f.path, f.changeType])),
  };

  ownershipData.approvalStatus = calculateApprovalStatus(ownershipData, {
    approvers: approversOf(reviewers),
    reviewStatus: reviewStatusFromApi(pr),
    isMerged: pr.merged,
    isClosed: pr.state === 'CLOSED',
  });
  return ownershipData;
};

// Ownership data per PR number, loaded on demand. Fires onDidChange(number)
// when new data arrives.
export class PrTracker {
  constructor(prApi) {
    this.prApi = prApi;
    this.data = new Map(); // number → {value, time}
    this.loading = new Map();
    this.retrying = new Set(); // PRs waiting for the repository
    this._onDidChange = new vscode.EventEmitter();
    this.onDidChange = this._onDidChange.event;
  }

  // Repository and checked-out PR of the first workspace folder
  async describe() {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder || !this.prApi?.getRepositoryDescription) return null;
    return (await this.prApi.getRepositoryDescription(folder.uri)) ?? null;
  }

  // Cached value now, even if stale, and a background reload when stale.
  // Stale data stays on screen until the reload replaces it, so badges and
  // the view don't blink off during a refresh.
  peek(number) {
    const entry = this.data.get(number);
    if (!entry || Date.now() - entry.time > PR_TTL) this.load(number);
    return entry?.value;
  }

  // Like peek(), but waits for the first load. Safe to call from an
  // onDidChange handler: a reload only fires once, when it completes.
  async get(number) {
    if (!this.data.has(number)) return this.load(number);
    return this.peek(number);
  }

  // Why get()/load() returned null for this PR
  statusFor(number) {
    const entry = this.data.get(number);
    if (entry?.value) return 'ready';
    if (entry?.noCodeowners) return 'noCodeowners';
    if (entry?.error) return 'error';
    return 'loading';
  }

  load(number) {
    if (this.loading.has(number)) return this.loading.get(number);
    const promise = (async () => {
      try {
        const repo = await this.describe();
        if (!repo) {
          // Transient, e.g. while the PR extension reloads: keep what we
          // have, and don't record it as "no CODEOWNERS"
          if (!this.retrying.has(number)) {
            log(`PR #${number}: repository not known yet, retrying`);
          }
          this.retrying.add(number);
          setTimeout(() => this.load(number), REPO_RETRY);
          return this.data.get(number)?.value ?? null;
        }
        const value = await loadOwnershipData(
          repo.owner,
          repo.repositoryName,
          number
        );
        this.retrying.delete(number);
        // null only when GitHub confirms there is no CODEOWNERS file
        this.data.set(number, {
          value,
          noCodeowners: value === null,
          time: Date.now(),
        });
        this._onDidChange.fire(number);
        return value;
      } catch (e) {
        log(`PR #${number} failed to load:`, e.message);
        // Keep showing the last good data rather than blank it out
        const last = this.data.get(number)?.value ?? null;
        this.data.set(number, {
          value: last,
          error: last ? null : e,
          time: Date.now(),
        });
        return last;
      } finally {
        this.loading.delete(number);
      }
    })();
    this.loading.set(number, promise);
    return promise;
  }

  // Mark stale and reload; the old data stays until the new arrives
  invalidate(number) {
    const entry = this.data.get(number);
    if (entry) entry.time = 0;
    this.load(number);
  }

  // Milliseconds since the PR's data was loaded
  ageOf(number) {
    const entry = this.data.get(number);
    return entry ? Date.now() - entry.time : Infinity;
  }

  refreshOlderThan(ms) {
    for (const number of this.data.keys()) {
      if (this.ageOf(number) >= ms) this.invalidate(number);
    }
  }

  refresh() {
    for (const number of this.data.keys()) this.invalidate(number);
    this._onDidChange.fire(undefined);
  }
}
