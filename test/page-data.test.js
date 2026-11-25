import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  getReviewStatusFromMergeBoxData,
  getReviewersFromMergeBoxData,
  withoutRefOwner,
} from '../browser/page-data.js';

// The shape of page_data/merge_box, cut down to what we read
const mergeBox = ({rollups = [], conflict = false, pullRequest} = {}) => ({
  pullRequest,
  mergeRequirements: {
    conditions: [
      {type: 'PULL_REQUEST_STATE', result: 'PASSED'},
      {type: 'PULL_REQUEST_RULES', result: 'PASSED', ruleRollups: rollups},
      {
        type: 'PULL_REQUEST_MERGE_CONFLICT_STATE',
        result: conflict ? 'FAILED' : 'PASSED',
      },
    ],
  },
});

const reviewRule = (result, metadata) => ({
  ruleType: 'PULL_REQUEST',
  result,
  metadata: {
    requiredReviewers: 1,
    approvedReviewers: 0,
    requiresCodeowners: true,
    ...metadata,
  },
});

const shield = {name: '@org/web', isCodeOwner: true};

test('a failing review rule that requires code owners', () => {
  assert.deepEqual(
    getReviewStatusFromMergeBoxData(
      mergeBox({rollups: [reviewRule('FAILED'), {ruleType: 'DELETION'}]})
    ),
    {ownerApprovalRequired: true, reviewsBlocking: true, requiredCount: 1}
  );
});

test('a passing review rule no longer blocks', () => {
  const status = getReviewStatusFromMergeBoxData(
    mergeBox({rollups: [reviewRule('PASSED', {approvedReviewers: 1})]})
  );
  assert.equal(status.reviewsBlocking, false);
  assert.equal(status.ownerApprovalRequired, true);
});

// Unlike the classic page's text, the JSON's "no" is a real no
test('a rule that doesn’t require code owners says so', () => {
  const status = getReviewStatusFromMergeBoxData(
    mergeBox({rollups: [reviewRule('FAILED', {requiresCodeowners: false})]}),
    [shield]
  );
  assert.equal(status.ownerApprovalRequired, false);
});

test('no review rule: an unprotected base, nothing required', () => {
  assert.deepEqual(getReviewStatusFromMergeBoxData(mergeBox()), {
    ownerApprovalRequired: false,
    reviewsBlocking: false,
    requiredCount: null,
  });
});

test('merged and closed PRs list no conditions: nothing required', () => {
  assert.deepEqual(
    getReviewStatusFromMergeBoxData({mergeRequirements: {conditions: []}}),
    {ownerApprovalRequired: false, reviewsBlocking: false, requiredCount: null}
  );
});

// A conflict hides every rule, which looked like an unprotected base and
// showed "not required to merge"
test('a conflict leaves the rules unknown: blocking, shields count', () => {
  assert.deepEqual(
    getReviewStatusFromMergeBoxData(mergeBox({conflict: true}), [shield]),
    {ownerApprovalRequired: true, reviewsBlocking: true, requiredCount: null}
  );
  assert.equal(
    getReviewStatusFromMergeBoxData(mergeBox({conflict: true}))
      .ownerApprovalRequired,
    false
  );
});

test('a conflict with the rule still listed uses the rule', () => {
  assert.deepEqual(
    getReviewStatusFromMergeBoxData(
      mergeBox({conflict: true, rollups: [reviewRule('PASSED')]})
    ),
    {ownerApprovalRequired: true, reviewsBlocking: false, requiredCount: 1}
  );
});

test('a failed load is never an all-clear', () => {
  for (const data of [null, {}, {mergeRequirements: {}}]) {
    assert.deepEqual(getReviewStatusFromMergeBoxData(data, [shield]), {
      ownerApprovalRequired: true,
      reviewsBlocking: true,
      requiredCount: null,
    });
  }
});

test('reviewers: requests are pending, reviews give their verdict', () => {
  const reviewers = getReviewersFromMergeBoxData(
    mergeBox({
      pullRequest: {
        pendingReviewRequests: [
          {reviewer: {type: 'TEAM', name: 'Web', login: 'web'}},
          {reviewer: {type: 'USER', login: 'bob'}},
        ],
        latestOpinionatedReviews: [
          {author: {login: 'alice'}, state: 'APPROVED'},
          {author: {login: 'carol'}, state: 'CHANGES_REQUESTED'},
          {author: null, state: 'APPROVED'},
        ],
      },
    })
  );
  assert.deepEqual(Object.fromEntries(reviewers), {
    Web: false,
    bob: false,
    alice: true,
    carol: false,
  });
});

test('reviewers: an approval outranks a new request to the same reviewer', () => {
  const reviewers = getReviewersFromMergeBoxData({
    pullRequest: {
      pendingReviewRequests: [{reviewer: {type: 'USER', login: 'alice'}}],
      latestOpinionatedReviews: [{author: {login: 'alice'}, state: 'APPROVED'}],
    },
  });
  assert.equal(reviewers.get('alice'), true);
});

test('reviewers: none without data', () => {
  assert.equal(getReviewersFromMergeBoxData(null).size, 0);
});

test('a fork’s base loses its owner prefix', () => {
  assert.equal(withoutRefOwner('cli:trunk'), 'trunk');
  assert.equal(withoutRefOwner('owner:feature/a-b'), 'feature/a-b');
});

test('a plain base is kept, trimmed', () => {
  assert.equal(withoutRefOwner('trunk'), 'trunk');
  assert.equal(withoutRefOwner('feature/x'), 'feature/x');
  assert.equal(withoutRefOwner('  main\n'), 'main');
});

test('no base is null', () => {
  assert.equal(withoutRefOwner(undefined), null);
  assert.equal(withoutRefOwner(''), null);
  assert.equal(withoutRefOwner('  '), null);
});
