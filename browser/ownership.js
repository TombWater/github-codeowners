import * as github from './github';
import {buildOwnershipData} from '../core/ownership';

export {
  fileHasOwners,
  isOwnerOfFile,
  isOwnerOfAnyFile,
} from '../core/ownership';

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

  const diffFilesMap = await github.getDiffFilesMap();

  return buildOwnershipData({
    folderOwners,
    reviewers,
    teamMembers,
    user: getUserLogin(),
    diffFilesMap,
    prAuthor,
  });
};
