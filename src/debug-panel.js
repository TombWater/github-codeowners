import * as github from './github';
import {getPrOwnershipData} from './ownership';
import './debug-panel.css';

let updateCount = 0;
let lastUpdateTime = null;
let currentUrl = window.location.href;

// Store simulated approval states
const simulatedApprovals = new Map(); // owner -> boolean

// Export function to get simulated approvals (used by ownership.js)
export const getSimulatedApprovals = () => simulatedApprovals;

// Store simulated merge state
let simulatedMergeState = null; // null = use real state, true/false = simulated

// Export function to get simulated merge state
export const getSimulatedMergeState = () => simulatedMergeState;

// Reset simulations when navigating to a different PR
const checkUrlChange = () => {
  if (window.location.href !== currentUrl) {
    console.log('[GHCO Debug] URL changed, resetting simulations');
    currentUrl = window.location.href;
    simulatedApprovals.clear();
    simulatedMergeState = null;

    // Reset merge button if it exists
    const mergeButton = document.getElementById('ghco-simulate-merge');
    if (mergeButton) {
      mergeButton.textContent = '🔀 Simulate Merge';
      mergeButton.disabled = false;
      mergeButton.style.opacity = '';
    }
  }
};

export const incrementUpdateCount = () => {
  updateCount++;
  lastUpdateTime = new Date();

  // Check if URL changed (navigation to different PR)
  checkUrlChange();

  console.log(
    `[GHCO Debug] Update #${updateCount} triggered at ${lastUpdateTime.toISOString()}`
  );
};

export const initDebugPanel = (updateAllCallback) => {
  // Expose debug functions on window for github.js to access
  window.__ghcoDebugPanel = {
    getSimulatedApprovals,
    getSimulatedMergeState,
  };

  console.log('[GHCO Debug] Debug mode enabled');

  // Create panel after a short delay to ensure page is loaded
  setTimeout(() => createDebugPanel(updateAllCallback), 1000);
};

const createDebugPanel = (updateAllCallback) => {
  const panel = document.createElement('div');
  panel.id = 'ghco-debug-panel';

  panel.appendChild(createHeader());
  panel.appendChild(createStatsSection());
  panel.appendChild(createButtonsSection(updateAllCallback));

  document.body.appendChild(panel);

  // Update stats periodically
  startStatsUpdater();
};

const createHeader = () => {
  const header = document.createElement('div');
  header.className = 'ghco-debug-header';
  header.innerHTML = `
    <span>🔧 GHCO Debug</span>
    <button id="ghco-debug-close" class="ghco-debug-close">×</button>
  `;

  return header;
};

const createStatsSection = () => {
  const stats = document.createElement('div');
  stats.className = 'ghco-debug-stats';
  stats.innerHTML = `
    <div>Updates: <strong id="ghco-update-count">0</strong></div>
    <div>Last: <span id="ghco-last-update">Never</span></div>
    <div>State: <code id="ghco-state">-</code></div>
  `;

  return stats;
};

const createButtonsSection = (updateAllCallback) => {
  const buttons = document.createElement('div');
  buttons.innerHTML = `
    <button id="ghco-force-update">🔄 Force Update</button>
    <button id="ghco-log-state">📊 Log Current State</button>
    <button id="ghco-log-ownership">👥 Log Ownership Data</button>
    <button id="ghco-clear-session">🗑️ Clear Session State</button>
    <button id="ghco-simulate-approval">✓ Simulate Approval Change</button>
    <button id="ghco-simulate-merge">🔀 Simulate Merge</button>
  `;

  attachButtonListeners(updateAllCallback);

  return buttons;
};

const startStatsUpdater = () => {
  let lastDisplayedCount = -1;
  let lastDisplayedTime = null;
  let lastDisplayedState = null;

  setInterval(() => {
    const updateCountEl = document.getElementById('ghco-update-count');
    const lastUpdateEl = document.getElementById('ghco-last-update');
    const stateEl = document.getElementById('ghco-state');

    if (!updateCountEl) return; // Panel was closed

    // Only update DOM if values actually changed
    if (updateCount !== lastDisplayedCount) {
      updateCountEl.textContent = updateCount;
      lastDisplayedCount = updateCount;
    }

    const timeString = lastUpdateTime
      ? lastUpdateTime.toLocaleTimeString()
      : 'Never';
    if (timeString !== lastDisplayedTime) {
      lastUpdateEl.textContent = timeString;
      lastDisplayedTime = timeString;
    }

    const section = document.querySelector('section[aria-label="Code owners"]');
    const state = section?.dataset?.state || '-';
    const displayState =
      state.substring(0, 50) + (state.length > 50 ? '...' : '');
    if (displayState !== lastDisplayedState) {
      stateEl.textContent = displayState;
      lastDisplayedState = displayState;
    }
  }, 500);
};

