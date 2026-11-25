// Smoke test, run in your own Chrome through the Playwright MCP extension, so
// it uses your GitHub login and the extension loaded from build/. Ask Claude
// to "run the smoke test": it runs this file with browser_run_code_unsafe
// (filename: test/smoke.js), which wraps it as `await (<file>)(page)` in a
// sandbox with no file access: so the file is one function declaration (an
// arrow function would get a semicolon from Prettier, which breaks the
// wrapping), and the cases live here.
//
// Each case finds its PR by searching the repo's /pulls list and taking the
// first result whose state matches. It visits that PR on the Overview, the
// classic conversation page and both files views, by URL parameters that
// serve each whatever the user's preferences are (see VIEWS), and reports
// which of GitHub's hooks and which of our decorations are missing. A missing
// hook means GitHub changed its page; a missing decoration with every hook
// present means a bug of ours.
//
// It tests cli/cli, or the repos the session sets for this tab before the
// run: sessionStorage['ghco-smoke-repos'] on github.com, comma-separated.
// That is how a private repo is tested without naming it in this file.
//
// The selectors repeat the extension's own (browser/github.js and friends) on
// purpose: this checks GitHub's page, not our code. When one changes there,
// change it here too.
async function smokeTest(page) {
  // A public repo with a CODEOWNERS file, when the session sets none: this
  // file is committed
  const DEFAULT_REPOS = ['cli/cli'];
  const REPOS_KEY = 'ghco-smoke-repos';
  // `query` is a /pulls search; `expect` is checked against each result's
  // merge box data, since search can't tell forks or conflicts. Sorted so
  // runs keep picking the same PR while it still matches: the oldest open
  // PRs, and merged or closed ones from before a fixed date, which can't
  // change. Only the first page of results (25) is tried.
  const CASES = [
    {
      name: 'open',
      query: 'is:open sort:created-asc',
      expect: {state: 'OPEN', draft: false, fork: false, conflict: false},
    },
    {
      name: 'open fork with a conflict',
      query: 'is:open sort:created-asc',
      expect: {state: 'OPEN', fork: true, conflict: true},
    },
    {
      name: 'merged',
      query: 'is:merged created:<2025-01-01 sort:created-desc',
      expect: {state: 'MERGED', fork: false},
    },
    {
      name: 'merged fork',
      query: 'is:merged created:<2025-01-01 sort:created-desc',
      expect: {state: 'MERGED', fork: true},
    },
    {
      name: 'closed',
      query: 'is:closed is:unmerged created:<2025-01-01 sort:created-desc',
      expect: {state: 'CLOSED', fork: false},
    },
    {
      name: 'closed fork',
      query: 'is:closed is:unmerged created:<2025-01-01 sort:created-desc',
      expect: {state: 'CLOSED', fork: true},
    },
  ];
  // Each page, by the URL that serves it whatever the user's preferences
  // (none of these parameters changes them); `checks` is its group in CHECKS
  const VIEWS = [
    {name: 'overview', path: '?overview=true', checks: 'overview'},
    {name: 'classic', path: '?overview=false', checks: 'classic'},
    {
      name: 'new files',
      path: '/changes?new_files_changed=true',
      checks: 'files',
    },
    {
      name: 'classic files',
      path: '/changes?new_files_changed=false',
      checks: 'files',
    },
  ];
  // How long our decorations may take to appear after the page loads
  const DECORATION_TIMEOUT = 25000;

  const report = [];
  const log = (line) => report.push(line);
  // Progress, in the page's console, for whoever watches the scratch tab's
  // DevTools (with "Preserve log" on, as each visit loads a new page). This
  // function's own console.log goes to Playwright's process, out of sight.
  const progress = (line) =>
    page
      .evaluate((line) => console.log(`[GHCO Smoke] ${line}`), line)
      .catch(() => {});

  // Each case's PR in a repo: the first result of its /pulls search whose
  // state, read from the JSON GitHub's merge box loads, matches the case.
  // Cases with the same query share its search, and each PR's state is
  // fetched once, a few at a time. Run from a page on github.com.
  const findPrs = (repo) =>
    page.evaluate(
      async ({repo, cases}) => {
        // The promise of load(), started on the first call for a key and
        // shared by every later one, so nothing is fetched twice
        const once = (cache, key, load) => {
          if (!cache.has(key)) cache.set(key, load());
          return cache.get(key);
        };

        // A query's PR numbers, in the order the /pulls page lists them (its
        // HTML links each PR, some more than once)
        const searches = new Map();
        const search = (query) =>
          once(searches, query, async () => {
            const list = await fetch(
              `/${repo}/pulls?q=${encodeURIComponent(`is:pr ${query}`)}`,
              {credentials: 'include'}
            );
            if (!list.ok) return {error: `/pulls answered ${list.status}`};
            const html = await list.text();
            const pattern = new RegExp(`/${repo}/pull/(\\d+)`, 'g');
            const numbers = [
              ...new Set(Array.from(html.matchAll(pattern), (m) => m[1])),
            ];
            return {numbers};
          });

        // At most 6 merge box fetches at a time, so a search's 25 results
        // don't all go to GitHub at once. limited() queues a load and
        // resolves with its result, or null if it fails; startNext() starts
        // queued loads while there is room, and again as each one ends.
        const waiting = [];
        let running = 0;
        const limited = (load) =>
          new Promise((resolve) => {
            waiting.push(() => load().then(resolve, () => resolve(null)));
            startNext();
          });
        const startNext = () => {
          while (running < 6 && waiting.length) {
            running++;
            waiting
              .shift()()
              .finally(() => {
                running--;
                startNext();
              });
          }
        };

        // A PR's state, the fields a case's `expect` names, from its merge box
        // data, or null if that didn't load
        const states = new Map();
        const prState = (number) =>
          once(states, number, () =>
            limited(async () => {
              const response = await fetch(
                `/${repo}/pull/${number}/page_data/merge_box`,
                {
                  credentials: 'include',
                  headers: {
                    Accept: 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                  },
                }
              );
              if (!response.ok) return null;
              const {pullRequest: pr, mergeRequirements} =
                await response.json();
              const conflict = mergeRequirements?.conditions?.find(
                (c) => c.type === 'PULL_REQUEST_MERGE_CONFLICT_STATE'
              );
              return {
                state: pr.state,
                draft: pr.isDraft,
                fork: pr.isCrossRepo,
                // Merged and closed PRs list no conditions
                conflict: conflict ? conflict.result === 'FAILED' : null,
                base: pr.baseRefName,
              };
            })
          );

        // Every case at once: those with the same query wait on one search
        return Promise.all(
          cases.map(async ({query, expect}) => {
            const {error, numbers} = await search(query);
            if (error) return {error};
            if (!numbers.length) return {error: 'no PRs in the search results'};
            // Queue every result's state, then take the first match in the
            // search's order, which keeps runs on the same PR
            numbers.forEach(prState);
            for (const number of numbers) {
              const state = await prState(number);
              if (
                state &&
                Object.entries(expect).every(([k, v]) => state[k] === v)
              ) {
                return {
                  url: `https://github.com/${repo}/pull/${number}`,
                  state,
                };
              }
            }
            return {error: `none of ${numbers.length} results matches`};
          })
        );
      },
      {repo, cases: CASES.map(({query, expect}) => ({query, expect}))}
    );

  // Helpers for the checks below, set on the page's window after each load:
  // page.evaluate() sends only the function it is given, so functions run in
  // the page can't share helpers from here
  const installHelpers = () =>
    page.evaluate(() => {
      const $ = (s, el = document) => el.querySelector(s);
      const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
      window.__ghcoSmoke = {
        $,
        $$,
        // Both CSS module class formats, as moduleClassSelector() in github.js
        mod: (name, prefix = '') =>
          [
            `${prefix}[class*="-module__${name}__"]`,
            `${prefix}[class*="-module__${name}--"]`,
            `${prefix}[class^="${name}__"]`,
            `${prefix}[class*=" ${name}__"]`,
          ].join(', '),
        embedded: (key) =>
          $$(
            '[data-target="react-app.embeddedData"], [data-target="react-partial.embeddedData"]'
          ).some((s) => s.textContent.includes(`"${key}"`)),
        // Which of VIEWS GitHub served
        servedView: () => {
          if (/\/(files|changes)$/.test(location.pathname)) {
            return $('#partial-discussion-header')
              ? 'classic files'
              : 'new files';
          }
          const isOverview = $(
            '[data-overview-sidebar-item], section[aria-label="Merge status"], [data-testid="mini-status"]'
          );
          return isOverview ? 'overview' : 'classic';
        },
        // A new list of results, with its two kinds of check: 'hook' is
        // GitHub's DOM, 'ours' is our decoration
        start: () => {
          const results = [];
          const check =
            (kind) =>
            (name, ok, detail = '') =>
              results.push({kind, name, ok: Boolean(ok), detail});
          return {results, hook: check('hook'), ours: check('ours')};
        },
      };
    });

  // Our decorations have appeared (or GitHub served the wrong page, which
  // runChecks() reports)
  const decorationsReady = (view, prState) =>
    page
      .waitForFunction(
        ({view, isOpen}) => {
          const {$, $$, mod, servedView} = window.__ghcoSmoke;
          if (servedView() !== view.name) return true;
          // Every file header labelled, as CHECKS.files counts them: they are
          // decorated one by one, so the first label doesn't mean the rest
          // are there
          if (view.checks === 'files') {
            const headers = $$(
              [
                'div.file-header',
                'div[data-diff-header-wrapper]',
                mod('diffHeaderWrapper', 'div'),
              ].join(', ')
            ).filter((h) => h.dataset.anchor || $('a[href*="#diff-"]', h));
            return (
              headers.length &&
              headers.every((h) =>
                h.nextElementSibling?.classList.contains('ghco-decoration')
              )
            );
          }
          const section = $('section[aria-label="Code owners"]');
          if (!section || /loading/i.test(section.textContent)) return false;
          if (view.checks === 'overview' && isOpen) {
            const cell = $('.ghco-mini-status');
            return cell && !/loading/i.test(cell.textContent);
          }
          return true;
        },
        {view, isOpen: prState.state === 'OPEN'},
        {timeout: DECORATION_TIMEOUT, polling: 500}
      )
      .then(
        () => true,
        () => false
      );

  // Groups of checks, each run in the page with the helpers above. Each
  // returns its results.
  const CHECKS = {
    // Every page
    page: () => {
      const {$, embedded, start} = window.__ghcoSmoke;
      const {results, hook} = start();
      // The classic files view keeps the old header, with no og:author: the
      // author then comes from the fetched classic page
      const oldHeader = $('#partial-discussion-header');
      if (oldHeader) {
        hook('status .State (old header)', $('.State', oldHeader));
        hook(
          'base branch .commit-ref (old header)',
          $('.commit-ref', oldHeader)
        );
        return results;
      }
      hook('status [data-status]', $('[data-status]'));
      hook(
        'base branch link',
        $(
          'div[class*="PageHeader-Description"] a[class*="BranchName-BranchName"]'
        )
      );
      hook('embedded baseBranch', embedded('baseBranch'));
      hook('og:author meta', $('meta[property="og:author:username"]'));
      return results;
    },

    // The Overview and the classic page
    conversation: () => {
      const {$$, start} = window.__ghcoSmoke;
      const {results, ours} = start();
      const sections = $$('section[aria-label="Code owners"]');
      ours(
        'one Code owners section',
        sections.length === 1,
        `${sections.length} found`
      );
      // Every case's PR changes files under CODEOWNERS: an empty section means
      // the file list or CODEOWNERS didn't load
      if (sections.length === 1) {
        const groups = $$('.ghco-merge-box-owner-group', sections[0]);
        ours(
          'owner groups listed',
          groups.length > 0,
          groups.length
            ? `${groups.length} groups`
            : sections[0].querySelector('.ghco-section-header p')?.textContent
        );
      }
      const authorLinks = $$(
        [
          '.timeline-comment a.author',
          '.review-comment a.author',
          '[data-testid="comment-header"] a[data-testid="avatar-link"]',
          '.TimelineItem-body a.author.Link--primary.text-bold',
        ].join(', ')
      );
      if (authorLinks.length) {
        const decorated = authorLinks.filter((link) =>
          link.parentNode?.querySelector('.ghco-comment-role-icon')
        );
        ours(
          'comment role icons',
          decorated.length > 0,
          `${decorated.length} of ${authorLinks.length} authors`
        );
      }
      return results;
    },

    overview: (prState) => {
      const {$, $$, mod, start} = window.__ghcoSmoke;
      const {results, hook, ours} = start();
      const reviewers = $('section[aria-label="Reviewers"]');
      hook('Reviewers section', reviewers);
      const reviewerLinks = reviewers
        ? $$('a[data-hovercard-type]', reviewers)
        : [];
      if (reviewerLinks.length) {
        const rows = reviewerLinks.filter((l) => l.closest(mod('reviewerRow')));
        hook(
          'reviewer rows (reviewerRow)',
          rows.length === reviewerLinks.length,
          `${rows.length} of ${reviewerLinks.length}`
        );
      }
      const recommended = $('section[aria-label="Recommended action"]');
      hook('Recommended action section', recommended);
      hook(
        'top box (CondensedForYouContainer)',
        $(mod('CondensedForYouContainer', 'div'))
      );
      const section = $('section[aria-label="Code owners"]');

      if (prState.state === 'OPEN') {
        const grid = $('section[aria-label="Merge status"]');
        hook('Merge status grid', grid);
        const cells = $$('[data-testid="mini-status"]');
        hook('mini-status cells', cells.length, `${cells.length} found`);
        for (const name of [
          'MiniStatus',
          'MiniStatusLabelRow',
          'MiniStatusLabel',
          'MiniStatusSummary',
        ]) {
          // In any cell: some appear only in some states (a Checks cell with
          // all checks passed has no MiniStatusSummary)
          hook(
            `cell class ${name}`,
            cells.some((c) => c.matches(mod(name)) || $(mod(name), c))
          );
        }
        const cell = $$('.ghco-mini-status');
        ours('one Code owners cell', cell.length === 1, `${cell.length} found`);
        ours(
          'cell is in the grid',
          cell[0] && grid && cell[0].parentElement === grid
        );
        ours(
          'cell has loaded',
          cell[0] && !/loading/i.test(cell[0].textContent)
        );
        ours(
          'section is the cell’s panel',
          section?.classList.contains('ghco-overview-panel')
        );
      } else {
        ours(
          'section is in the top box',
          section?.classList.contains('ghco-overview-for-you') &&
            recommended &&
            section.parentElement === recommended.parentElement
        );
      }
      if (prState.conflict) {
        ours(
          'conflict isn’t "not required to merge"',
          !/not required to merge/i.test(section?.textContent ?? '')
        );
      }
      return results;
    },

    classic: () => {
      const {$, $$, mod, start} = window.__ghcoSmoke;
      const {results, hook, ours} = start();
      hook('reviewers form', $('form[aria-label="Select reviewers"]'));
      // The headings, else the fallback findMergeBoxContainer() uses without
      // them, which some merge boxes don't have
      const headings = $$(mod('MergeBoxSectionHeading', 'h3'));
      hook(
        'merge box (MergeBoxSectionHeading, else mergeBoxAdjustBorders)',
        headings.length || $(mod('mergeBoxAdjustBorders', 'div')),
        `${headings.length} headings`
      );
      hook('timeline avatar', $('.TimelineItem-avatar[href^="/"]'));
      ours(
        'section is in the merge box',
        $('section[aria-label="Code owners"]')?.parentElement?.querySelector(
          mod('MergeBoxSectionHeading', 'h3')
        )
      );
      return results;
    },

    files: () => {
      const {$, $$, mod, embedded, start} = window.__ghcoSmoke;
      const {results, hook, ours} = start();
      const headers = $$(
        [
          'div.file-header',
          'div[data-diff-header-wrapper]',
          mod('diffHeaderWrapper', 'div'),
        ].join(', ')
      );
      hook('file headers', headers.length, `${headers.length} found`);
      // The classic files view: only div.file-header, each with its path
      const classic = headers.every((h) => h.matches('div.file-header'));
      if (classic) {
        const withPath = headers.filter((h) => h.dataset.path);
        hook(
          'file headers [data-path]',
          withPath.length === headers.length,
          `${withPath.length} of ${headers.length}`
        );
      } else {
        hook(
          'file headers [data-diff-header-wrapper]',
          $('div[data-diff-header-wrapper]')
        );
        hook('embedded diffSummaries', embedded('diffSummaries'));
      }
      const linked = headers.filter(
        (h) => h.dataset.anchor || $('a[href*="#diff-"]', h)
      );
      hook(
        'file header links',
        linked.length === headers.length,
        `${linked.length} of ${headers.length}`
      );
      hook(
        'collapse chevron',
        headers[0] &&
          $(
            'button .octicon-chevron-down, button .octicon-chevron-right',
            headers[0]
          )
      );
      hook(
        'viewed toggle',
        headers[0] &&
          $(
            'button[aria-pressed][aria-label$="Viewed"], input.js-reviewed-checkbox',
            headers[0]
          )
      );
      const labelled = linked.filter((h) =>
        h.nextElementSibling?.classList.contains('ghco-decoration')
      );
      ours(
        'owner labels on file headers',
        linked.length && labelled.length === linked.length,
        `${labelled.length} of ${linked.length}`
      );
      return results;
    },
  };

  // The checks for one view
  const runChecks = async (view, prState) => {
    const served = await page.evaluate(() => window.__ghcoSmoke.servedView());
    if (served !== view.name) {
      const name = `${view.path} serves the ${view.name} page`;
      return [{kind: 'hook', name, ok: false, detail: `got ${served}`}];
    }
    const groups = [CHECKS.page, CHECKS[view.checks]];
    if (view.checks !== 'files') groups.push(CHECKS.conversation);
    const results = [];
    for (const group of groups) {
      results.push(...(await page.evaluate(group, prState)));
    }
    return results;
  };

  // The CODEOWNERS file came from the PR's base branch, or from the default
  // branch only once the base was confirmed gone
  const checkCodeownersRef = (requests, prState) => {
    const files = requests.filter((r) => /\/blob\/.+\/CODEOWNERS$/.test(r.url));
    if (!files.length) {
      return {
        kind: 'ours',
        name: 'CODEOWNERS fetched',
        ok: false,
        detail: 'no request seen',
      };
    }
    const found = files.find((r) => r.status === 200);
    const ref =
      found &&
      decodeURIComponent(
        found.url.match(/\/blob\/(.+?)\/(?:\.github\/|docs\/)?CODEOWNERS$/)[1]
      );
    const baseGone = requests.some(
      (r) =>
        r.method === 'HEAD' &&
        r.url.endsWith(`/tree/${prState.base}`) &&
        r.status === 404
    );
    return {
      kind: 'ours',
      name: 'CODEOWNERS from the base branch',
      ok: Boolean(found) && (ref === prState.base || baseGone),
      detail: found
        ? `from ${ref}${baseGone ? ' (base gone)' : ''}`
        : 'none found',
    };
  };

  let failed = 0;
  let unmatched = 0;

  await page.goto(`https://github.com/${DEFAULT_REPOS[0]}/pulls`, {
    waitUntil: 'domcontentloaded',
  });
  const loggedIn = await page.evaluate(() =>
    document.querySelector('meta[name="user-login"]')?.content?.trim()
  );
  if (!loggedIn) return 'Not logged in to GitHub in this browser';
  // Set by the extension on load: compare it with build/content.js to tell
  // whether the browser runs the latest build
  const build = await page
    .waitForFunction(() => document.documentElement.dataset.ghcoBuild, null, {
      timeout: 5000,
    })
    .then(
      (handle) => handle.jsonValue(),
      () => null
    );
  if (!build) return 'Extension not loaded: no data-ghco-build on <html>';
  log(`Extension built ${build}\n`);
  const repos = await page.evaluate(
    (key) =>
      (sessionStorage.getItem(key) ?? '')
        .split(',')
        .map((repo) => repo.trim())
        .filter(Boolean),
    REPOS_KEY
  );

  // Every case's PR first, every repo at once, so the progress lines can
  // count the pages
  const searchRepos = repos.length ? repos : DEFAULT_REPOS;
  await progress(`looking for PRs in ${searchRepos.join(', ')}`);
  const runs = (
    await Promise.all(
      searchRepos.map(async (repo) =>
        (
          await findPrs(repo)
        ).map((found, i) => ({
          repo,
          testCase: CASES[i],
          found,
        }))
      )
    )
  ).flat();
  const pages = runs.filter(({found}) => !found.error).length * VIEWS.length;
  let visited = 0;

  for (const {repo, testCase, found} of runs) {
    if (found.error) {
      // Not a broken page: the query needs widening, or the repo changed
      log(
        `${testCase.name}  NO PR in ${repo}  ${found.error}: change its query`
      );
      unmatched++;
      continue;
    }
    const {url, state: prState} = found;
    log(`${testCase.name}  ${url.replace(/^https:\/\/github\.com\//, '')}`);

    for (const view of VIEWS) {
      const count = `(${++visited}/${pages})`;
      const requests = [];
      const onResponse = (response) =>
        requests.push({
          url: response.url().split('?')[0],
          status: response.status(),
          method: response.request().method(),
        });
      page.on('response', onResponse);
      await page.goto(`${url}${view.path}`, {waitUntil: 'domcontentloaded'});
      await installHelpers();
      await progress(`${count} ${url} ${view.name}: waiting for decorations`);
      const ready = await decorationsReady(view, prState);
      const results = await runChecks(view, prState);
      page.off('response', onResponse);

      results.push(checkCodeownersRef(requests, prState));
      if (!ready) {
        results.push({
          kind: 'ours',
          name: `decorations within ${DECORATION_TIMEOUT / 1000}s`,
          ok: false,
          detail: '',
        });
      }

      const failures = results.filter((r) => !r.ok);
      log(
        `  ${view.name.padEnd(14)} ${failures.length ? 'FAIL' : 'PASS'}  (${
          results.length
        } checks)`
      );
      for (const r of failures) {
        log(
          `    ${r.kind === 'hook' ? 'GitHub' : 'ours  '}  ${r.name}${
            r.detail ? `: ${r.detail}` : ''
          }`
        );
      }
      if (failures.length && !failures.some((r) => r.kind === 'hook')) {
        log('    (every GitHub hook is there: likely a bug of ours)');
      }
      if (failures.length) failed++;
      await progress(
        `${count} ${url} ${view.name}: ${failures.length ? 'FAIL' : 'PASS'}` +
          failures.map((r) => `\n  ${r.name}`).join('')
      );
    }
  }

  log(
    `\n${failed ? `${failed} page(s) failed` : 'All pages passed'}` +
      (unmatched ? `, ${unmatched} case(s) found no PR` : '')
  );
  return report.join('\n');
}
