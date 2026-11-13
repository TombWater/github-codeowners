# Store screenshots

How to make the six screenshots (`screenshot-{overview,mergebox,fileheader}-{light,dark}.png`) with this branch. It lives here, not on `main`, because it describes this branch's fakes and script; CLAUDE.md on `main` points here.

The Chrome Web Store accepts exactly **1280x800** or **640x400**. Keep each light/dark pair the same size.

## Steps

1. **Rebase this branch onto current `main`** and build it in development mode (`npm run watch` does). The user pushes: `main` first, then `git push --force-with-lease origin feature/fake-owners`. ⚠️ `main` first: the draft PR diffs against `origin/main`, and an old base fills its files page with unrelated files. The standing draft PR "Store screenshots: fake owners (do not merge)" follows this branch into `main`, so there is no new PR to open; keep it open between rounds.
2. **The user reloads the extension.**
3. **Run `config/store-screenshots.js`** with the Playwright MCP's `browser_run_code_unsafe`, `filename: config/store-screenshots.js`. It opens the draft PR and makes all six (`SHOTS` at its top picks fewer) into `.playwright-mcp/screenshot-<name>-{light,dark}.png`:
   - **overview**: the box around the recommended action, the summary grid and our pinned drawer, every owner group expanded, the rest of the page blanked; as narrow as our cell's "2 still required" allows.
   - **mergebox**: the classic page (`?overview=false`), our section with the first owner group collapsed and the rest expanded; as narrow as its description allows on one line.
   - **fileheader**: the `config/webpack.config.js` file header with the `@org/ops` label's drawer open.

   Look at each before using it.
4. **Scale into the repo root.** The captures are larger on purpose, so they are only ever scaled down:
   ```
   for n in overview mergebox; do for m in light dark; do sips -z 800 1280 .playwright-mcp/screenshot-$n-$m.png --out screenshot-$n-$m.png; done; done
   for m in light dark; do sips -z 400 640 .playwright-mcp/screenshot-fileheader-$m.png --out screenshot-fileheader-$m.png; done
   ```
   Commit the images on `main` (or a `feature/` branch for them), not on this branch.
5. ⚠️ **Rebuild the release branch** (`npm run build`) afterwards: `build/` still holds the fake-data build.

## What this branch fakes

The *data*, not the repo:

- `browser/github.js`: a fake CODEOWNERS (through `parseCodeowners`), `@org/…` teams, five changed files, approvers, and a review status that requires code owners. Every real reader it bypasses needs a fake: the Overview's `getReviewers()` and `getReviewStatus()` were added when the Overview arrived. The approver fakes go through `withSimulatedApprovals()`, so the debug panel's "Simulate Approval Change" still works.
- `browser/files-page.js`: each file header gets the fake owners of the name it shows, or of one picked by its position for other files.
- `browser/overview.js`: fills GitHub's own Checks, Comments and Approvals cells to go with the fake owners, and shows the draft PR as open, with "Approval required" as its recommended action. ⚠️ The faked "Enable auto-merge (squash)" is GitHub's "Ready for review" button underneath: don't click it.
- Two dummy edits (`README.md`, `config/webpack.config.js`) give the PR real changed files.

## How the script works

For when it breaks:

- **Resolution**: any `setViewportSize` through the extension sets a device pixel ratio of 1, and neither Playwright nor a CDP session ("Not allowed") can change it back. So the viewport is `ZOOM` (3) times the width, with `zoom: 3` on `<html>`: the same layout at three times the pixels. Container queries see the zoomed width but media queries see the whole viewport, so that is a layout of its own, and the narrowest-width searches run with the zoom applied. Rects read in it are in zoomed pixels.
- **Themes**: it switches `data-color-mode` without touching the user's settings, and loads the theme's stylesheet itself: GitHub's `link[data-color-theme]` has only a `data-href` until that theme is chosen. It expects the default light and dark themes.
- **Lazy rendering**: GitHub renders the merge box and diffs only as they scroll into view, and React re-renders a file box as it appears, dropping anything set on it, and our labels until the next decoration pass. So the script scrolls while it waits for the merge box, finds the file box by its header each time, and measures it again just before each capture. Scrolling past a diff can leave it a placeholder, so the script goes to the file from the file tree instead. It then expands all the file's lines, so the diff starts at line 1 rather than at the fake change at its end.
- **Hover without a pointer**: the label moves as the files above it render, which took it from under a real pointer. The script sends the label a `mouseover` (our listener opens the drawer) and adds `ghco-label--highlighted`, which has the same rule as `:hover` while no owner is highlighted. The capture widens past 320 CSS pixels, still 16:10, when the drawer would go past its right edge.
- **The MCP** runs the file as `(<file>)(page)`: no trailing `;` (so the file is in `.prettierignore`), no `process`, and it may only write below the repo root.
