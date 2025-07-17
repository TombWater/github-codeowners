'use strict';

import {debounce} from 'lodash-es';

import './content.css';
import * as github from './github';

let highlightedOwner;

const onClickOwner = (ev) => {
  const clickedLabel = ev.target;

  // Give feedback for the click
  clickedLabel.classList.add('ghco-label--clicked');

  // Remove the class after the animation is complete
  setTimeout(() => {
    clickedLabel.classList.remove('ghco-label--clicked');
  }, 150); // Corresponds to animation duration in CSS

  // Defer the highlighting logic slightly to allow the animation to start smoothly
  setTimeout(() => {
    const owner = clickedLabel.dataset.owner;
    highlightedOwner = owner === highlightedOwner ? null : owner;
    document.body.classList.toggle('ghco-highlight-active', !!highlightedOwner);
    const labels = document.querySelectorAll('.ghco-label');
    labels.forEach((label) => {
      const isMatch = label.dataset.owner === highlightedOwner;
      label.classList.toggle('ghco-label--highlighted', isMatch);
    });
  });
};

const createLabel = (owner, {user, userOwns, approved, members, reviewers}) => {
  const container = document.createElement('span');
  container.classList.add('ghco-label-container');

  const label = document.createElement('button');
  const checkmark = approved ? '✓ ' : '';
  const star = !userOwns ? '' : approved ? ' ☆' : ' ★';

  label.classList.add('ghco-label');
  label.classList.toggle('ghco-label--user', userOwns);
  label.classList.toggle('ghco-label--approved', approved);

  label.textContent = `${checkmark}${owner}${star}`;
  label.dataset.owner = owner;

  label.addEventListener('click', onClickOwner);

  container.appendChild(label);

  const drawer = createDrawer({user, approved, members, reviewers});
  if (drawer) {
    const anchorName = `--ghco-anchor-${Math.random().toString(36).substring(2, 11)}`;
    drawer.style.positionAnchor = anchorName;
    container.appendChild(drawer);

    label.style.anchorName = anchorName;

    let hideTimeout;

    label.addEventListener('mouseenter', () => {
      clearTimeout(hideTimeout);
      drawer.showPopover();

      // Start the opening animation
      requestAnimationFrame(() => {
        const labelWidth = label.offsetWidth;
        const drawerWidth = drawer.offsetWidth;
        if (drawerWidth < labelWidth) {
          // Firefox fallback: ensure drawer is at least as wide as label
          drawer.style.width = `${labelWidth}px`;
        } else if (drawerWidth > labelWidth) {
          // If drawer is wider than label, make the overhanging corner round
          drawer.style.borderTopRightRadius = `${Math.min(drawerWidth - labelWidth, 9)}px`;
        }

        drawer.style.transform = 'scaleY(1)';
        drawer.style.opacity = '1';
      });
    });

    label.addEventListener('mouseleave', () => {
      // Start the closing animation immediately
      drawer.style.transform = 'scaleY(0)';
      drawer.style.opacity = '0';

      // Hide the popover after the animation completes
      hideTimeout = setTimeout(() => {
        drawer.hidePopover();
      }, 200); // Match the CSS transition duration
    });
  }

  return container;
};

const createDrawer = ({user, approved, members, reviewers}) => {
  const drawerContent = members?.map((member) => {
      const memberCheckmark = reviewers.get(member) ? '  ✓\t' : '\t';
      const star = member === user ? ' ★' : '';
      return `${approved ? memberCheckmark : ''}${member}${star}`;
    }).join('\n');

  if (!drawerContent) {
    return null;
  }

  const drawer = document.createElement('div');
  drawer.textContent = drawerContent;
  drawer.classList.add('ghco-drawer');
  drawer.popover = 'manual';
  drawer.setAttribute('role', 'drawer');
  drawer.setAttribute('aria-label', drawerContent);

  return drawer;
};

