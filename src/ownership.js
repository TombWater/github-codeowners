import * as github from './github';

export const getUserLogin = () => {
  return document.head.querySelector('meta[name="user-login"]')?.content;
};

// Fetch and process all owner/reviewer data for a PR
export const getPrOwnershipData = async () => {
  // Owners is cached, so get it every time to invalidate the cache when needed
  const folderOwners = await github.getFolderOwners();

  // Bail out if the repo doesn't have a CODEOWNERS file
  if (folderOwners.length === 0) {
    return null;
  }

  // Get these every time to invalidate their cache when needed
  let reviewers, teamMembers, prAuthor;
  [reviewers, teamMembers, prAuthor] = await Promise.all([
    github.getReviewers(),
    github.getTeamMembers(folderOwners),
    github.getPrAuthor(),
  ]);

  // Map of users to a set of teams they are a member of
  const userTeamsMap = new Map();
  for (const [team, members] of teamMembers.entries()) {
    for (const member of members) {
      // Initialize the set with a pseudo-team that is the member's own login
      const teams = userTeamsMap.get(member) ?? new Set([member]);
      userTeamsMap.set(member, teams.add(team));
    }
  }

  // Set of owners/teams who approved the PR
  const ownerApprovals = new Set(
    Array.from(reviewers.entries())
      .filter(([, approved]) => approved)
      .flatMap(([approver]) => {
        // Get teams for this approver, or create a pseudo-team with just the approver
        const teams = userTeamsMap.get(approver) ?? new Set([approver]);
        return Array.from(teams);
      })
  );

  const user = getUserLogin();
  const userTeams = userTeamsMap.get(user) ?? new Set([user]);

  const diffFilesMap = await github.getDiffFilesMap();

  const ownerGroupsMap = diffFilesMap
    ? createOwnerGroupsMap(diffFilesMap, folderOwners)
    : new Map();

  // Whether any PR file has a designated owner — used to decide if the
  // owner/non-owner comment decoration distinction is meaningful
  const hasOwnedFiles =
    ownerGroupsMap.size > 0
      ? [...ownerGroupsMap.values()].some((g) => g.owners !== null)
      : folderOwners.some(({owners}) => owners.size > 0);

  return {
    folderOwners,
    reviewers,
    teamMembers,
    ownerApprovals,
    user,
    userTeams,
    userTeamsMap,
    diffFilesMap,
    ownerGroupsMap,
    hasOwnedFiles,
    prAuthor,
  };
};

export const createOwnerGroupsMap = (diffFilesMap, folderOwners) => {
  const ownerGroupsMap = new Map();

  for (const [digest, path] of diffFilesMap.entries()) {
    const {owners} = folderOwners.find(({folderMatch}) =>
      folderMatch.ignores(path)
    ) || {owners: new Set()};

    const ownerKey = Array.from(owners).sort().join(',') || '__any__';

    if (!ownerGroupsMap.has(ownerKey)) {
      ownerGroupsMap.set(ownerKey, {
        owners: owners.size > 0 ? owners : null, // null means "any reviewer"
        paths: [],
        digests: [],
      });
    }

    ownerGroupsMap.get(ownerKey).paths.push(path);
    ownerGroupsMap.get(ownerKey).digests.push(digest);
  }

  return ownerGroupsMap;
};

// Check if a file has designated owners in CODEOWNERS
export const fileHasOwners = (filePath, ownershipData) => {
  if (!ownershipData || !filePath) return false;
  const {folderOwners} = ownershipData;
  const fileOwnerEntry = folderOwners.find(({folderMatch}) =>
    folderMatch.ignores(filePath)
  );
  return Boolean(fileOwnerEntry && fileOwnerEntry.owners.size > 0);
};

// Check if commenter owns a specific file
export const isOwnerOfFile = (commenterLogin, filePath, ownershipData) => {
  if (!ownershipData || !filePath) return false;

  const {userTeamsMap, folderOwners} = ownershipData;

  // Find the folder owner entry that matches this file
  const fileOwnerEntry = folderOwners.find(({folderMatch}) =>
    folderMatch.ignores(filePath)
  );

  if (!fileOwnerEntry) {
    return false;
  }

  const commenterTeams = userTeamsMap?.get(commenterLogin);
  if (!commenterTeams) return false;

  // Check if commenter's teams overlap with this file's owners
  for (const team of commenterTeams) {
    if (fileOwnerEntry.owners.has(team)) {
      return true;
    }
  }

  return false;
};

// Check if commenter owns any file in the PR
export const isOwnerOfAnyFile = (commenterLogin, ownershipData) => {
  if (!ownershipData) return false;

  const {diffFilesMap} = ownershipData;

  // If we don't have the diff files, fall back to checking team overlap across all folders
  if (!diffFilesMap || diffFilesMap.size === 0) {
    const {userTeamsMap, folderOwners} = ownershipData;
    const commenterTeams = userTeamsMap?.get(commenterLogin);
    if (!commenterTeams) return false;

    for (const {owners} of folderOwners) {
      for (const team of commenterTeams) {
        if (owners.has(team)) {
          return true;
        }
      }
    }
    return false;
  }

  // Check if commenter owns any file that's actually in the PR
  // diffFilesMap is a Map where keys are hashes and values are file paths
  for (const filePath of diffFilesMap.values()) {
    if (isOwnerOfFile(commenterLogin, filePath, ownershipData)) {
      return true;
    }
  }

  return false;
};
