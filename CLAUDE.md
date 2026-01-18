 CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a browser extension (Chrome/Firefox) that decorates GitHub PR pages with code ownership information. The extension provides three main decorations:

1. **File header decoration**: Adds owner labels below each file header on PR files page and compare view showing who must approve each file. Clicking a label expands/collapses that owner's files.
2. **Merge box decoration**: Creates an expandable "Code owners" section in the PR conversation page that groups files by owner and shows approval status. Clicking an owner group expands/collapses it.
3. **Comment decoration**: Adds visual role indicators (SVG icons) next to comment author names to show their relationship to the PR:
   - 📄 **Pencil-on-paper icon** (blue): PR author's comments
   - 🛡️ **Shield icon** (green): Code owner's comments (for files they own)
   - 💡 **Lightbulb icon** (yellow): Other contributors' comments

The extension works by:
1. Fetching and parsing the repository's CODEOWNERS file from the PR's base branch (or compare view base branch)
2. Matching PR files against CODEOWNERS patterns using the `ignore` library (gitignore-style matching)
3. Fetching team membership data from GitHub org team pages
4. Decorating PR pages and compare views with owner labels that show approval status and team membership

## Development Workflow

- **Live Development**: Use `npm run watch` for automatic rebuilds during development
  - ⚠️ **IMPORTANT**: User typically has `watch` running. Do NOT run build commands just to update the extension - changes are already being built automatically. Only run `npm run build` if you need to see compilation errors.
- **Testing**: Load `build/` directory as unpacked extension in Chrome/Firefox developer mode
- **Formatting**: Use `npm run format` to fix code formatting. Do not spend time manually formatting code.
- **Changelog**: ALWAYS update `CHANGELOG.md` under the "Unreleased" section when implementing user-facing changes. Use concise bullet points starting with **Feature**, **Fix**, **UX**, or **Internal**.
- **No API Keys**: Extension works entirely through DOM scraping, no GitHub API tokens required
- **Codebase Size**: ~2000 lines total across 7 focused modules
- **Dependencies**: Uses lodash-es (with patches), ignore library, webpack build system

## Architecture

### Entry Point and Build
- **Webpack entry**: `src/decorator.js` (configured in `config/webpack.config.js`)
- **Content script**: Runs on all `https://github.com/*` pages (manifest_version 3)
- **Build output**: Bundled to `build/content.js` with CSS extracted to `build/content.css`
- **Extension type**: Browser extension (Chrome/Firefox) that modifies GitHub's DOM
- **No permissions needed**: Uses content script with host permissions for github.com

### Core Architecture

**Module Organization**
- **`src/decorator.js`**: Entry point - MutationObserver watches `document.body` with 100ms debounce, coordinates all decorations
- **`src/files-page.js`**: Decorates file headers on PR files page and compare view
- **`src/merge-box.js`**: Creates expandable "Code owners" section in conversation page merge box
- **`src/comment-decorator.js`**: Adds role icons (author/owner/other) to comments
- **`src/labels.js`**: Creates owner labels with approval indicators and hover drawers
- **`src/ownership.js`**: Aggregates ownership data via `getPrOwnershipData()` - single source for all decorators
- **`src/github.js`**: Fetches/caches all GitHub data (CODEOWNERS, reviewers, team members, PR info)
- **`src/debug-panel.js`**: Development-only debug UI with approval/merge simulation

**Critical Patterns** ⚠️

1. **MutationObserver + Performance**: Observer watches entire `document.body`, fires on every DOM change
   - Check if decoration exists BEFORE fetching data, or you get infinite loops: add element → observer fires → add element → loop
   - Filter undecorated elements first, return early if none found, THEN fetch expensive ownership data
   - Example: `decorateExistingComments()` uses `data-ghcoDecorating` flag, others use `.ghco-processed` class

2. **State management**: Never derive state from DOM text (e.g., parsing "2 of 3 approvals"). Always pass state as parameters from source data. Text is display only, not source of truth.

3. **Animation timing**: Double RAF for reply buttons is NOT optional - first RAF waits for DOM updates, second ensures layout stable. CSS transitions won't trigger reliably without it.

4. **Global Event Delegation**: Use `document.addEventListener` with `event.target.closest(...)` instead of attaching listeners to individual elements.
   - Reduces listener overhead for large PRs and handles dynamic React updates.
   - Stores callbacks heavily on elements (e.g., `element._onOwnerClick`) for retrieval by the delegate.
   - Uses synthetic events when delegating to existing handlers (e.g. `merge-box.js`).

**Data Flow**
- `getPrOwnershipData()` in `ownership.js` is the single aggregation point - returns: `folderOwners`, `reviewers`, `teamMembers`, `ownerApprovals`, `user`, `userTeams`, `userTeamsMap`, `diffFilesMap`, `prAuthor`
- Pass ownership data as complete object through call chain (avoid destructure/reconstruct)
- `isOwnerOfAnyFile()` iterates `diffFilesMap.values()` not `.keys()` (keys are hashes, not paths)

