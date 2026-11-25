import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCodeowners} from '../core/codeowners.js';
import {buildOwnershipData} from '../core/ownership.js';
import {
  isGroupApproved,
  approversOf,
  calculateApprovalStatus,
  describeApprovalStatus,
  describeApprovalStatusParts,
  sortOwnerGroups,
} from '../core/approval.js';

const teamMembers = new Map([
  ['@org/web', ['alice', 'carol']],
  ['@org/api', ['bob']],
]);

// Two owner groups, three files
const ownership = ({reviewers = new Map(), user = 'carol', prAuthor} = {}) =>
  buildOwnershipData({
    folderOwners: parseCodeowners(['* @org/web', '/api/ @org/api']),
    reviewers,
    teamMembers,
    user,
    diffFilesMap: new Map([
      ['d1', 'src/app.js'],
      ['d2', 'src/view.js'],
      ['d3', 'api/server.js'],
    ]),
    prAuthor: prAuthor ?? 'erin',
  });

// The approval status and its summary line for one PR state
const status = ({
  reviewers = new Map(),
  reviewStatus,
  isMerged = false,
  isClosed = false,
}) => {
  const approvalStatus = calculateApprovalStatus(ownership({reviewers}), {
    approvers: approversOf(reviewers),
    reviewStatus,
    isMerged,
    isClosed,
  });
  return {...approvalStatus, text: describeApprovalStatus(approvalStatus)};
};

const ownersRequired = {
  ownerApprovalRequired: true,
  reviewsBlocking: true,
  requiredCount: 1,
};
const nothingBlocking = {
  ownerApprovalRequired: false,
  reviewsBlocking: false,
  requiredCount: null,
};

test('a group is approved by any of its owners', () => {
  const group = {owners: new Set(['@org/web', '@org/api'])};
  assert.equal(isGroupApproved(group, new Set(['@org/api'])), true);
  assert.equal(isGroupApproved(group, new Set(['@other'])), false);
});

test('an ownerless group needs any approval at all', () => {
  assert.equal(isGroupApproved({owners: null}, new Set()), false);
  assert.equal(isGroupApproved({owners: null}, new Set(['erin'])), true);
});

test('approvers are the reviewers who approved, sorted', () => {
  assert.deepEqual(
    approversOf(
      new Map([
        ['zoe', true],
        ['bob', false],
        ['amy', true],
      ])
    ),
    ['amy', 'zoe']
  );
});

test('null while the ownership data is incomplete (loading)', () => {
  assert.equal(
    calculateApprovalStatus(
      {ownerGroupsMap: null, ownerApprovals: null},
      {approvers: [], reviewStatus: ownersRequired}
    ),
    null
  );
});

test('owners required, one of two groups approved', () => {
  const s = status({
    reviewers: new Map([['bob', true]]),
    reviewStatus: ownersRequired,
  });
  assert.equal(s.groupApprovalsReceived, 1);
  assert.equal(s.groupApprovalsRequired, 2);
  assert.equal(s.ownerApprovalRequired, true);
  assert.equal(s.allApprovalsReceived, false);
  assert.equal(s.approvalNotRequired, false);
  assert.equal(
    s.text,
    '2 owner groups (3 files) • 1 of 2 owner groups approved'
  );
});

test('nothing blocking after an approval: all required approvals received', () => {
  const s = status({
    reviewers: new Map([['bob', true]]),
    reviewStatus: {...ownersRequired, reviewsBlocking: false},
  });
  assert.equal(s.allApprovalsReceived, true);
  assert.equal(
    s.text,
    '2 owner groups (3 files) • All required approvals received'
  );
});

// The false all-clear fixed in 0.8.1: "nothing blocking" with no approval at
// all means nothing requires one, never that everything was approved
test('nothing blocking and no approval: not required, never all received', () => {
  const s = status({reviewStatus: nothingBlocking});
  assert.equal(s.allApprovalsReceived, false);
  assert.equal(s.approvalNotRequired, true);
  assert.equal(
    s.text,
    '2 owner groups (3 files) • 0 of 2 owner groups approved (not required to merge)'
  );
});