const attachButtonListeners = (updateAllCallback) => {
  // Need to wait for buttons to be in DOM
  setTimeout(() => {
    const panel = document.getElementById('ghco-debug-panel');
    if (!panel) return;

    document.getElementById('ghco-debug-close').onclick = () => {
      panel.remove();
      window.ghcoDebug = false;
    };

    document.getElementById('ghco-force-update').onclick = async () => {
      console.log('[GHCO Debug] Forcing update...');
      await updateAllCallback();
    };

    document.getElementById('ghco-log-state').onclick = handleLogState;
    document.getElementById('ghco-log-ownership').onclick = handleLogOwnership;
    document.getElementById('ghco-clear-session').onclick = handleClearSession;
    document.getElementById('ghco-simulate-approval').onclick =
      handleSimulateApproval;
    document.getElementById('ghco-simulate-merge').onclick =
      handleSimulateMerge;
  }, 0);
};

const handleLogState = () => {
  const section = document.querySelector('section[aria-label="Code owners"]');
  const prInfo = github.getPrInfo();
  const mergeBox = document.querySelector('div[class*="MergeBox-module"]');

  console.group('[GHCO Debug] Current State');
  console.log('PR Info:', prInfo);
  console.log('Section exists:', !!section);
  console.log('Section state:', section?.dataset?.state);
  console.log('Merge box exists:', !!mergeBox);
  console.log('Update count:', updateCount);
  console.log('Last update:', lastUpdateTime);
  console.groupEnd();
};

const handleLogOwnership = async () => {
  console.group('[GHCO Debug] Ownership Data');
  try {
    const ownershipData = await getPrOwnershipData();
    const diffFiles = await github.getDiffFilesMap();

    console.log('Ownership data:', ownershipData);
    console.log('User teams:', Array.from(ownershipData?.userTeams || []));
    console.log(
      'Owner approvals:',
      Array.from(ownershipData?.ownerApprovals || [])
    );
    console.log('Diff files:', diffFiles?.size, 'files');
    console.log('Files:', Array.from(diffFiles?.values() || []));
  } catch (err) {
    console.error('Error fetching ownership data:', err);
  }
  console.groupEnd();
};

const handleClearSession = () => {
  const prId = document.querySelector('#partial-discussion-header')?.dataset
    ?.gid;
  const key = `${prId}:ghco-codeownersExpanded`;
  sessionStorage.removeItem(key);
  console.log('[GHCO Debug] Cleared expand state from session storage');
};

const handleSimulateApproval = async () => {
  // Get current ownership data
  const ownershipData = await getPrOwnershipData();

  if (!ownershipData) {
    console.error('[GHCO Debug] No ownership data available');
    return;
  }

  const {folderOwners, reviewers, teamMembers, diffFilesMap} = ownershipData;

  // Collect only teams that own files in this PR
  const teamsOwningFiles = new Set();

  for (const path of diffFilesMap.values()) {
    const fileOwnership = folderOwners.find(({folderMatch}) =>
      folderMatch.ignores(path)
    );

    if (fileOwnership) {
      fileOwnership.owners.forEach((owner) => teamsOwningFiles.add(owner));
    }
  }

  if (teamsOwningFiles.size === 0) {
    console.error('[GHCO Debug] No owners found for files in this PR');
    return;
  }

  // Build a structure: team -> Set of members (only for teams that own files)
  const teamToMembers = new Map();
  const memberToTeams = new Map();

  // Build team membership maps only for teams that own files in this PR
  for (const [team, members] of teamMembers.entries()) {
    if (teamsOwningFiles.has(team)) {
      teamToMembers.set(team, members);

      // Track which teams each member belongs to
      for (const member of members) {
        if (!memberToTeams.has(member)) {
          memberToTeams.set(member, []);
        }
        memberToTeams.get(member).push(team);
      }
    }
  }

  if (teamToMembers.size === 0) {
    console.error('[GHCO Debug] No team members found');
    return;
  }

  // Get current approval state (real + simulated)
  const currentApprovals = new Map();

  // Start with real reviewer approvals
  for (const [reviewer, approved] of reviewers.entries()) {
    currentApprovals.set(reviewer, approved);
  }

  // Apply any existing simulated approvals
  for (const [owner, approved] of simulatedApprovals.entries()) {
    currentApprovals.set(owner, approved);
  }

  // Create popup
  showApprovalPopup(teamToMembers, memberToTeams, currentApprovals);
};

