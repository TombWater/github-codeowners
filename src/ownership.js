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
  let reviewers, teamMembers;
  [reviewers, teamMembers] = await Promise.all([
    github.getReviewers(),
    github.getTeamMembers(folderOwners),
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

  return {
    folderOwners,
    reviewers,
    teamMembers,
    ownerApprovals,
    user,
    userTeams,
    diffFilesMap,
  };
};
