# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a browser extension (Chrome/Firefox) that decorates GitHub PR file headers with labels showing the code owners who must approve each file. The extension works by:
1. Fetching and parsing the repository's CODEOWNERS file from the PR's base branch
2. Matching PR files against CODEOWNERS patterns using the `ignore` library (gitignore-style matching)
3. Fetching team membership data from GitHub org team pages
4. Decorating file headers with owner labels that show approval status and team membership

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
- **Webpack entry**: `src/content.js` (configured in `config/webpack.config.js`)
- **Content script**: Runs on all `https://github.com/*` pages (manifest_version 3)
- **Build output**: Bundled to `build/content.js` with CSS extracted to `build/content.css`
- **Extension type**: Browser extension (Chrome/Firefox) that modifies GitHub's DOM
- **No permissions needed**: Uses content script with host permissions for github.com

### Core Components

**`src/content.js`** - Main UI and decoration logic
- **Two main decorations**:
  - **File header decoration**: Adds owner labels below each file header on PR files page
  - **Merge box decoration**: Groups files by owner and displays them in PR conversation page merge box
- **Code organization**: Top-down structure with sections for user/owner data, labels, file headers, merge box, and orchestration
- Sets up MutationObserver with debounced PR file decoration updates
- Creates owner labels with approval status indicators (✓ for approved, ★/☆ for user's teams)
- Implements click-to-highlight functionality across all owner labels
- Manages hover drawers showing team members using CSS anchor positioning and Popover API
- Handles both old and new GitHub PR UI selectors
- **Label sorting**: User's own teams always appear first in label lists

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

### Key Technical Details

- **Pattern matching**: CODEOWNERS folder patterns are matched using `ignore` library with `.ignores()` method (matching = true means the pattern applies)
- **Team resolution**: Individual users in CODEOWNERS create "pseudo-teams" containing just that user for consistent handling
- **User ownership**: Files with no CODEOWNERS entry show "any reviewer" label (anyone with write access can approve)
- **Highlighting**: Clicking a label toggles `ghco-highlight-active` body class and `ghco-label--highlighted` on matching labels
- **Merge box priority**: Owner groups sorted by user relevance (user-only owners → user co-owners → user approved → others needing approval → others approved)
- **Shared label creation**: `createOwnerLabels()` is used by both file header and merge box decorations
- **Data orchestration**: `getPrOwnershipData()` in content.js aggregates data from multiple github.js functions and processes it for UI needs
- **No API token required**: All data fetched by scraping GitHub HTML pages using `fetch()` with credentials

### CSS Architecture
- All styles in `src/content.css` use `ghco-` prefix to avoid conflicts (e.g., `ghco-label`)
- Uses CSS anchor positioning for drawer placement below labels
- Animated hover effects with transform/opacity transitions
- Click feedback animation on labels
- Theming via CSS custom properties: yellow (default), red (user's teams), green (approved)