const showApprovalPopup = (teamToMembers, memberToTeams, currentApprovals) => {
  // Remove existing popup if any
  document.getElementById('ghco-approval-popup-overlay')?.remove();
  document.getElementById('ghco-approval-popup')?.remove();

  // Create overlay
  const overlay = document.createElement('div');
  overlay.id = 'ghco-approval-popup-overlay';
  overlay.onclick = closeApprovalPopup;

  // Create popup
  const popup = document.createElement('div');
  popup.id = 'ghco-approval-popup';

  const header = document.createElement('div');
  header.className = 'ghco-popup-header';
  header.innerHTML = `
    <div class="ghco-popup-title">Simulate Approval Changes</div>
    <button class="ghco-popup-close">×</button>
  `;

  const list = document.createElement('div');
  list.className = 'ghco-owner-list';

  // Track all checkboxes for each member (to sync them)
  const memberCheckboxes = new Map(); // member -> [checkbox1, checkbox2, ...]

  // Group by team
  const sortedTeams = Array.from(teamToMembers.keys()).sort();

  sortedTeams.forEach((team) => {
    const members = teamToMembers.get(team);

    // Team header
    const teamHeader = document.createElement('div');
    teamHeader.className = 'ghco-team-header';
    teamHeader.textContent = team;
    list.appendChild(teamHeader);

    // Sort members
    const sortedMembers = Array.from(members).sort();

    sortedMembers.forEach((member) => {
      const isMemberApproved = currentApprovals.get(member) === true;
      const hasSimulation = simulatedApprovals.has(member);

      const item = document.createElement('div');
      item.className = 'ghco-owner-item';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'ghco-approval-checkbox';
      checkbox.checked = isMemberApproved;
      checkbox.dataset.member = member;

      const label = document.createElement('label');
      label.className = 'ghco-owner-name';
      label.textContent = member;
      label.style.cursor = 'pointer';

      // Add indicator if this is simulated
      if (hasSimulation) {
        label.textContent += ' 🔧';
        label.title = 'Simulated approval state';
      }

      // Track this checkbox for syncing
      if (!memberCheckboxes.has(member)) {
        memberCheckboxes.set(member, []);
      }
      memberCheckboxes.get(member).push(checkbox);

      // Handle checkbox change
      const handleChange = () => {
        const newState = checkbox.checked;

        // Update all checkboxes for this member
        const allCheckboxes = memberCheckboxes.get(member);
        allCheckboxes.forEach((cb) => {
          cb.checked = newState;
        });

        // Update all labels for this member
        const allLabels = list.querySelectorAll(
          `label[data-member="${member}"]`
        );
        allLabels.forEach((lbl) => {
          lbl.textContent = member;
          if (
            simulatedApprovals.has(member) ||
            newState !== (currentApprovals.get(member) === true)
          ) {
            lbl.textContent += ' 🔧';
            lbl.title = 'Simulated approval state';
          }
        });

        toggleApproval(member, newState);
      };

      checkbox.onchange = handleChange;
      label.onclick = () => {
        checkbox.checked = !checkbox.checked;
        handleChange();
      };

      // Store member reference on label for later updates
      label.dataset.member = member;

      item.appendChild(checkbox);
      item.appendChild(label);
      list.appendChild(item);
    });
  });

  popup.appendChild(header);
  popup.appendChild(list);

  document.body.appendChild(overlay);
  document.body.appendChild(popup);

  // Close button handler
  popup.querySelector('.ghco-popup-close').onclick = closeApprovalPopup;
};

const closeApprovalPopup = () => {
  document.getElementById('ghco-approval-popup-overlay')?.remove();
  document.getElementById('ghco-approval-popup')?.remove();
};

