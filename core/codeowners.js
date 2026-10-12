import ignore from 'ignore';

// Pure CODEOWNERS logic, shared by the browser and VSCode extensions.
// No DOM, fetch, chrome.* or __DEBUG__ in core/.

export const CODEOWNERS_PATHS = [
  '.github/CODEOWNERS',
  'CODEOWNERS',
  'docs/CODEOWNERS',
];

// Meaningful lines only: no blanks, no comments, no trailing comments
export const codeownersLines = (rawLines) =>
  rawLines
    .map((line) => line.replace(/\s#.*$/, '').trim())
    .filter((line) => line.length && !line.startsWith('#'));

// Reversed so that `find()` returns the last matching rule, as GitHub does
export const parseCodeowners = (lines) =>
  codeownersLines(lines)
    .map((line) => {
      const [folder, ...owners] = line.split(/\s+/);
      return {
        folderMatch: ignore().add(folder),
        owners: new Set(owners),
      };
    })
    .reverse();

export const findFileOwners = (path, folderOwners) =>
  folderOwners.find(({folderMatch}) => folderMatch.ignores(path));
