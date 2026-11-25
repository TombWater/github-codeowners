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

// gitignore semantics, with one difference GitHub documents: `docs/*` matches
// the files in docs/ but not those in its subfolders, where gitignore's
// ignored folder would hide everything below it. The negation re-includes
// those subfolders.
const folderMatcher = (folder) =>
  ignore().add(folder.endsWith('/*') ? [folder, `!${folder}/`] : folder);

// Reversed so that `find()` returns the last matching rule, as GitHub does
export const parseCodeowners = (lines) =>
  codeownersLines(lines)
    .map((line) => {
      const [folder, ...owners] = line.split(/\s+/);
      return {
        folderMatch: folderMatcher(folder),
        owners: new Set(owners),
      };
    })
    .reverse();

export const findFileOwners = (path, folderOwners) =>
  folderOwners.find(({folderMatch}) => folderMatch.ignores(path));