test('a blocking requirement on reviewers, not owners, gives their count', () => {
  const blocking = {
    ownerApprovalRequired: false,
    reviewsBlocking: true,
    requiredCount: 2,
  };
  assert.equal(
    status({reviewStatus: blocking}).text,
    '2 owner groups (3 files) • 2 approvals required by reviewers with write access'
  );
  assert.equal(
    status({reviewStatus: {...blocking, requiredCount: 1}}).text,
    '2 owner groups (3 files) • 1 approval required by reviewers with write access'
  );
});

// A closed PR has no blocking line, which reads as "nothing blocking": an
// approval collected before closing must not turn it green
test('closed: nothing required, whatever it collected', () => {
  const s = status({
    reviewers: new Map([['bob', true]]),
    reviewStatus: {...ownersRequired, reviewsBlocking: false},
    isClosed: true,
  });
  assert.equal(s.allApprovalsReceived, false);
  assert.equal(s.approvalNotRequired, true);
  assert.equal(s.ownerApprovalRequired, false);
  assert.equal(
    s.text,
    '2 owner groups (3 files) • 1 of 2 owner groups approved (closed without merging)'
  );
});

test('merged: no requirement and no review text', () => {
  const s = status({reviewStatus: ownersRequired, isMerged: true});
  assert.equal(s.ownerApprovalRequired, false);
  assert.equal(s.approvalNotRequired, false);
  assert.equal(s.text, '2 owner groups (3 files)');
});

test('singular group and file', () => {
  const approvalStatus = {
    groupApprovalsReceived: 0,
    groupApprovalsRequired: 1,
    totalFiles: 1,
    ownerApprovalRequired: true,
  };
  assert.equal(
    describeApprovalStatus(approvalStatus),
    '1 owner group (1 file) • 0 of 1 owner groups approved'
  );
});

test('the summary’s parts: groups and files, then approvals if any', () => {
  const approvalStatus = {
    groupApprovalsReceived: 1,
    groupApprovalsRequired: 2,
    totalFiles: 3,
    ownerApprovalRequired: true,
  };
  assert.deepEqual(describeApprovalStatusParts(approvalStatus), [
    '2 owner groups (3 files)',
    '1 of 2 owner groups approved',
  ]);
  assert.deepEqual(
    describeApprovalStatusParts({...approvalStatus, isMerged: true}),
    ['2 owner groups (3 files)']
  );
});

test('groups the user must approve come first', () => {
  const groups = ownership().ownerGroupsMap;
  const order = (data) =>
    sortOwnerGroups(groups, data).map((g) => Array.from(g.owners).join());
  // carol is in @org/web, which has more files anyway: try bob, of @org/api
  assert.deepEqual(order(ownership({user: 'bob'})), ['@org/api', '@org/web']);
  // Approved, the user's group still comes before other teams' groups
  assert.deepEqual(
    order(ownership({user: 'bob', reviewers: new Map([['bob', true]])})),
    ['@org/api', '@org/web']
  );
  // Other teams' approved groups come after those still waiting: for a
  // user in neither team, @org/web approved goes behind @org/api
  assert.deepEqual(
    order(ownership({user: 'dan', reviewers: new Map([['alice', true]])})),
    ['@org/api', '@org/web']
  );
});

test('the PR’s author gets no priority for their own groups', () => {
  const groups = ownership().ownerGroupsMap;
  const data = ownership({user: 'bob', prAuthor: 'bob'});
  // By file count only: @org/web has two files, @org/api one
  assert.deepEqual(
    sortOwnerGroups(groups, data).map((g) => Array.from(g.owners).join()),
    ['@org/web', '@org/api']
  );
});
