import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  codeownersLines,
  parseCodeowners,
  findFileOwners,
} from '../core/codeowners.js';

const ownersOf = (path, lines) =>
  Array.from(findFileOwners(path, parseCodeowners(lines))?.owners ?? []);

test('drops blank lines, comment lines and trailing comments', () => {
  assert.deepEqual(
    codeownersLines([
      '# Docs',
      '',
      '   ',
      '/docs/ @org/docs # docs team',
      '*.js @org/web',
    ]),
    ['/docs/ @org/docs', '*.js @org/web']
  );
});

test('keeps a # inside a pattern, which isn’t a comment', () => {
  assert.deepEqual(codeownersLines(['/a#b @org/web']), ['/a#b @org/web']);
});

test('a trailing comment is not read as an owner', () => {
  assert.deepEqual(ownersOf('docs/a.md', ['/docs/ @org/docs # docs team']), [
    '@org/docs',
  ]);
});

test('the last matching rule wins', () => {
  const lines = ['* @org/all', '/docs/ @org/docs'];
  assert.deepEqual(ownersOf('docs/a.md', lines), ['@org/docs']);
  assert.deepEqual(ownersOf('src/a.js', lines), ['@org/all']);
});

test('a rule lists all its owners', () => {
  assert.deepEqual(ownersOf('a.js', ['*.js @org/web @alice']), [
    '@org/web',
    '@alice',
  ]);
});

test('a file no rule matches has no entry', () => {
  assert.equal(
    findFileOwners('src/a.js', parseCodeowners(['/docs/ @org/docs'])),
    undefined
  );
});

test('a rule without owners matches with an empty owner set', () => {
  const lines = ['* @org/all', '/vendor/'];
  const entry = findFileOwners('vendor/lib.js', parseCodeowners(lines));
  assert.equal(entry.owners.size, 0);
});

// Examples from GitHub's CODEOWNERS documentation
test('patterns match as GitHub documents them', () => {
  const cases = [
    // [pattern, path, matches]
    ['*.js', 'a.js', true],
    ['*.js', 'x/y/z.js', true],
    ['*.js', 'a.jsx', false],
    ['/build/logs/', 'build/logs/a.log', true],
    ['/build/logs/', 'src/build/logs/a.log', false],
    ['apps/', 'apps/a.js', true],
    ['apps/', 'src/apps/a.js', true],
    ['/docs/', 'docs/sub/a.md', true],
    ['/docs/', 'src/docs/a.md', false],
    ['**/logs', 'deep/logs/a.log', true],
    ['README.md', 'sub/README.md', true],
    ['docs/*', 'docs/getting-started.md', true],
    // "but not further nested files like docs/build-app/troubleshooting.md"
    ['docs/*', 'docs/build-app/troubleshooting.md', false],
    ['/docs/*', 'docs/build-app/troubleshooting.md', false],
    ['docs/**', 'docs/build-app/troubleshooting.md', true],
  ];
  for (const [pattern, path, matches] of cases) {
    assert.equal(
      Boolean(findFileOwners(path, parseCodeowners([`${pattern} @o`]))),
      matches,
      `${pattern} on ${path}`
    );
  }
});

test('a nested file below docs/* falls through to an earlier rule', () => {
  const lines = ['* @org/all', 'docs/* @org/docs'];
  assert.deepEqual(ownersOf('docs/build-app/troubleshooting.md', lines), [
    '@org/all',
  ]);
});