const toggleApproval = (owner, approved) => {
  console.log(
    `[GHCO Debug] Toggling approval: ${owner} → ${
      approved ? 'approved' : 'not approved'
    }`
  );

  // Store the simulated approval state
  simulatedApprovals.set(owner, approved);
  console.log(
    '[GHCO Debug] Simulated approvals:',
    Array.from(simulatedApprovals.entries())
  );

  // Trigger DOM mutation to cause extension update
  const targetElement =
    document.querySelector('div[class*="MergeBox-module"]') ||
    document.querySelector('[data-testid="merge-box"]') ||
    document.querySelector('#partial-discussion-header') ||
    document.body;

  // Add a temporary element to trigger mutation observer
  const tempDiv = document.createElement('div');
  tempDiv.style.display = 'none';
  tempDiv.dataset.ghcoSimulation = `${owner}:${approved}:${Date.now()}`;
  targetElement.appendChild(tempDiv);

  setTimeout(() => {
    tempDiv.remove();
  }, 50);

  console.log(
    `[GHCO Debug] Mutation triggered - update count should increment`
  );
};

const handleSimulateMerge = () => {
  const button = document.getElementById('ghco-simulate-merge');

  // Check if already simulated
  if (simulatedMergeState === true) {
    alert('Merge already simulated. Reload the page to reset.');
    return;
  }

  // Start simulating merge (one-way operation)
  simulatedMergeState = true;
  button.textContent = '🔀 Merged (reload to undo)';
  button.disabled = true;

  console.log(
    '[GHCO Debug] Simulating PR merge - removing sections and adding merged message'
  );

  // Find the merge box container
  const mergeBox = document.querySelector('div[class*="MergeBox-module"]');
  if (!mergeBox) {
    console.error('[GHCO Debug] Could not find merge box container');
    return;
  }

  // Find the bordered container inside (more flexible selector)
  const borderedContainer = mergeBox.querySelector(
    'div[class*="MergeBox-module__mergeBoxAdjustBorders"], div.border.rounded-2'
  );
  if (!borderedContainer) {
    console.error('[GHCO Debug] Could not find bordered container');
    console.log(
      '[GHCO Debug] Merge box HTML:',
      mergeBox.innerHTML.substring(0, 500)
    );
    return;
  }

  // Find code owners section
  const codeOwnersSection = borderedContainer.querySelector(
    'section[aria-label="Code owners"]'
  );
  if (!codeOwnersSection) {
    console.error('[GHCO Debug] Could not find code owners section');
    return;
  }

  // Remove all sections except code owners
  const allChildren = Array.from(borderedContainer.children);
  allChildren.forEach((child) => {
    if (child !== codeOwnersSection) {
      child.remove();
    }
  });

  // Add the merged message as the first child
  const mergedMessage = createMergedMessage();
  borderedContainer.insertBefore(mergedMessage, borderedContainer.firstChild);

  // Move code owners section to be first (before merged message)
  borderedContainer.insertBefore(codeOwnersSection, mergedMessage);

  // Add border-top to code owners section (like GitHub does)
  if (!codeOwnersSection.classList.contains('border-top')) {
    codeOwnersSection.classList.add('border-top', 'color-border-subtle');
  }

  console.log(
    '[GHCO Debug] Simulated merge complete - code owners section should be first'
  );

  // Trigger mutation
  const tempDiv = document.createElement('div');
  tempDiv.style.display = 'none';
  tempDiv.dataset.ghcoSimulation = `merge:${Date.now()}`;
  borderedContainer.appendChild(tempDiv);
  setTimeout(() => tempDiv.remove(), 50);
};

const createMergedMessage = () => {
  const section = document.createElement('div');
  section.dataset.ghcoSimulatedMerge = 'true';
  section.className =
    'MergeBoxSectionHeader-module__wrapper--zMA1Y flex-column flex-sm-row flex-items-center flex-sm-items-start flex-justify-between';

  section.innerHTML = `
    <div class="d-flex width-full">
      <div class="d-flex flex-1 flex-column flex-sm-row gap-2">
        <div class="flex-1">
          <h3 class="MergeBoxSectionHeader-module__MergeBoxSectionHeading--miHzz prc-Heading-Heading-6CmGO">
            Pull request successfully merged and closed
          </h3>
          <p class="fgColor-muted mb-0">
            You're all set — the branch has been merged.
          </p>
        </div>
      </div>
    </div>
  `;

  return section;
};
