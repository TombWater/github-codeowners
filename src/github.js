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

export const getTeamMembers = memoize(async (folderOwners) => {
  const pr = getPrInfo();
  if (!pr) {
    return [];
  }
  const headers = await apiHeaders();

  const org = pr.owner;

  // Array of all unique owner names mentioned in CODEOWNERS file
  const teamNames = Array.from(
    new Set(folderOwners.flatMap(({teams}) => Array.from(teams)))
  );

  // Filter out names that are not teams in the org owning the PR
  const prefix = `@${org}/`;
  const teamsToFetch = teamNames.filter((teamName) =>
    teamName.startsWith(prefix)
  );

  // Fetch all org teams in parallel, mapping team names to their members
  const orgTeams = new Map(
    await Promise.all(
      teamsToFetch.map(async (teamName) => {
        const teamSlug = teamName.replace(prefix, '');
        const url = `https://api.github.com/orgs/${org}/teams/${teamSlug}/members`;
        const response = await fetch(url, {headers});
        const members = await response.json();
        return [teamName, members];
      })
    )
  );

  // Map owners to their members, or to the owner name if it's not a team
  const teams = new Map(
    teamNames.map((teamName) => {
      const members = orgTeams.get(teamName);
      const logins = Array.isArray(members)
        ? members.map((member) => member.login)
        : [teamName];
      return [teamName, logins];
    })
  );

  return teams;
}, ownersKey);

export const getApprovals = async (reviews, teamMembers) => {
  // All users who have approved
  const users = reviews
    .filter((review) => review.state === 'APPROVED')
    .map((review) => review.user.login);

  // Map of team names to their members
  const userTeams = teamMembers.entries().reduce((acc, [team, members]) => {
    for (const member of members) {
      if (!acc.has(member)) {
        acc.set(member, new Set());
      }
      acc.get(member).add(team);
    }
    return acc;
  }, new Map());

  // Set of teams that at least one approving user is a member of
  const teams = new Set(
    users.map((app) => Array.from(userTeams.get(app))).flat()
  );

  return {users, teams};
};
