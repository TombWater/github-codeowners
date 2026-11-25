// Readers of GitHub's page data that need no DOM, kept apart from github.js
// so they run under `npm test`: the merge box JSON and the header's branch
// names.

// The review state from the JSON GitHub's own merge box loads
// (page_data/merge_box). rows: the sidebar's reviewer rows, whose code owner
// shields still count when the JSON can't say.
export const getReviewStatusFromMergeBoxData = (data, rows = []) => {
  const conditions = data?.mergeRequirements?.conditions;
  const reviewRule = conditions
    ?.flatMap((condition) => condition.ruleRollups ?? [])
    .find((rule) => rule.ruleType === 'PULL_REQUEST');
  // While a PR has a merge conflict, GitHub lists no rule rollups at all, as
  // for an unprotected base, so the rules are unknown rather than absent
  const rulesUnknown =
    !reviewRule &&
    conditions?.some(
      (condition) =>
        condition.type === 'PULL_REQUEST_MERGE_CONFLICT_STATE' &&
        condition.result === 'FAILED'
    );
  if (!conditions || rulesUnknown) {
    // Failed to load, or the rules hidden by a merge conflict: never an
    // all-clear, and a shield is still a yes
    return {
      ownerApprovalRequired: rows.some((row) => row.isCodeOwner),
      reviewsBlocking: true,
      requiredCount: null,
    };
  }
  // No review rule at all means nothing requires reviews (an unprotected
  // base), and a merged or closed PR lists no conditions
  return {
    ownerApprovalRequired: Boolean(reviewRule?.metadata?.requiresCodeowners),
    reviewsBlocking: reviewRule?.result === 'FAILED',
    requiredCount: reviewRule?.metadata?.requiredReviewers ?? null,
  };
};

// Name → approved from that JSON, for wherever no reviewer rows can be read:
// the Overview's sidebar fills in late (or may change shape), and a fetched
// conversation page may not be the classic one we ask for. Teams by display
// name, like the sidebar rows.
export const getReviewersFromMergeBoxData = (data) =>
  new Map(
    [
      ...(data?.pullRequest?.pendingReviewRequests ?? []).map(({reviewer}) => [
        reviewer.type === 'TEAM' ? reviewer.name : reviewer.login,
        false,
      ]),
      ...(data?.pullRequest?.latestOpinionatedReviews ?? []).map((review) => [
        review.author?.login,
        review.state === 'APPROVED',
      ]),
    ].filter(([name]) => name)
  );

// A fork's PR names its base with the owner in front ("cli:trunk"), on the
// Overview, the classic page and the files page alike. Branch names can't
// contain ":", so everything up to one is the owner.
export const withoutRefOwner = (ref) =>
  ref?.trim().replace(/^[^:]*:/, '') || null;
