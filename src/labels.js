let highlightedOwner;

const sortOwnersByUserTeams = (owners, userTeams) => {
  return Array.from(owners).sort((a, b) => {
    const aUserOwns = userTeams.has(a);
    const bUserOwns = userTeams.has(b);
    if (aUserOwns && !bUserOwns) return -1;
    if (!aUserOwns && bUserOwns) return 1;
    return 0;
  });
};

export const createOwnerLabels = ({owners, ownershipData, onOwnerClick}) => {
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
        onOwnerClick,
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
      onOwnerClick,
    });
    labels.push(label);
  }

  return labels;
};

const createLabel = (
  owner,
  {user, userOwns, approved, members, reviewers, onOwnerClick}
) => {
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

  // Store the callback on the element to be used by the delegated listener
  label._onOwnerClick = onOwnerClick;

  container.appendChild(label);

  const drawer = createDrawer({user, approved, members, reviewers});
  if (drawer) {
    const anchorName = `--ghco-anchor-${Math.random()
      .toString(36)
      .substring(2, 11)}`;
    drawer.style.positionAnchor = anchorName;
    container.appendChild(drawer);

    label.style.anchorName = anchorName;
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

let programmaticExpansion = false;

export const setProgrammaticExpansion = (value) => {
  programmaticExpansion = value;
};

export const clearHighlightedOwner = () => {
  if (programmaticExpansion) return;

  highlightedOwner = null;
  document.body.classList.remove('ghco-highlight-active');
  const labels = document.querySelectorAll('.ghco-label');
  labels.forEach((label) => {
    label.classList.remove('ghco-label--highlighted');
  });
};

// Delegate listeners to avoid attaching listeners to every label
document.addEventListener('click', (ev) => {
  const label = ev.target?.closest('.ghco-label');
  if (label) {
    const owner = label.dataset.owner;
    const onOwnerClick = label._onOwnerClick;

    // Give feedback for the click
    label.classList.add('ghco-label--clicked');

    // Remove the class after the animation is complete
    setTimeout(() => {
      label.classList.remove('ghco-label--clicked');
    }, 150); // Corresponds to animation duration in CSS

    // Defer the logic slightly to allow the animation to start smoothly
    setTimeout(() => {
      // Toggle highlighting
      highlightedOwner = owner === highlightedOwner ? null : owner;
      document.body.classList.toggle(
        'ghco-highlight-active',
        !!highlightedOwner
      );

      const labels = document.querySelectorAll('.ghco-label');
      labels.forEach((accLabel) => {
        const isMatch = accLabel.dataset.owner === highlightedOwner;
        accLabel.classList.toggle('ghco-label--highlighted', isMatch);
      });

      onOwnerClick?.(highlightedOwner, ev);
    });
  }
});

document.addEventListener('mouseover', (ev) => {
  const label = ev.target?.closest('.ghco-label');
  if (!label || label.contains(ev.relatedTarget)) return;

  const drawer = label.parentNode.querySelector('.ghco-drawer');
  if (!drawer) return;

  clearTimeout(label._hideTimeout);
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
        9 // matches .ghco-label border-radius in CSS
      )}px`;
    }

    drawer.style.transform = 'scaleY(1)';
    drawer.style.opacity = '1';
  });
});

document.addEventListener('mouseout', (ev) => {
  const label = ev.target?.closest('.ghco-label');
  if (!label || label.contains(ev.relatedTarget)) return;

  const drawer = label.parentNode.querySelector('.ghco-drawer');
  if (!drawer) return;

  // Start the closing animation immediately
  drawer.style.transform = 'scaleY(0)';
  drawer.style.opacity = '0';

  // Hide the popover after the animation completes
  label._hideTimeout = setTimeout(() => {
    drawer.hidePopover();
  }, 200); // Match the CSS transition duration
});
