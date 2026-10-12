import {isGroupApproved, sortOwnerGroups} from '../../core/approval';
import {
  anyReviewerApprovers,
  describeMembers,
  describeOwner as describeCoreOwner,
  sortOwners,
} from '../../core/ownership';

// `@org/docs` → `docs` for teams in the PR's own org; users keep their `@`
export const shortOwnerName = (owner, data) =>
  owner.startsWith(`@${data.org}/`) ? owner.slice(data.org.length + 2) : owner;

export const isTeam = (owner) => owner.includes('/');

// Members we know of, with their state, or null when the team couldn't be
// read
export const ownerMembers = (owner, data) => {
  if (!isTeam(owner)) return null;
  const members = data.teamMembers.get(owner);
  return members?.length ? describeMembers(members, data) : null;
};

// One owner for display: core's state (approved, isYours, canApprove) plus
// the short name and members
export const describeOwner = (owner, data) => ({
  ...describeCoreOwner(owner, data),
  name: shortOwnerName(owner, data),
  members: ownerMembers(owner, data),
});

// What one owner group means to the current user, mirroring the merge box.
// isYours: one of its owners is the user's team (★). canApprove: the user
// is asked to act, which the PR's author never is.
export const describeGroup = (group, data) => {
  const approved = isGroupApproved(group, data.ownerApprovals);
  const owners = group.owners
    ? sortOwners(group.owners, data).map((owner) => describeOwner(owner, data))
    : [];
  const canApprove = owners.some((o) => o.canApprove);
  return {
    approved,
    isYours: owners.some((o) => o.isYours),
    canApprove,
    owners,
    // No CODEOWNERS entry: the users who approved, as the browser shows them
    anyApprovers: group.owners ? [] : anyReviewerApprovers(data),
    label: owners.length
      ? owners.map((o) => o.name).join(', ')
      : 'Any reviewer',
    state: approved
      ? 'Approved'
      : canApprove
      ? 'Needs your approval'
      : 'Needs approval',
  };
};

// Owner groups in display order, shared with the browser's merge box
export const sortedGroups = (data) =>
  sortOwnerGroups(data.ownerGroupsMap, data);

export const groupForPath = (path, data) =>
  Array.from(data.ownerGroupsMap.values()).find((group) =>
    group.paths.includes(path)
  );

export const MAX_TOOLTIP_MEMBERS = 30;

// ★ is membership, as on the browser's labels, also on the user's own PR
export const ownerMark = (o) => (o.approved ? '✓' : o.isYours ? '★' : '◐');

// Members (from describeMembers) to list, capped, with an "and N more" line:
// ✓ for those who approved and ★ for the user, as in the browser's drawer
export const memberLines = (members) => {
  if (!members) return [];
  const lines = members
    .slice(0, MAX_TOOLTIP_MEMBERS)
    .map((m) => `${m.approved ? '✓ ' : ''}${m.login}${m.isYou ? ' ★' : ''}`);
  const more = members.length - MAX_TOOLTIP_MEMBERS;
  if (more > 0) lines.push(`and ${more} more`);
  return lines;
};

// Every PR file any of `owners` co-owns, across all groups, in the view's
// group order
export const filesOwnedBy = (owners, data) =>
  sortedGroups(data)
    .filter((group) => owners.some((owner) => group.owners?.has(owner)))
    .flatMap((group) => group.paths);
