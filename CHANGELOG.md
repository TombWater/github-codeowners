# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
- **UX**: De-selecting owner labels now restores expansion based on the "Viewed" checkbox state
- **Fix**: Merge box file links now correctly go to the specific file by forcing full page navigation
- **Fix**: Eliminated scroll jumping when owner label decorations are added to the files page
- **Fix**: Eliminated scroll jumping when clicking owner labels by blocking GitHub's scroll events during expand/collapse operations
- **Fix**: Remove incorrect rounded radius on drawer top after clicking owner labels to expand/collapse files
- **Fix**: Prevented "Extension context invalidated" errors that could occur when the extension is reloaded while a GitHub page is open.

## [0.7.0] - 2026-01-18
- **Feature**: Clicking an owner label now expands that owner's corresponding files.
- **Feature**: Added a "What's New" banner that appears in the merge box when the extension is updated, linking to the changelog.
- **UX**: Added shadow affordances to the merge box file list to indicate when the content is scrollable.
- **Internal**: Refactored to use global event delegation, improving performance and reliability with dynamic content updates.

## [0.6.3] - 2025-12-11
- **Feature**: Added a total file count to the main header of the "Code owners" merge box section.
- **Fix**: Significantly improved reliability when loading the list of changed files by implementing multiple fallback strategies for different GitHub UI states.

## [0.6.2] - 2025-12-10
- **Fix**: The "Any reviewer" group (files with no specific owner) now correctly counts as a required approval block for the overall status calculation.
- **Fix**: Improved detection of the merge box container and diff summaries to prevent cases where decorations would fail to load on certain PR views.
- **Fix**: Firefox manifest permissions update.

## [0.6.1] - 2025-12-03
- **Security/Fix**: Switched to parsing and cloning SVGs safely instead of using `innerHTML`, resolving Firefox store security warnings.
- **Fix**: Corrected the bottom corner radius and background color of the merge box to better match GitHub's native design.

## [0.6.0] - 2025-12-03
- **Feature (Comment Decoration)**: Visual role indicators (SVG icons) are now added next to comment headers.
  - 📄 **Document**: PR Author
  - 🛡️ **Shield**: Code Owner
  - 💡 **Lightbulb**: Other contributor
- **Feature (Compare Page)**: The extension now works on the "Compare" view, not just Pull Request pages.
- **Feature (Live Updates)**: The extension now reacts in real-time to page updates (like merging a PR or pushing new commits) without requiring a reload.
- **Feature (Merge Box)**: File groups in the merge box code owners section are now expandable/collapsible.
- **UX**: Improved sorting logic in the merge box to prioritize groups where the current user's review is requested, followed by other pending reviews.
- **Internal**: Completely re-implemented data scraping to use GitHub's embedded JSON data for robust access to PR metadata.
- **Internal**: Major refactoring of CSS to be modular and feature-specific.

## [0.5.1] - 2025-10-06
- **Feature**: Added a file count badge (e.g., "3 files") to each owner group in the merge box.
- **Feature**: The "Code owners" section now remembers its expanded/collapsed state between page loads.
- **UX**: The header icon now changes color (green/gray) to reflect the overall approval status.
- **Fix**: Replaced fragile DOM element cloning with direct SVG creation to prevent breakages when GitHub changes their markup.

## [0.5.0] - 2025-10-03
- **Feature (Merge Box)**: Added a major new "Code owners" section to the PR conversation overview. This groups all changed files by their owner and shows approval status for each group.
- **Internal**: Major refactor to split the monolithic `content.js` into modular files (`merge-box.js`, `files-page.js`, `github.js`, etc.).

## [0.4.1] - 2025-09-11
- **UX**: Renamed the "anybody" label to "any reviewer" for clarity on files that don't have a specific code owner.
- **Fix**: Smarter detection of sticky file headers to prevent duplicate or missing file decorations.
- **Fix**: Cleared the "highlighted owner" state when switching between files or when the file list updates.

## [0.4.0] - 2025-07-05
- **Interaction Change**: Clicking a code owner label now just highlights other labels for the same owner instead of expanding the file list, as the previous expansion implementation was incompatible with GitHub's React-based UI refresh.
- **UX**: Replaced native title tooltips with a custom "Drawer" UI that slides out from the label to show detailed approval info.
- **Build**: Excluded shell scripts and unnecessary files from the production build.

## [0.3.0] - 2025-03-28
- **Feature**: Files with no defined owner now show an "anybody" label, which lists all current reviewers on the PR.
- **Feature**: Code owner labels and approval status are now displayed when viewing individual commits, extending functionality beyond the 'Files changed' tab.
- **Fix**: Team approvals are now correctly recognized (checking if *any* member of the requested team has approved).
- **Fix**: Fixed an issue where CODEOWNERS data couldn't be read for closed or merged PRs.

## [0.2.0] - 2025-03-02
- **Major Architecture Change**: Completely rewrote the extension to use DOM scraping instead of the GitHub API.
  - **Privacy**: No longer requires a Personal Access Token (PAT).
  - **Ease of use**: Works immediately upon installation without configuration.
- **Platform**: Added full support for Firefox.
- **Feature**: Now scrapes Team membership and CODEOWNERS data directly from the repository pages.

## [0.1.0] - 2025-01-31
- **Release**: Initial release.
- **Feature**: Decoration of file headers with code owner labels.
- **Feature**: Basic approval status indication.
- **Platform**: Chrome support.
