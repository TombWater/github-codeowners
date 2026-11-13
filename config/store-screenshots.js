// Store screenshots, for the Playwright MCP's browser_run_code_unsafe
// (filename: config/store-screenshots.js), with the fake-owners build loaded.
// Writes .playwright-mcp/screenshot-<name>-{light,dark}.png at the capture's
// own size, for sips to scale: the Overview and merge box to 1280x800, the
// file header to 640x400. Steps and how it works: SCREENSHOTS.md.
async (page) => {
  const PR = 'https://github.com/TombWater/github-codeowners/pull/7';
  // Which to make, of overview, mergebox and fileheader
  const SHOTS = ['overview', 'mergebox', 'fileheader'];
  // Relative to the repo root; the MCP may only write below it
  const OUT = '.playwright-mcp';
  // Captured larger than the store's sizes, so scaling down keeps them sharp
  const ZOOM = 3;
  const wait = (ms) => page.waitForTimeout(ms);

  const viewport = page.viewportSize();
  let colorMode;

  const open = async (url, ready) => {
    await page.goto(url);
    colorMode ??= await page.getAttribute('html', 'data-color-mode');
    // Scrolling down as it waits: GitHub loads the merge box only once it
    // comes into view
    for (let i = 0; i < 60 && !(await page.locator(ready).count()); i++) {
      await page.mouse.wheel(0, 2000);
      await wait(500);
    }
    await page.waitForSelector(ready, {state: 'attached'});
    await wait(2500);
  };

  // ZOOM times the resolution: the viewport `width` times ZOOM, the page zoomed
  // by as much. Resizing the viewport also sets a device pixel ratio of 1,
  // which Playwright can't change back through the extension. Container
  // queries see the zoomed width, media queries the whole viewport, so this
  // is a layout of its own: search widths with it applied. Rects read in it
  // are in zoomed pixels.
  const zoomTo = async (width) => {
    await page.setViewportSize({width: width * ZOOM, height: 1000 * ZOOM});
    await page.evaluate((zoom) => {
      document.documentElement.style.zoom = String(zoom);
    }, ZOOM);
    await wait(300);
  };

  // Narrowest zoomed width at which fits() holds
  const narrowest = async (fits, low, high) => {
    while (high - low > 4) {
      const mid = Math.round((low + high) / 2);
      await zoomTo(mid);
      if (await page.evaluate(fits)) high = mid;
      else low = mid;
    }
    await zoomTo(high);
    await wait(200);
    return high;
  };

  // Clicks the first match until none is left
  const clickAll = async (selector) => {
    const matches = page.locator(selector);
    for (let i = 0; i < 20 && (await matches.count()); i++) {
      await matches.first().click();
      await wait(200);
    }
  };

  const rectOf = (selector) =>
    page.evaluate((selector) => {
      const element = document.querySelector(selector);
      const {x, y, width, height} = element.getBoundingClientRect();
      return {x, y, width, height};
    }, selector);

  // Centred on the box at 16:10, `margin` times its width
  const around = (box, margin) => {
    const width = box.width * margin;
    const height = (width * 10) / 16;
    return {
      x: box.x + box.width / 2 - width / 2,
      y: box.y + box.height / 2 - height / 2,
      width,
      height,
    };
  };

  const files = [];
  // `clip` may be a function, for a box that moves: read again just before
  // each capture
  const capture = async (name, clip) => {
    for (const mode of ['light', 'dark']) {
      // GitHub loads a theme's stylesheet only once it's chosen: its link
      // has just a data-href until then
      await page.evaluate(async (mode) => {
        const html = document.documentElement;
        const link = document.querySelector(
          `link[data-color-theme="${html.dataset[`${mode}Theme`]}"]`
        );
        if (link && !link.getAttribute('href')) {
          const loaded = new Promise((resolve) => (link.onload = resolve));
          link.href = link.dataset.href;
          await loaded;
        }
        html.setAttribute('data-color-mode', mode);
      }, mode);
      await wait(500);
      const path = `${OUT}/screenshot-${name}-${mode}.png`;
      await page.screenshot({
        path,
        clip: typeof clip === 'function' ? await clip() : clip,
      });
      files.push(path);
    }
  };

  // Overview: the box around the recommended action, the grid and our pinned
  // drawer, every owner group expanded, the rest of the page blanked out.
  // As narrow as our cell's summary allows.
  const overview = async () => {
    await open(PR, '.ghco-mini-status-button');
    const width = await narrowest(
      () => {
        // Ours, not the faked Approvals summary, which shares its class
        const summary = document.querySelector(
          '.ghco-mini-status .ghco-mini-status-summary'
        );
        const grid = summary?.closest('section[aria-label="Merge status"]');
        const wide =
          grid &&
          getComputedStyle(grid).gridTemplateColumns.split(' ').length > 1;
        // The text's own width, not scrollWidth, which rounds away the
        // fraction of a pixel that already shows an ellipsis
        const text = document.createRange();
        text.selectNodeContents(summary);
        return Boolean(
          wide &&
            summary.textContent &&
            text.getBoundingClientRect().width <=
              summary.getBoundingClientRect().width + 0.01
        );
      },
      800,
      1600
    );

    if (
      (await page.getAttribute('.ghco-mini-status-button', 'aria-expanded')) !==
      'true'
    ) {
      await page.click('.ghco-mini-status-button');
    }
    await page.mouse.move(0, 0);
    await wait(500);
    await clickAll(
      '.ghco-overview-panel .ghco-file-count-button[aria-expanded="false"]'
    );
    await page.mouse.move(0, 0);
    await wait(500);

    await page.evaluate(() => {
      const target = document.querySelector(
        'section[aria-label="Recommended action"]'
      ).parentElement;
      target.scrollIntoView({block: 'center'});
      const style = document.createElement('style');
      style.id = 'ghco-screenshot';
      style.textContent = `
        body * { visibility: hidden !important; }
        [data-ghco-screenshot], [data-ghco-screenshot] * { visibility: visible !important; }
      `;
      target.setAttribute('data-ghco-screenshot', '');
      document.head.append(style);
    });
    const box = await rectOf('[data-ghco-screenshot]');
    await capture('overview', around(box, 1.02));
    return {width};
  };

  // Classic conversation page: our merge box section, the first owner group
  // collapsed and the rest expanded. As narrow as the header's description
  // allows on one line.
  const mergebox = async () => {
    const section = 'section[aria-label="Code owners"]';
    // The header button is there once the data has loaded, expanded or not
    await open(`${PR}?overview=false`, `${section} .ghco-header-button`);
    const width = await narrowest(
      () => {
        const description = document.querySelector(
          'section[aria-label="Code owners"] .ghco-section-description'
        );
        const text = document.createRange();
        text.selectNodeContents(description);
        const lines = new Set(
          [...text.getClientRects()].map((rect) => Math.round(rect.top))
        );
        return lines.size === 1;
      },
      600,
      1600
    );

    if (
      (await page.getAttribute(
        `${section} .ghco-header-button`,
        'aria-expanded'
      )) !== 'true'
    ) {
      await page.click(`${section} .ghco-header-button`);
    }
    await clickAll(`${section} .ghco-file-count-button[aria-expanded="false"]`);
    await page.click(`${section} .ghco-file-count-button >> nth=0`);
    await page.mouse.move(0, 0);
    await wait(500);

    await page.evaluate((section) => {
      document.querySelector(section).scrollIntoView({block: 'center'});
    }, section);
    const box = await rectOf(section);
    await capture('mergebox', around(box, 1.065));
    return {width};
  };

  // Files page: config/webpack.config.js's header, its owner labels, and the
  // drawer of its approved @org/ops label, hovered
  const fileheader = async () => {
    const FILE = 'config/webpack.config.js';
    await open(`${PR}/files`, '.ghco-label');
    await zoomTo(1280);

    // The file's box and its @org/ops label, hovered: our mouseover listener
    // opens its drawer, and the highlighted class is the same rule as :hover,
    // as no owner is highlighted. No real pointer, which the label moves away
    // from as the files above it render. Found by its header, just before our
    // labels, as other files' diffs can mention the name too, and again each
    // time: React re-renders the box, so nothing set on it stays.
    const locate = (scroll = false) =>
      page.evaluate(([file, scroll]) => {
        const decoration = [...document.querySelectorAll('.ghco-decoration')]
          .find((decoration) =>
            decoration.previousElementSibling?.textContent.includes(file)
          );
        if (!decoration) return null;
        if (scroll) {
          decoration.parentElement.scrollIntoView({block: 'center'});
        }
        const label = [...decoration.querySelectorAll('.ghco-label')].find(
          (label) => label.textContent.includes('@org/ops')
        );
        if (!label) return null;
        label.classList.add('ghco-label--highlighted');
        // The label's drawer is a popover in the top layer, not in the box
        let drawer = label.parentNode.querySelector('.ghco-drawer');
        if (!drawer?.matches(':popover-open')) {
          label.dispatchEvent(new MouseEvent('mouseover', {bubbles: true}));
          drawer = null;
        }
        const rect = (element) => {
          const {x, y, width, height} = element.getBoundingClientRect();
          return {x, y, width, height};
        };
        return {
          box: rect(decoration.parentElement),
          drawer: drawer && rect(drawer),
        };
      }, [FILE, scroll]);

    // GitHub renders a file's diff only once it's in view, and scrolling
    // past it can leave a placeholder: going to it from the file tree
    // renders it at once
    await page.evaluate((file) => {
      [...document.querySelectorAll('[role="tree"] [role="treeitem"]')]
        .find((item) => item.textContent.trim().endsWith(file.split('/').pop()))
        ?.querySelector('a, [role="button"], span')
        ?.click();
    }, FILE);
    for (let i = 0; i < 20 && !(await locate(true)); i++) {
      await wait(500);
    }
    // The fake change is at the file's end: with all its lines expanded,
    // the diff starts at line 1
    await page.evaluate((file) => {
      document
        .querySelector(`button[aria-label="Expand all lines: ${file}"]`)
        ?.click();
    }, FILE);
    await wait(1000);
    await locate(true);
    await page.mouse.move(0, 0);

    // At 16:10 from just above and left of the file's box: 320x200 CSS
    // pixels, or wider to show the whole drawer. GitHub keeps rendering the
    // files above it and re-rendering the box, so this waits until both are
    // there again, its drawer opened.
    const inset = 4 * ZOOM;
    await capture('fileheader', async () => {
      let located = null;
      for (let i = 0; i < 20 && !located?.drawer; i++) {
        await wait(500);
        located = await locate();
      }
      const {box, drawer} = located;
      const x = box.x - inset;
      const right = drawer ? drawer.x + drawer.width + inset : 0;
      const width = Math.max(320 * ZOOM, right - x);
      return {x, y: box.y - inset, width, height: (width * 10) / 16};
    });
    return {};
  };

  const results = {};
  const shots = {overview, mergebox, fileheader};
  for (const name of SHOTS) {
    results[name] = await shots[name]();
  }

  // Put the page back as it was
  await page.evaluate((colorMode) => {
    document.getElementById('ghco-screenshot')?.remove();
    document
      .querySelector('[data-ghco-screenshot]')
      ?.removeAttribute('data-ghco-screenshot');
    if (colorMode) {
      document.documentElement.setAttribute('data-color-mode', colorMode);
    }
    document.documentElement.style.zoom = '';
  }, colorMode);
  if (viewport) await page.setViewportSize(viewport);
  return {results, files};
}
