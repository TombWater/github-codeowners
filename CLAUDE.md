# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a browser extension (Chrome/Firefox) that decorates GitHub PR pages with code ownership information. The extension provides two main decorations:

1. **File header decoration**: Adds owner labels below each file header on PR files page showing who must approve each file
2. **Merge box decoration**: Creates an expandable "Code owners" section in the PR conversation page that groups files by owner and shows approval status

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
- **Testing**: Load `build/` directory as unpacked extension in Chrome/Firefox developer mode
- **No API Keys**: Extension works entirely through DOM scraping, no GitHub API tokens required
- **Codebase Size**: ~1000 lines total across 6 focused modules
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
- Sets up MutationObserver with debounced updates for both file page and conversation page
- Coordinates calls to `updatePrFilesPage()` and `updateMergeBox()` functions
- Imports CSS and manages top-level extension lifecycle
- **Clean architecture**: Very minimal orchestration layer (17 lines)

**`src/files-page.js`** - File header decoration
- **`updatePrFilesPage()`**: Decorates file headers on PR files page with owner labels
- **`decorateFileHeader()`**: Adds owner labels below each file header
- **`getFileHeadersForDecoration()`**: Finds file headers that need decoration
- **Ownership data handling**: Passes complete ownership data object to maintain architectural consistency
- Handles both old and new GitHub PR UI selectors

**`src/conversation-page.js`** - Merge box decoration
- **`updateMergeBox()`**: Creates expandable "Code owners" section in PR conversation merge box
- **Groups files by owner**: Shows owner groups with file lists and approval status
- **Progressive loading**: Shows loading state immediately, then populates with data
- **Expandable UI**: Uses GitHub's native expandable section styling with CSSOM-based class detection
- **Priority sorting**: Owner groups sorted by user relevance (user-only → user co-owners → approved → others)
- **Ownership data flow**: Maintains ownership data as cohesive object throughout function call chain

**`src/labels.js`** - Owner label creation and interaction
- **`createOwnerLabels()`**: Creates owner labels with approval status indicators (✓ for approved, ★/☆ for user's teams)
- **Ownership data interface**: Accepts `{owners, ownershipData}` parameters for clean separation of concerns
- **`clearHighlightedOwner()`**: Manages click-to-highlight functionality across all owner labels
- **Drawer management**: Hover drawers showing team members using CSS anchor positioning and Popover API
- **Label sorting**: User's own teams always appear first in label lists

**`src/ownership.js`** - Data aggregation and processing
- **`getPrOwnershipData()`**: Aggregates data from multiple github.js functions and processes it for UI needs
- **`getUserLogin()`**: Extracts current user information from GitHub DOM
- **Team processing**: Handles team membership, approvals, and user team associations
- **Debug mode support**: Applies simulated approvals when `window.ghcoDebug` is enabled

**`src/github.js`** - GitHub data fetching and caching
- **Caching strategy**: Uses lodash `memoize` with custom single-entry cache implementation
  - `urlCacheKey()`: Cache reviewers per PR URL
  - `repoCacheKey()`: Cache team members per repository
  - `prBaseCacheKey()`: Cache CODEOWNERS per base branch
- **`getPrInfo()`**: Extracts owner/repo/PR number/base branch from URL and DOM
- **`getDiffFilesMap()`**: Maps file path digests to paths (handles both old/new GitHub UI)
- **`getFolderOwners()`**: Fetches CODEOWNERS from `.github/`, root, or `docs/` directory
- **`getReviewers()`**: Scrapes PR conversation page for reviewer approval status
- **`getTeamMembers()`**: Fetches team member lists by scraping org team pages (handles pagination)
- **Debug mode support**: Checks `window.__ghcoDebugPanel` for simulated merge state when available

**`src/debug-panel.js`** - Debug and testing tools (only included in development builds via `npm run watch`)
- **Debug panel UI**: Fixed bottom-right panel showing update count, last update time, and current state
- **Approval simulation**: Interactive popup to toggle approval states for any team member, triggers DOM mutations to test live updates
- **Merge simulation**: One-way operation that removes other merge box sections and adds "Pull request successfully merged" message
- **State tracking**: Real-time stats display with 500ms polling, filtered mutation observer to avoid infinite loops
- **URL change detection**: Automatically resets simulations when navigating between PRs
- **Cross-module communication**: Exposes functions via `window.__ghcoDebugPanel` for use in github.js and ownership.js
- **Styling**: Separated into `src/debug-panel.css` with `ghco-` prefixed classes

### Key Technical Details

- **Pattern matching**: CODEOWNERS folder patterns are matched using `ignore` library with `.ignores()` method (matching = true means the pattern applies)
- **Team resolution**: Individual users in CODEOWNERS create "pseudo-teams" containing just that user for consistent handling
- **User ownership**: Files with no CODEOWNERS entry show "any reviewer" label (anyone with write access can approve)
- **Highlighting**: Clicking a label toggles `ghco-highlight-active` body class and `ghco-label--highlighted` on matching labels
- **Merge box priority**: Owner groups sorted by user relevance (user-only owners → user co-owners → user approved → others needing approval → others approved)
- **Shared label creation**: `createOwnerLabels()` is used by both file header and merge box decorations with consistent `{owners, ownershipData}` interface
- **Data orchestration**: `getPrOwnershipData()` in ownership.js aggregates data from multiple github.js functions and processes it for UI needs
- **Ownership data flow**: Complete ownership objects passed through call chain to avoid repetitive destructuring and reconstruction
- **No API token required**: All data fetched by scraping GitHub HTML pages using `fetch()` with credentials
- **Modular architecture**: Code split into focused modules (decorator.js, files-page.js, conversation-page.js, labels.js, ownership.js, github.js)
- **CSSOM consolidation**: `getGithubClassNames()` closure-based caching parses all stylesheets once to find 8 GitHub CSS module patterns, eliminating repetitive CSSOM searches
- **classList.add() safety**: Direct calls without conditionals since it silently ignores undefined/null values
- **Debug mode**: Debug panel automatically enabled in development builds (`npm run watch`), completely excluded from production builds (`npm run build`, `npm run zip`)

### CSS Architecture
- All styles in `src/decorator.css` use `ghco-` prefix to avoid conflicts (e.g., `ghco-label`, `ghco-merge-box-container`)
- Debug panel styles in `src/debug-panel.css` with same `ghco-` prefix convention
- Uses CSS anchor positioning for drawer placement below labels
- Animated hover effects with transform/opacity transitions
- Click feedback animation on labels
- Theming via CSS custom properties: yellow (default), red (user's teams), green (approved)

## Common Development Patterns

- **File organization**: Each module has a single responsibility (orchestration, UI, data, etc.)
- **Ownership data architecture**: Ownership data flows as cohesive object rather than being destructured/reconstructed multiple times throughout call chain
- **Error handling**: Graceful degradation when GitHub changes DOM structure or CODEOWNERS is missing
- **Performance**: Debounced updates (100ms) and memoized caching to handle GitHub's dynamic DOM
- **Cross-browser**: ES6 modules with webpack bundling for Chrome/Firefox compatibility
- **GitHub DOM changes**: Code handles both old and new GitHub UI patterns using fallback selectors
- **Function signatures**: Clean parameter patterns - minimal destructuring, pass complete objects when appropriate
- **Style properties**: Use individual `element.style.property = value` assignments instead of `cssText` strings for clarity and maintainability
- **Inline styles**: Avoid inline styles in JavaScript; use CSS classes and stylesheets instead for maintainability

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
