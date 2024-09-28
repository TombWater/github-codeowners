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

const urlCacheKey = () => window.location.href;
const repoCacheKey = () => {
  const pr = getPrInfo();
  return pr ? `${pr.owner}/${pr.repo}` : '';
};

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
}, urlCacheKey);

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

        const [folder, ...owners] = trimmed.split(/\s+/);

        folders.push({
          folderMatch: ignore().add(folder),
          owners: new Set(owners),
        });
      }

      return folders.reverse();
    }
  }
  return [];
}, repoCacheKey);

export const getTeamMembers = memoize(async (folderOwners) => {
  const pr = getPrInfo();
  if (!pr) {
    return [];
  }
  const headers = await apiHeaders();

  const org = pr.owner;

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

  // Map owner teams to a list of members, or if not a team then a pseudo-team with just the owner
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

export const getOwnerApprovals = async (reviews, teamMembers) => {
  // All users who have approved
  const users = reviews
    .filter((review) => review.state === 'APPROVED')
    .map((review) => review.user.login);

  // Map of user names to the teams they are members of
  const userTeams = teamMembers.entries().reduce((acc, [team, members]) => {
    for (const member of members) {
      if (!acc.has(member)) {
        // Users are members of the pseudo-team with their own name
        acc.set(member, new Set([member]));
      }
      acc.get(member).add(team);
    }
    return acc;
  }, new Map());

  // Set of owners that at least one approving team member is a member of
  const owners = new Set(
    users.map((approver) => Array.from(userTeams.get(approver))).flat()
  );

  return owners;
};
