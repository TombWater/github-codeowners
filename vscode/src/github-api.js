import * as vscode from 'vscode';
import {CODEOWNERS_PATHS} from '../../core/codeowners';
import {log} from './log';

// `repo` reads private repositories, `read:org` reads team membership
const SCOPES = ['repo', 'read:org'];

const getToken = async (createIfNone) => {
  const session = await vscode.authentication.getSession('github', SCOPES, {
    createIfNone,
  });
  return session?.accessToken;
};

export const graphql = async (query, variables, {createIfNone = true} = {}) => {
  const token = await getToken(createIfNone);
  if (!token) throw new Error('Not signed in to GitHub');

  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({query, variables}),
  });
  const json = await response.json();
  if (json.errors?.length && !json.data) {
    throw new Error(json.errors.map((e) => e.message).join('; '));
  }
  return json.data;
};

const PR_QUERY = `
query ($owner: String!, $repo: String!, $number: Int!, $after: String) {
  viewer { login }
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      state
      merged
      baseRefName
      baseRefOid
      headRefOid
      reviewDecision
      author { login }
      baseRef {
        refUpdateRule { requiredApprovingReviewCount requiresCodeOwnerReviews }
      }
      reviewRequests(first: 100) {
        nodes {
          asCodeOwner
          requestedReviewer { ... on User { login } }
        }
      }
      latestOpinionatedReviews(first: 100) {
        nodes { state author { login } }
      }
      files(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { path changeType }
      }
    }
  }
}`;

export const getPullRequest = async (owner, repo, number) => {
  let pr, viewer;
  const files = [];
  let after = null;
  do {
    const data = await graphql(PR_QUERY, {owner, repo, number, after});
    viewer ??= data.viewer;
    pr ??= data.repository.pullRequest;
    const page = data.repository.pullRequest.files;
    files.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);

  return {...pr, files, viewer: viewer.login};
};

// Text of the first CODEOWNERS file found on `ref`, in GitHub's lookup order
export const getCodeownersText = async (owner, repo, ref) => {
  const fields = CODEOWNERS_PATHS.map(
    (path, i) =>
      `f${i}: object(expression: ${JSON.stringify(
        `${ref}:${path}`
      )}) { ... on Blob { text } }`
  ).join('\n');
  const data = await graphql(
    `query ($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) { ${fields} }
    }`,
    {owner, repo}
  );
  const found = CODEOWNERS_PATHS.map((_, i) => data.repository[`f${i}`]).find(
    Boolean
  );
  return found?.text ?? null;
};

const TEAM_QUERY = `
query ($org: String!, $slug: String!, $after: String) {
  organization(login: $org) {
    team(slug: $slug) {
      members(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { login }
      }
    }
  }
}`;

// Returns [] when the team can't be read, e.g. the org restricts OAuth apps
export const getTeamMembers = async (org, slug) => {
  const members = [];
  let after = null;
  try {
    do {
      const data = await graphql(TEAM_QUERY, {org, slug, after});
      const page = data.organization?.team?.members;
      if (!page) break;
      members.push(...page.nodes.map((n) => n.login));
      after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (after);
  } catch (e) {
    log(`Team @${org}/${slug} not readable:`, e.message);
  }
  return members;
};

// Merge base of the PR's base and head, which is what GitHub diffs against
export const getMergeBase = async (owner, repo, base, head) => {
  const token = await getToken(true);
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/compare/${base}...${head}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
      },
    }
  );
  if (!response.ok) throw new Error(`compare: HTTP ${response.status}`);
  return (await response.json()).merge_base_commit.sha;
};
