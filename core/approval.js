// An owner group is approved when any of its owners (or a team an approver
// belongs to) approved. A group with no owners needs any approval at all.
export const isGroupApproved = (group, ownerApprovals) =>
  group.owners && group.owners.size > 0
    ? Array.from(group.owners).some((owner) => ownerApprovals.has(owner))
    : ownerApprovals.size > 0;

// Logins that approved, sorted, from a reviewers map (login → approved)
export const approversOf = (reviewers) =>
  Array.from(reviewers.entries())
    .filter(([, approved]) => approved)
    .map(([approver]) => approver)
    .sort();

// reviewStatus: {ownerApprovalRequired, reviewsBlocking, requiredCount}, as
// read from the page or the API. approvers: logins that approved.
export const calculateApprovalStatus = (
  ownershipData,
  {approvers, reviewStatus, isMerged, isClosed}
) => {
  const {ownerGroupsMap, ownerApprovals} = ownershipData;
  // A merged or closed PR can't merge again, so nothing is required of it,
  // whatever the review state says
  const ownerApprovalRequired =
    !isMerged && !isClosed && Boolean(reviewStatus.ownerApprovalRequired);
  if (!ownerGroupsMap || !ownerApprovals) return null;

  let groupApprovalsReceived = 0;
  let groupApprovalsRequired = 0;
  let totalFiles = 0;

  for (const [, group] of ownerGroupsMap.entries()) {
    groupApprovalsRequired++;
    totalFiles += group.paths.length;

    if (isGroupApproved(group, ownerApprovals)) {
      groupApprovalsReceived++;
    }
  }

  // Covers both "all approvals received" and "no approval required"; nobody
  // having approved means it must be the latter, and calling that success
  // would be a false all-clear on an unreviewed PR.
  const reviewsShowSuccess = !reviewStatus.reviewsBlocking;
  const hasAnyApproval = approvers.length > 0;

  return {
    groupApprovalsReceived,
    groupApprovalsRequired,
    totalFiles,
    // A closed PR can't merge, so nothing is required of it and no approval
    // it collected beforehand counts as "all required" — without this guard
    // its stripped-bare merge box reads as "nothing is blocking".
    allApprovalsReceived: !isClosed && reviewsShowSuccess && hasAnyApproval,
    approvalNotRequired:
      isClosed || (reviewsShowSuccess && !hasAnyApproval && !isMerged),
    ownerApprovalRequired,
    reviewsRequired: reviewStatus.requiredCount,
    isMerged,
    isClosed,
  };
};

// Sort order for owner groups, most urgent for the current user first
export const getOwnerGroupPriority = (group, ownershipData) => {
  const {userTeams, ownerApprovals, prAuthor, user} = ownershipData;

  // If there are no specific owners, use user's teams since they are "any reviewer" who can approve
  const owners = Array.from(group.owners || userTeams);

  const approved = isGroupApproved(group, ownerApprovals);

  // If the user is the PR author, they can't approve their own PR
  if (user !== prAuthor) {
    const userOnlyOwner = owners.every((owner) => userTeams.has(owner));
    const userOwns = owners.some((owner) => userTeams.has(owner));

    // Priority 0: User is ONLY owner and needs to approve (red ★ - on all labels)
    if (userOnlyOwner && !approved) return 0;

    // Priority 1: User is one of multiple owners and needs to approve (red ★ - one of several labels)
    if (userOwns && !approved) return 1;

    // Priority 2: User's teams that are approved (green ✓ ☆)
    if (userOwns && approved) return 2;
  }

  // Priority 3: Other teams that need approval (yellow no icon)
  if (!approved) return 3;

  // Priority 4: Other teams that are approved (green ✓)
  return 4;
};

// Owner groups in display order: most urgent for the current user first,
// then by number of files, most first
export const sortOwnerGroups = (ownerGroupsMap, ownershipData) =>
  Array.from(ownerGroupsMap.values()).sort((a, b) => {
    const diff =
      getOwnerGroupPriority(a, ownershipData) -
      getOwnerGroupPriority(b, ownershipData);
    return diff || b.paths.length - a.paths.length;
  });

// One-line summary, as shown under the "Code owners" heading
export const describeApprovalStatus = (approvalStatus) => {
  const {
    groupApprovalsReceived,
    groupApprovalsRequired,
    totalFiles,
    ownerApprovalRequired,
    allApprovalsReceived,
    approvalNotRequired,
    reviewsRequired,
    isMerged,
    isClosed,
  } = approvalStatus;
  const groupText = `${groupApprovalsRequired} owner group${
    groupApprovalsRequired === 1 ? '' : 's'
  }`;
  // Counts owner *groups*, matching the "N owner groups" above it; the
  // branches below differ only in the qualifier they append
  const ownerProgress = `${groupApprovalsReceived} of ${groupApprovalsRequired} owner groups approved`;
  const fileText = `${totalFiles} file${totalFiles === 1 ? '' : 's'}`;

  let reviewText;
  if (isMerged) {
    // no reviewText
  } else if (isClosed) {
    // Progress as it stood, without implying anything is owed
    reviewText = `${ownerProgress} (closed without merging)`;
  } else if (allApprovalsReceived) {
    // GitHub's Reviews section shows success — all required approvals satisfied.
    // Don't try to qualify the type (owner vs write-access) since the signal is
    // gone once GitHub marks the requirement as met.
    reviewText = 'All required approvals received';
  } else if (approvalNotRequired) {
    // Echo GitHub's own phrasing so the two boxes agree rather than appear to conflict
    reviewText = `${ownerProgress} (not required to merge)`;
  } else if (ownerApprovalRequired) {
    reviewText = ownerProgress;
  } else if (reviewsRequired > 0) {
    const approvalWord = reviewsRequired === 1 ? 'approval' : 'approvals';
    reviewText = `${reviewsRequired} ${approvalWord} required by reviewers with write access`;
  }

  return [`${groupText} (${fileText})`, reviewText].filter(Boolean).join(' • ');
};
