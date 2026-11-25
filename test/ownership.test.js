import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCodeowners} from '../core/codeowners.js';
import {
  buildApprovalMaps,
  createOwnerGroupsMap,
  buildOwnershipData,
  describeOwner,
  sortOwners,
  anyReviewerApprovers,
  fileHasOwners,
  isOwnerOfFile,
  isOwnerOfAnyFile,
} from '../core/ownership.js';

// Teams as resolveOwnerTeams() returns them: a user owner is a pseudo-team
// of its own login
const teamMembers = new Map([
  ['@org/web', ['alice', 'carol']],
  ['@org/api', ['bob']],
  ['@dave', ['@dave']],
]);

const folderOwners = parseCodeowners([
  '* @org/web',
  '/api/ @org/api',
  '/shared/ @org/web @org/api',
  '/scripts/ @dave',
  '/vendor/',
]);

// The browser keys files by diff digest, so keys are not paths
const diffFilesMap = new Map([
  ['d1', 'src/app.js'],
  ['d2', 'src/view.js'],
  ['d3', 'api/server.js'],
  ['d4', 'shared/util.js'],
  ['d5', 'vendor/lib.js'],
]);

const ownership = (overrides = {}) =>
  buildOwnershipData({
    folderOwners,
    reviewers: new Map(),
    teamMembers,
    user: 'carol',
    diffFilesMap,
    prAuthor: 'erin',
    ...overrides,
  });

test('an approval counts for every team the approver is in', () => {
  const {ownerApprovals} = buildApprovalMaps(
    new Map([
      ['alice', true],
      ['bob', false],
    ]),
    teamMembers
  );
  assert.ok(ownerApprovals.has('@org/web'));
  assert.ok(ownerApprovals.has('alice'));
  assert.ok(!ownerApprovals.has('@org/api'));
});

test('an approver in no team approves as themselves', () => {
  const {ownerApprovals} = buildApprovalMaps(
    new Map([['erin', true]]),
    teamMembers
  );
  assert.deepEqual(Array.from(ownerApprovals), ['erin']);
});

test('each user is in a pseudo-team of their own login', () => {
  const {userTeamsMap} = buildApprovalMaps(new Map(), teamMembers);
  assert.deepEqual(Array.from(userTeamsMap.get('carol')), [
    'carol',
    '@org/web',
  ]);
});

test('files are grouped by their set of owners', () => {
  const groups = createOwnerGroupsMap(diffFilesMap, folderOwners);
  assert.deepEqual(Array.from(groups.keys()), [
    '@org/web',
    '@org/api',
    '@org/api,@org/web',
    '__any__',
  ]);
  assert.deepEqual(groups.get('@org/web').paths, ['src/app.js', 'src/view.js']);
  assert.deepEqual(groups.get('@org/web').digests, ['d1', 'd2']);
});

test('the owners’ order in CODEOWNERS doesn’t split a group', () => {
  const groups = createOwnerGroupsMap(
    new Map([
      ['a', 'one/a.js'],
      ['b', 'two/b.js'],
    ]),
    parseCodeowners(['/one/ @org/web @org/api', '/two/ @org/api @org/web'])
  );
  assert.equal(groups.size, 1);
});

test('files without owners form the "any reviewer" group', () => {
  const group = createOwnerGroupsMap(diffFilesMap, folderOwners).get('__any__');
  assert.equal(group.owners, null);
  assert.deepEqual(group.paths, ['vendor/lib.js']);
});

test('hasOwnedFiles is false when no PR file has an owner', () => {
  const data = ownership({diffFilesMap: new Map([['d5', 'vendor/lib.js']])});
  assert.equal(data.hasOwnedFiles, false);
  assert.equal(ownership().hasOwnedFiles, true);
});

test('★ is team membership; approving needs not being the author', () => {
  const reviewer = describeOwner('@org/web', ownership());
  assert.equal(reviewer.isYours, true);
  assert.equal(reviewer.canApprove, true);

  // On the user's own PR the ★ stays, but they can't approve
  const author = describeOwner('@org/web', ownership({prAuthor: 'carol'}));
  assert.equal(author.isYours, true);
  assert.equal(author.canApprove, false);

  assert.equal(describeOwner('@org/api', ownership()).isYours, false);
});

test('an owner is approved once a member approved', () => {
  const data = ownership({reviewers: new Map([['bob', true]])});
  assert.equal(describeOwner('@org/api', data).approved, true);
  assert.equal(describeOwner('@org/web', data).approved, false);
});

test('owners sort with the user’s teams first, else in their order', () => {
  assert.deepEqual(sortOwners(['@org/api', '@dave', '@org/web'], ownership()), [
    '@org/web',
    '@org/api',
    '@dave',
  ]);
});

test('approvers of an ownerless group are those outside any owner team', () => {
  const data = ownership({
    reviewers: new Map([
      ['alice', true],
      ['erin', true],
    ]),
  });
  assert.deepEqual(anyReviewerApprovers(data).sort(), ['alice', 'erin']);
});

test('fileHasOwners is false for a rule without owners', () => {
  assert.equal(fileHasOwners('src/app.js', ownership()), true);
  assert.equal(fileHasOwners('vendor/lib.js', ownership()), false);
});

test('a commenter owns a file through any of their teams', () => {
  const data = ownership();
  assert.equal(isOwnerOfFile('carol', 'src/app.js', data), true);
  assert.equal(isOwnerOfFile('carol', 'api/server.js', data), false);
  assert.equal(isOwnerOfFile('bob', 'shared/util.js', data), true);
  assert.equal(isOwnerOfFile('stranger', 'src/app.js', data), false);
});

test('owning any PR file looks at paths, not digests', () => {
  const data = ownership({diffFilesMap: new Map([['d3', 'api/server.js']])});
  assert.equal(isOwnerOfAnyFile('bob', data), true);
  assert.equal(isOwnerOfAnyFile('carol', data), false);
});

test('without the PR’s files, owning any CODEOWNERS rule counts', () => {
  const data = ownership({diffFilesMap: null});
  assert.equal(isOwnerOfAnyFile('bob', data), true);
  assert.equal(isOwnerOfAnyFile('stranger', data), false);
});