const decorateFileHeader = (
  node,
  {reviewers, folderOwners, ownerApprovals, user, userTeams, teamMembers, diffFilesMap}
) => {
  const link = node?.dataset.anchor || node.querySelector('[class^="DiffFileHeader-module__file-name"] a')?.href;
  const digest = link?.split('diff-')[1];
  const path = diffFilesMap.get(digest);
  if (!path) {
    console.log('[GHCO] No path found for file header', node);
    return;
  }
  const {owners} = folderOwners.find(({folderMatch}) =>
    // ignores() means it matches, as it's meant to match in .gitignore files
    folderMatch.ignores(path)
  );
  console.log('[GHCO] File', path, owners);

  // Remove any previous owners decoration
  node.parentNode
    .querySelectorAll('.ghco-decoration')
    .forEach((decoration) => {
      decoration.remove();
    });

  if (!owners) {
    return;
  }

  // Create the new owners decoration containing labels for each owner
  const decoration = document.createElement('div');
  decoration.classList.add('ghco-decoration', 'js-skip-tagsearch');
  if (owners.size) {
    owners.forEach((owner) => {
      const userOwns = userTeams.has(owner);
      const approved = ownerApprovals.has(owner);
      const members = teamMembers.get(owner);

      const label = createLabel(owner, {user, userOwns, approved, members, reviewers});
      decoration.appendChild(label);
    });
  } else {
    const userOwns = true;
    const approved = ownerApprovals.size > 0;
    const members = Array.from(reviewers.keys());

    const label = createLabel('anybody', {userOwns, approved, members, reviewers});
    decoration.appendChild(label);
  }
  node.parentNode.insertBefore(decoration, node.nextSibling);
};

let cachedLastFileHeader;

const getFileHeadersForDecoration = () => {
  const selectors = [
    // Old Files Changed page
    'div.file-header',
    // New Files Changed page
    'div[class^="Diff-module__diffHeaderWrapper"]',
  ];
  const fileHeaders = document.querySelectorAll(selectors.join(', '));
  if (
    fileHeaders.length === 0 ||
    cachedLastFileHeader === fileHeaders[fileHeaders.length - 1]
  ) {
    return [];
  }
  cachedLastFileHeader = fileHeaders[fileHeaders.length - 1];
  return fileHeaders;
};

const getUserLogin = () => {
  return document.head.querySelector('meta[name="user-login"]')?.content;
};

// If we are on a PR files page, update reviewer decorations on the files
const updatePrFilesPage = async () => {
  const fileHeaders = getFileHeadersForDecoration();

  // Don't do anything when not on a PR files page, or the files haven't changed
  if (fileHeaders.length === 0) {
    return;
  }
  console.log('[GHCO] Decorate PR', github.getPrInfo());

  // Owners is cached, so get it every time to invalidate the cache when needed
  const folderOwners = await github.getFolderOwners();

  // Bail out if the repo doesn't have a CODEOWNERS file
  if (folderOwners.length === 0) {
    return;
  }

  // Get these every time to invalidate their cache when needed
  let reviewers, teamMembers;
  [reviewers, teamMembers] = await Promise.all([
    github.getReviewers(),
    github.getTeamMembers(folderOwners),
  ]);

  // Map of users to a set of teams they are a member of
  const userTeamsMap = new Map();
  for (const [team, members] of teamMembers.entries()) {
    for (const member of members) {
      // Initialize the set with a pseudo-team that is the member's own login
      const teams = userTeamsMap.get(member) ?? new Set([member]);
      userTeamsMap.set(member, teams.add(team));
    }
  }

  // Set of owners/teams who approved the PR
  const ownerApprovals = new Set(
    Array.from(reviewers.entries())
      .filter(([, approved]) => approved)
      .flatMap(([approver]) => Array.from(userTeamsMap.get(approver)))
  );

  // Set of teams the current user is a member of
  const user = getUserLogin();
  const userTeams = new Set(userTeamsMap.get(user) ?? []);

  const diffFilesMap = await github.getDiffFilesMap();
  if (!diffFilesMap) {
    console.warn('[GHCO] No diff files found, cannot decorate file headers');
    return;
  }

  fileHeaders.forEach((node) =>
    decorateFileHeader(node, {
      reviewers,
      folderOwners,
      ownerApprovals,
      user,
      userTeams,
      teamMembers,
      diffFilesMap,
    })
  );
};

// Potentially refresh after every mutation, with debounce
const observer = new MutationObserver(debounce(updatePrFilesPage, 100));
observer.observe(document.body, {childList: true, subtree: true});

// Delete the disused access token that may still be in storage from the previous version
chrome.storage.local.remove('token');
