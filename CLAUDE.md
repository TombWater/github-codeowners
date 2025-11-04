 CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a browser extension (Chrome/Firefox) that decorates GitHub PR pages with code ownership information. The extension provides three main decorations:

1. **File header decoration**: Adds owner labels below each file header on PR files page showing who must approve each file
2. **Merge box decoration**: Creates an expandable "Code owners" section in the PR conversation page that groups files by owner and shows approval status
3. **Comment decoration**: Adds visual role indicators (SVG icons) next to comment author names to show their relationship to the PR:
   - 📄 **Pencil-on-paper icon** (blue): PR author's comments
   - 🛡️ **Shield icon** (green): Code owner's comments (for files they own)
   - 💡 **Lightbulb icon** (yellow): Other contributors' comments

The extension works by:
1. Fetching and parsing the repository's CODEOWNERS file from the PR's base branch
2. Matching PR files against CODEOWNERS patterns using the `ignore` library (gitignore-style matching)
3. Fetching team membership data from GitHub org team pages
4. Decorating PR pages with owner labels that show approval status and team membership

## Build and Development Commands

```bash
# Install dependencies (runs patch-package automatically via postinstall)
npm install

# Development mode with watch and source maps
npm run watch

# Production build (cleans build/ directory first)
npm run build

# Format code with Prettier (ALWAYS use this instead of manually fixing formatting)
npm run format

# Create release zip in release/ directory (reads version from build/manifest.json)
npm run pack

# Build and pack in one command
npm run repack

# Create distributable zip in root directory
npm run zip
```

**Important**: Use `npm run format` to fix code formatting. Do not spend time manually formatting code.

## Development Workflow

- **Live Development**: Use `npm run watch` for automatic rebuilds during development
  - ⚠️ **IMPORTANT**: User typically has `watch` running. Do NOT run build commands just to update the extension - changes are already being built automatically. Only run `npm run build` if you need to see compilation errors.
- **Testing**: Load `build/` directory as unpacked extension in Chrome/Firefox developer mode
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

### Core Components

**`src/decorator.js`** - Main orchestration and entry point
- Sets up MutationObserver with debounced updates for all page decorations
- Coordinates calls to `updatePrFilesPage()`, `updateMergeBox()`, and `updateCommentDecorations()` functions
- Imports CSS and manages top-level extension lifecycle
- **Clean architecture**: Very minimal orchestration layer
- **MutationObserver**: Watches entire `document.body` with 100ms debounce - all decoration functions must check if elements already exist to avoid infinite loops

**`src/files-page.js`** - File header decoration
- **`updatePrFilesPage()`**: Decorates file headers on PR files page with owner labels
- **`decorateFileHeader()`**: Adds owner labels below each file header
- **`getFileHeadersForDecoration()`**: Finds file headers that need decoration
- **Ownership data handling**: Passes complete ownership data object to maintain architectural consistency
- Handles both old and new GitHub PR UI selectors

**`src/conversation-page.js`** - Merge box decoration
- **`updateMergeBox()`**: Creates expandable "Code owners" section in PR conversation merge box
- **`findSectionPosition()`**: Determines correct insertion point for section based on merge box structure
- **`ensureCorrectPosition()`**: Checks and repositions section when merge box structure changes (handles GitHub React app updates)
- **Live updates**: Tracks approval state in `section.dataset.state` for automatic updates when approvals change
- **State management**: Compares old vs new state (merge status + approvers) to determine if update needed
- **Smart repositioning**: Only recreates section when merge status changes, updates in-place for approval changes
- **Section positioning**: Places section after "Pull request successfully merged" message on merged PRs, or after Reviews section on open PRs
- **Groups files by owner**: Shows owner groups with file lists and approval status
- **Progressive loading**: Shows loading state immediately, then populates with data
- **Expandable UI**: Uses GitHub's native expandable section styling with CSSOM-based class detection
- **Priority sorting**: Owner groups sorted by user relevance (user-only → user co-owners → approved → others)
- **Performance**: Early returns when section already up-to-date, avoiding unnecessary data fetches

