import {findFileOwners} from './codeowners';

// userTeamsMap: user → set of teams, starting with a pseudo-team of their own
// login. ownerApprovals: owners/teams that at least one approver belongs to.
export const buildApprovalMaps = (reviewers, teamMembers) => {
  const userTeamsMap = new Map();
  for (const [team, members] of teamMembers.entries()) {
    for (const member of members) {
      const teams = userTeamsMap.get(member) ?? new Set([member]);
      userTeamsMap.set(member, teams.add(team));
    }
  }

  const ownerApprovals = new Set(
    Array.from(reviewers.entries())
      .filter(([, approved]) => approved)
      .flatMap(([approver]) =>
        Array.from(userTeamsMap.get(approver) ?? new Set([approver]))
      )
  );

  return {userTeamsMap, ownerApprovals};
};

// diffFilesMap: key → path. The browser keys by diff digest; any unique key works.
export const createOwnerGroupsMap = (diffFilesMap, folderOwners) => {
  const ownerGroupsMap = new Map();

  for (const [digest, path] of diffFilesMap.entries()) {
    const {owners} = findFileOwners(path, folderOwners) || {
      owners: new Set(),
    };

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

// Whether any PR file has a designated owner — used to decide if the
// owner/non-owner comment decoration distinction is meaningful
export const computeHasOwnedFiles = (ownerGroupsMap, folderOwners) =>
  ownerGroupsMap.size > 0
    ? [...ownerGroupsMap.values()].some((g) => g.owners !== null)
    : folderOwners.some(({owners}) => owners.size > 0);

// The ownershipData object every decorator and view reads. Each extension
// fetches the inputs its own way (DOM scraping or the GitHub API):
// reviewers: login → approved; teamMembers: owner → members (see teams.js);
// diffFilesMap: key → path, or null when the PR's files aren't known
export const buildOwnershipData = ({
  folderOwners,
  reviewers,
  teamMembers,
  user,
  diffFilesMap,
  prAuthor,
}) => {
  const {userTeamsMap, ownerApprovals} = buildApprovalMaps(
    reviewers,
    teamMembers
  );
  const ownerGroupsMap = diffFilesMap
    ? createOwnerGroupsMap(diffFilesMap, folderOwners)
    : new Map();

  return {
    folderOwners,
    reviewers,
    teamMembers,
    ownerApprovals,
    user,
    userTeams: userTeamsMap.get(user) ?? new Set([user]),
    userTeamsMap,
    diffFilesMap,
    ownerGroupsMap,
    hasOwnedFiles: computeHasOwnedFiles(ownerGroupsMap, folderOwners),
    prAuthor,
  };
};

// One owner as the current user sees it. isYours is team membership, the
// ★ in both extensions, and stays set on the user's own PR so the symbol
// never changes meaning. canApprove is what asks the user to act: their
// team, and not the PR's author, who can't approve their own PR.
export const describeOwner = (owner, ownershipData) => {
  const {ownerApprovals, userTeams, user, prAuthor} = ownershipData;
  const isYours = userTeams.has(owner);
  return {
    owner,
    approved: ownerApprovals.has(owner),
    isYours,
    canApprove: isYours && user !== prAuthor,
  };
};

// Owners with the user's teams first, otherwise in CODEOWNERS order
export const sortOwners = (owners, ownershipData) =>
  Array.from(owners).sort(
    (a, b) =>
      Number(ownershipData.userTeams.has(b)) -
      Number(ownershipData.userTeams.has(a))
  );

// Team members with their own review state, for member lists
export const describeMembers = (members, ownershipData) =>
  (members ?? []).map((login) => ({
    login,
    approved: Boolean(ownershipData.reviewers.get(login)),
    isYou: login === ownershipData.user,
  }));

// A group with no CODEOWNERS entry has no owners: anyone with write access
// can approve. Its "members" are the users who did, without teams.
export const anyReviewerApprovers = ({ownerApprovals, teamMembers}) =>
  Array.from(ownerApprovals).filter((approver) => !teamMembers.has(approver));

// Check if a file has designated owners in CODEOWNERS
export const fileHasOwners = (filePath, ownershipData) => {
  if (!ownershipData || !filePath) return false;
  const fileOwnerEntry = findFileOwners(filePath, ownershipData.folderOwners);
  return Boolean(fileOwnerEntry && fileOwnerEntry.owners.size > 0);
};

// Check if commenter owns a specific file
export const isOwnerOfFile = (commenterLogin, filePath, ownershipData) => {
  if (!ownershipData || !filePath) return false;

  const {userTeamsMap, folderOwners} = ownershipData;

  const fileOwnerEntry = findFileOwners(filePath, folderOwners);
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
