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

const sortOwnersByUserTeams = (owners, userTeams) => {
  return Array.from(owners).sort((a, b) => {
    const aUserOwns = userTeams.has(a);
    const bUserOwns = userTeams.has(b);
    if (aUserOwns && !bUserOwns) return -1;
    if (!aUserOwns && bUserOwns) return 1;
    return 0;
  });
};

export const createOwnerLabels = ({owners, ownershipData}) => {
  const {ownerApprovals, user, userTeams, teamMembers, reviewers} =
    ownershipData;
  const labels = [];

  if (owners?.size > 0) {
    // Sort owners: user's teams first, then others
    const sortedOwners = sortOwnersByUserTeams(owners, userTeams);

    sortedOwners.forEach((owner) => {
      const userOwns = userTeams.has(owner);
      const approved = ownerApprovals.has(owner);
      const members = teamMembers.get(owner);
      const label = createLabel(owner, {
        user,
        userOwns,
        approved,
        members,
        reviewers,
      });
      labels.push(label);
    });
  } else {
    const userOwns = true;
    const approved = ownerApprovals.size > 0;
    // Anyone with write access can approve, but just show users (i.e. non-teams) who have already approved
    const members = Array.from(ownerApprovals).filter(
      (approver) => !teamMembers.has(approver)
    );
    const label = createLabel('any reviewer', {
      userOwns,
      approved,
      members,
      reviewers,
    });
    labels.push(label);
  }

  return labels;
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
    const anchorName = `--ghco-anchor-${Math.random()
      .toString(36)
      .substring(2, 11)}`;
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
          drawer.style.borderTopRightRadius = `${Math.min(
            drawerWidth - labelWidth,
            9
          )}px`;
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
  const drawerContent = members
    ?.map((member) => {
      const memberCheckmark = reviewers.get(member) ? '  ✓\t' : '\t';
      const star = member === user ? ' ★' : '';
      return `${approved ? memberCheckmark : ''}${member}${star}`;
    })
    .join('\n');

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

export const clearHighlightedOwner = () => {
  highlightedOwner = null;
  document.body.classList.remove('ghco-highlight-active');
};