**`src/labels.js`** - Owner label creation and interaction
- **`createOwnerLabels()`**: Creates owner labels with approval status indicators (✓ for approved, ★/☆ for user's teams)
- **Ownership data interface**: Accepts `{owners, ownershipData}` parameters for clean separation of concerns
- **`clearHighlightedOwner()`**: Manages click-to-highlight functionality across all owner labels
- **Drawer management**: Hover drawers showing team members using CSS anchor positioning and Popover API
- **Label sorting**: User's own teams always appear first in label lists

**`src/ownership.js`** - Data aggregation and ownership checking
- **`getPrOwnershipData()`**: Aggregates data from multiple github.js functions and processes it for UI needs
- **`getUserLogin()`**: Extracts current user information from GitHub DOM
- **`isOwnerOfFile()`**: Checks if commenter owns a specific file based on CODEOWNERS and team membership
- **`isOwnerOfAnyFile()`**: Checks if commenter owns any file in the PR (iterates `diffFilesMap.values()` not `.keys()`)
- **Team processing**: Handles team membership, approvals, and user team associations
- **Centralized ownership logic**: All ownership determination in one module for reuse across decorators

**`src/github.js`** - GitHub data fetching and caching
- **Caching strategy**: Uses lodash `memoize` with custom single-entry cache implementation
  - `urlCacheKey()`: Cache per PR URL
  - `repoCacheKey()`: Cache team members per repository
  - `prBaseCacheKey()`: Cache CODEOWNERS per base branch
- **`getIsMerged()`**: Checks merge status via DOM query (not cached - just a querySelector, exported for use in conversation-page.js)
- **`getPrInfo()`**: Synchronously extracts owner/repo/PR number/base branch/page from URL and DOM (no author or merge status - lightweight, use for file links and URLs)
- **`getPrAuthor()`**: Async function that extracts PR author from various DOM sources with fallbacks (cached per URL, expensive - only use when needed for comment decorations)
- **`getDiffFilesMap()`**: Maps file path digests to paths (handles both old/new GitHub UI)
- **`getFolderOwners()`**: Fetches CODEOWNERS from `.github/`, root, or `docs/` directory
- **`getReviewers()`**: Async function that fetches reviewer data from conversation page if not already there
- **`getReviewersFromDoc()`**: Synchronously extracts reviewer approval status from a document (for live updates on conversation page)
- **`getTeamMembers()`**: Fetches team member lists by scraping org team pages (handles pagination)
  - **Defensive checks**: Validates `folderOwners` parameter is defined and is an array before processing
  - **Consistent return type**: Always returns `Map` (not array) for type consistency
- **`getGithubClassNames()`**: Cached CSSOM parser that finds all GitHub CSS module class names in one pass using closure-based caching
- **Debug mode support**:
  - `getIsMerged()` checks `window.__ghcoDebugPanel` for simulated merge state
  - `getReviewersFromDoc()` applies simulated approvals from debug panel

**`src/debug-panel.js`** - Debug and testing tools (only included in development builds via `npm run watch`)
- **Debug panel UI**: Fixed bottom-right panel showing update count, last update time, and current state
- **Approval simulation**: Interactive popup to toggle approval states for any team member, triggers DOM mutations to test live updates
- **Merge simulation**: One-way operation that removes other merge box sections and adds "Pull request successfully merged" message
- **State tracking**: Real-time stats display with 500ms polling, filtered mutation observer to avoid infinite loops
- **URL change detection**: Automatically resets simulations when navigating between PRs
- **Cross-module communication**: Exposes functions via `window.__ghcoDebugPanel` for use in github.js
  - `getSimulatedApprovals()`: Returns Map of owner → approval state for simulated approvals
  - `getSimulatedMergeState()`: Returns simulated merge state (null = use real state, true/false = simulated)
- **Styling**: Separated into `src/debug-panel.css` with `ghco-` prefixed classes

**`src/comment-decorator.js`** - Comment author role decoration
- **`updateCommentDecorations()`**: Decorates comments, draft forms, reply buttons, and placeholders (runs all in parallel)
- **`decorateExistingComments()`**: Adds SVG role icons next to comment author names
- **`decorateDraftWriteTabs()`**: Adds role icon to Write tab when opening comment form (handles old/new UI)
- **`decorateReplyButtons()`**: Adds role icon and updates button text to "Reply as {role}..."
- **`updateDraftPlaceholderText()`**: Updates placeholder text ("Comment as owner...", "Reply as author...")
- **`getCommenterRole()`**: Determines icon based on PR author and code ownership (file-specific or PR-level)
- **`getCommentFilePath()`**: Extracts file context from comment DOM (supports 5 GitHub UI patterns)
- **Icon system**: Three SVG icons (pencil-paper/blue for author, shield/green for owner, lightbulb/yellow for others)
- **Animation**: Icons reveal via `requestAnimationFrame` after DOM insertion (0.15s ease-out transition)
- **Race condition protection**: ⚠️ **CRITICAL - DO NOT REMOVE**
  - `decorateExistingComments()`: Uses `data-ghcoDecorating` flag (decorates parent, can't use class on author link)
  - Other functions: Use `.ghco-processed` class with double-check pattern (queried in selector AND checked in loop)
  - Without these checks, MutationObserver firing during async operations causes duplicate icons

### Key Technical Details

- **Pattern matching**: CODEOWNERS folder patterns are matched using `ignore` library with `.ignores()` method (matching = true means the pattern applies)
- **Team resolution**: Individual users in CODEOWNERS create "pseudo-teams" containing just that user for consistent handling
- **User ownership**: Files with no CODEOWNERS entry show "any reviewer" label (anyone with write access can approve)
- **Highlighting**: Clicking a label toggles `ghco-highlight-active` body class and `ghco-label--highlighted` on matching labels
- **Merge box priority**: Owner groups sorted by user relevance (user-only owners → user co-owners → user approved → others needing approval → others approved)
- **Live updates**: Merge box section tracks state (merge status + approvers) in data attribute and updates automatically when approvals change
- **Smart repositioning**: `ensureCorrectPosition()` checks section position on every update to handle GitHub React app dynamically changing merge box structure
- **State-based updates**: Only fetches data when state changes or section lacks content, avoiding expensive operations on every mutation
- **Shared label creation**: `createOwnerLabels()` is used by both file header and merge box decorations with consistent `{owners, ownershipData}` interface
- **Data orchestration**: `getPrOwnershipData()` in ownership.js aggregates data from multiple github.js functions and processes it for UI needs
- **Ownership data flow**: Complete ownership objects passed through call chain to avoid repetitive destructuring and reconstruction
- **No API token required**: All data fetched by scraping GitHub HTML pages using `fetch()` with credentials
- **Modular architecture**: Code split into focused modules (decorator.js, files-page.js, conversation-page.js, labels.js, ownership.js, github.js)
- **CSSOM consolidation**: `getGithubClassNames()` closure-based caching parses all stylesheets once to find 8 GitHub CSS module patterns, eliminating repetitive CSSOM searches
- **classList.add() safety**: Direct calls without conditionals since it silently ignores undefined/null values
- **Debug mode**: Debug panel automatically enabled in development builds (`npm run watch`), completely excluded from production builds (`npm run build`, `npm run zip`)
- **MutationObserver infinite loop prevention**: ⚠️ **CRITICAL** - All decoration functions MUST check if decoration already exists before adding it. The observer watches entire `document.body` with 100ms debounce - adding elements triggers observer → updateAll → adds elements → infinite loop. Check for existing decorations first.
- **CSSOM vs CSS selectors**: Use CSSOM (`getGithubClassNames()`) only when creating new elements needing exact class names. For querying existing elements, use attribute selectors like `[class*="module-name"]` - more robust and doesn't require CSSOM parsing.
- **Structural selectors only**: Never query by text content - use attributes, classes, and positions (`:first-of-type`) for reliable element detection across GitHub UI changes.

### CSS Architecture
- Styles split into feature-specific files imported by their respective modules:
  - `src/file-labels.css` → `files-page.js` (labels, drawers, highlighting)
  - `src/merge-box.css` → `conversation-page.js` (owner groups, file lists)
  - `src/comments.css` → `comment-decorator.js` (icons, placeholder text)
- All styles use `ghco-` prefix to avoid conflicts
- CSS anchor positioning for label drawers
- Single `--ghco-reveal-transition` variable (0.15s ease-out) for consistent animations
- Theming via CSS custom properties: yellow (default), red (user), green (approved)

## Common Development Patterns

- **Check → Fetch → Process**: Always check DOM state before fetching expensive data (see Performance section)
- **File organization**: Each module has single responsibility (orchestration, UI, data)
- **Keep it DRY**: Centralize shared logic (e.g., ownership checking in ownership.js, not duplicated)
- **Working with DOM samples**: Ask user to capture HTML via DevTools (Copy outerHTML), store temporarily in `zz-samples/` with descriptive names, delete before merging to main
- **Error handling**: Graceful degradation when GitHub changes DOM or CODEOWNERS is missing
- **GitHub DOM changes**: Handle both old and new UI patterns using fallback selectors
- **Ownership data architecture**: Ownership data flows as cohesive object rather than being destructured/reconstructed multiple times throughout call chain
- **Function signatures**: Clean parameter patterns - minimal destructuring, pass complete objects when appropriate
- **Style properties**: Use individual `element.style.property = value` assignments instead of `cssText` strings for clarity and maintainability
- **Inline styles**: Avoid inline styles in JavaScript; use CSS classes and stylesheets instead for maintainability
- **Merge state changes**: Section recreated when PR transitions between merged/unmerged states to ensure correct positioning below "Pull request successfully merged" message

## Testing Tools

**Debug Panel** (automatically enabled in development builds)
- Only included when using `npm run watch` (development mode), completely excluded from production builds
- Real-time statistics panel (update count, last update time, section state)
- Six debug functions:
  - Force Update: Manually trigger updateAll()
  - Log Current State: Console logs PR info, section existence, merge box state
  - Log Ownership Data: Console logs complete ownership data structure
  - Clear Session State: Removes expand state from sessionStorage
  - Simulate Approval Change: Interactive popup to toggle approvals for any team member
  - Simulate Merge: One-way simulation of PR merge (removes sections, adds merged message)
- Approval simulation shows team-grouped checkboxes for all owners with files in current PR
- Merge simulation removes all merge box sections except Code owners and adds "Pull request successfully merged" message
- Simulations automatically reset when navigating to different PRs
- Debug panel mutations filtered from MutationObserver to prevent infinite loops

### Implementation Notes

**GitHub UI Detection:**
- Use React embedded data when available - most reliable for merged PR metadata
- Timeline avatar (`.TimelineItem-avatar[href^="/"]`) reliable for PR author on conversation page (works for merged PRs)
- Header selectors show merger for merged PRs, not original author - don't use for merged state
- Skip sticky headers (`.sticky-file-header`) - they lack path data

**Comment Decoration Selectors:**
- Draft Write tabs: Old UI `.CommentBox-header .write-tab`, new UI `[class*="prc-TabNav"] button[role="tab"]:first-of-type` (Write always first)
- Reply buttons: Old UI `.review-thread-reply-button`, new UI `button[class*="CompactCommentButton"]`
- Placeholders: Old UI `.CommentBox-placeholder` element, new UI textarea `placeholder` attribute
- **Animation timing** ⚠️ **CRITICAL - DO NOT CHANGE**:
  - Single RAF for batch inserts when no DOM changes needed (comments, write tabs) - triggers after all DOM insertions complete
  - Double RAF for reply buttons: First RAF waits for DOM updates (text node changes), second RAF ensures layout stabilizes before animation starts (required for CSS transitions to trigger properly)
  - The double RAF is NOT optional - without it, animations won't trigger reliably

**Data Flow:**
- `diffFilesMap.values()` for file paths (not `.keys()` which are hashes)
- Pass ownership data as complete object through call chain (avoid destructure/reconstruct)
- Cache keys must be synchronous - `getPrInfo()` is safe to use (it's synchronous)
- **Prefer `getPrInfo()` and `getPrAuthor()` separately** - only fetch author when needed (comment decorations), use `getPrInfo()` for file links/URLs
- **Live updates**: Use `getReviewersFromDoc(document)` on conversation page for synchronous access to current approval state

### CSS Organization

- Styles split into feature-specific files imported by their respective modules:
  - `src/file-labels.css` → `files-page.js` (labels, drawers, highlighting)
  - `src/merge-box.css` → `conversation-page.js` (owner groups, file lists)
  - `src/comments.css` → `comment-decorator.js` (icons, placeholder text)
  - `src/debug-panel.css` → `debug-panel.js` (debug UI)
- All styles use `ghco-` prefix to avoid conflicts
- CSS anchor positioning for label drawers
- Single `--ghco-reveal-transition` variable (0.15s ease-out) for consistent animations
- Theming via CSS custom properties: yellow (default), red (user), green (approved)

## Known Issues and Future Work

- ⚠️ **Merge box UX**: File lists too long, need collapsible sections
- ⚠️ **Accessibility gaps**: Missing `aria-label` on owner label buttons, non-standard `role="drawer"` on hover drawers
- ⚠️ Test performance with 100+ comment PRs
- ⚠️ Use GitHub design system variables instead of hardcoded px values

---

## Meta: Maintaining This Document

**When to update:**
- New module added → Add to Core Components with one-line descriptions of key functions
- New GitHub UI pattern discovered → Add selector to Implementation Notes
- Performance issue found/fixed → Update Performance section with pattern
- Architecture decision changed → Update relevant section (e.g., data flow, caching strategy)
- Critical bug pattern identified → Add to Key Technical Details or Implementation Notes with ⚠️ warning

**What NOT to document:**
- Implementation details already clear in code comments
- Every single function (only document entry points and key architectural functions)
- Step-by-step how features work (code is the source of truth)
- Temporary debugging notes (clean these up after issue is resolved)

**Structure to maintain:**
- Keep Core Components section focused on "what and why", not "how"
- Implementation Notes should be quick reference for debugging, not tutorials
- Performance section should show patterns, not enumerate every optimization
- Known Issues should be actionable, not wishlist items

**⚠️ CRITICAL: When documenting defensive patterns (race condition fixes, animation timing, etc.):**
1. **Mark them with ⚠️ CRITICAL - DO NOT REMOVE**
2. **Explain WHY** - what breaks without it, not just what it does
3. **Specify WHERE** - which functions/files use the pattern
4. **Include consequences** - what happens if removed (e.g., "causes duplicate icons", "animations won't trigger")
5. If you're tempted to "clean up" or "simplify" code marked CRITICAL, STOP and ask the user first

**Before making "improvements" to existing code:**
1. Search CLAUDE.md for mentions of the pattern you want to change
2. Check for ⚠️ CRITICAL warnings
3. If marked critical, understand WHY before changing
4. If not documented as critical but seems defensive (flags, double-checks, timing), ASK before removing

## Common Development Patterns

- **Check → Fetch → Process**: Always check DOM state before fetching expensive data (see Performance section)
- **File organization**: Each module has single responsibility (orchestration, UI, data)
- **Keep it DRY**: Centralize shared logic (e.g., ownership checking in ownership.js, not duplicated)
- **Working with DOM samples**: Ask user to capture HTML via DevTools (Copy outerHTML), store temporarily in `zz-samples/` with descriptive names, delete before merging to main
- **Error handling**: Graceful degradation when GitHub changes DOM or CODEOWNERS is missing
- **GitHub DOM changes**: Handle both old and new UI patterns using fallback selectors

## Performance Optimization Patterns

**Critical principle:** Check DOM state BEFORE fetching expensive data. MutationObserver fires on every DOM change, so decoration functions must bail out early when there's nothing to do.

**Pattern: Check → Fetch → Process**
```javascript
// ❌ BAD: Fetch data first, check later
const decorateComments = async () => {
  const ownershipData = await getPrOwnershipData(); // Expensive!
  const comments = document.querySelectorAll('.comment');
  if (comments.length === 0) return; // Too late
};

// ✅ GOOD: Check first, fetch only if needed
const decorateComments = async () => {
  const undecorated = Array.from(document.querySelectorAll('.comment'))
    .filter(c => !c.querySelector('.ghco-icon'));
  if (undecorated.length === 0) return; // Fast exit

  const ownershipData = await getPrOwnershipData(); // Only when needed
  // ... process
};
```

**Key optimizations:**
- Check if decorations already exist before fetching ownership data
- Query DOM elements first, return early if none found
- Filter out already-decorated elements before processing
- Use synchronous cache keys (don't call async functions in memoize key functions)
- Skip sticky headers (`.sticky-file-header`) - they lack path data and cause false positives