**Caching Strategy** (`github.js`)
- `prCacheKey()`: Cache per PR (owner/repo/num) - for data that doesn't change between pages
- `urlTimelineCacheKey()`: Cache per URL + timeline count (detects conversation updates)
- `urlPeriodicCacheKey()`: Cache per URL + 30s windows (periodic refresh for fetched pages)
- `prBaseCacheKey()`: Cache CODEOWNERS per base branch (works for PRs and compare view)
- `prCommitsCacheKey()`: Cache per PR + commit count (for expensive file list fetches)
- Cache keys must be synchronous - `getPrInfo()` is safe (it's synchronous)

**Merge Box Smart Updates**
- Tracks state in `section.dataset.state` for automatic updates when approvals change
- Only recreates section when merge status changes (positioning differs for merged/open PRs)
- Updates in-place for approval changes (avoids expensive re-renders)
- `event.isTrusted` distinguishes user clicks from programmatic `.click()` for Alt-click bulk operations

**Label Interaction & Expansion**
- Clicking labels expands code sections programmatically
- `setProgrammaticExpansion(true)` guards against `MutationObserver` loops during these updates
- `ExpansionObserver` watches for UI expansion state to keep internal state synced
- Scroll position is actively restored after expansion using layout delta calculation

## Common Development Patterns

- **GitHub DOM changes**: Handle both old and new UI patterns using fallback selectors
- **Working with DOM samples**: Capture HTML via DevTools, store in `zz-samples/` with descriptive names, and remind the user to delete them before merging
- **Logging philosophy**: Keep console quiet in production. Only log:
  - External data sources that are hard to reproduce (CODEOWNERS parsing, team membership)
  - Debug panel operations (guarded by `__DEBUG__` flag, dev builds only)
  - Build tool output (pack.js)
  - Use `[GHCO]` prefix for runtime logs, `[GHCO Debug]` for debug panel

## Implementation Notes - Non-Obvious Patterns

**GitHub UI Detection:**
- **React embedded data**: Use `getEmbeddedData(doc, extractor)` helper to scrape JSON from GitHub's React app
  - Checks both `react-app.embeddedData` and `react-partial.embeddedData` targets
  - Normalizes `payload` vs `props` structure differences
  - Returns extracted value or `null` if not found/invalid JSON
  - Used in `parseDiffFilesFromDoc()` for new Files UI and `getFolderOwners()` for CODEOWNERS content
- Timeline avatar (`.TimelineItem-avatar[href^="/"]`) reliable for PR author on conversation page (works for merged PRs)
- Header selectors show merger for merged PRs, not original author - don't use for merged state
- Skip sticky headers (`.sticky-file-header`) - they lack path data
- **Bot username handling**: GitHub bots use `/apps/{name}` hrefs (e.g., `/apps/dependabot`)
  - Transform to `{name}[bot]` format for consistency with PR author format
  - Use `github.normalizeAuthorHref()` helper for both author extraction and comment decoration

**Comment Decoration Selectors:**
- Draft Write tabs: Old UI `.CommentBox-header .write-tab`, new UI `[class*="prc-TabNav"] button[role="tab"]:first-of-type`
- Reply buttons: Old UI `.review-thread-review-button`, new UI `button[class*="CompactCommentButton"]`
- Placeholders: Old UI `.CommentBox-placeholder` element, new UI textarea `placeholder` attribute

**Data Flow:**
- `diffFilesMap.values()` for file paths (not `.keys()` which are hashes)
- Pass ownership data as complete object through call chain (avoid destructure/reconstruct)
- Cache keys must be synchronous - `getPrInfo()` is safe (it's synchronous)
- `getPrAuthor()` included in `ownershipData` - fetched once, all consumers get it from ownershipData object
- Live updates: Use `getReviewersFromDoc(document)` for synchronous access to current approval state
- File paths: Old UI has `data-path` attribute - use directly instead of digest lookup for reliability with lazy-loaded files

**CSS Organization:**
- Styles split into feature files: `file-labels.css`, `merge-box.css`, `comments.css`, `debug-panel.css`
- All styles use `ghco-` prefix to avoid conflicts
- CSS anchor positioning for label drawers
- Module-specific transitions: `--ghco-label-transition`, `--ghco-merge-box-transition`, `--ghco-comment-icon-transition`
- **Fixed px for UI components** (labels, icons), **GitHub vars for layouts** (spacing, borders, typography)
- **JS/CSS coordination**: Drawer corner rounding value `9` in `labels.js` must match CSS `border-radius: 9px`
- **Scroll hints**: pure CSS implementation using `background-attachment: local, scroll` (merge-box.css)

**Pattern Matching:**
- CODEOWNERS patterns matched using `ignore` library with `.ignores()` method
- Individual users create "pseudo-teams" for consistent handling
- Files with no CODEOWNERS entry show "any reviewer" label

---

## Maintaining This Document

**When to update:**
- Architecture decision changed → Update relevant section
- Critical bug pattern identified → Add with ⚠️ warning explaining WHY

**What NOT to document:**
- Details already clear in code
- Step-by-step feature explanations (code is source of truth)

**⚠️ CRITICAL patterns:**
1. Mark with **⚠️ CRITICAL - DO NOT REMOVE**
2. Explain WHY it breaks without it
3. Specify WHERE it's used
4. Before "simplifying" marked code, STOP and ask
