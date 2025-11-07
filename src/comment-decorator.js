import * as github from './github';
import {
  getPrOwnershipData,
  getUserLogin,
  isOwnerOfFile,
  isOwnerOfAnyFile,
} from './ownership';
import pencilPaperSvg from '../public/icons/pencil-paper.svg';
import shieldSvg from '../public/icons/shield.svg';
import lightbulbSvg from '../public/icons/lightbulb.svg';

import commentsCss from './comments.css';
import {injectStyles} from './inject-styles';

// Inject CSS into page head for DevTools inspection
injectStyles(commentsCss, 'ghco-comments-styles');

// Parse SVGs once at module load time
const parseSvg = (svgString) => {
  const svgContent = svgString.replace(/<\?xml[^?]*\?>\s*/g, '');
  const parser = new DOMParser();
  const svgDoc = parser.parseFromString(svgContent, 'image/svg+xml');
  const svg = svgDoc.documentElement;
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  return svg;
};

const svgTemplates = {
  author: parseSvg(pencilPaperSvg),
  owner: parseSvg(shieldSvg),
  'non-owner': parseSvg(lightbulbSvg),
};

const getCommentFilePath = (commentElement) => {
  // Check for conversation view - inline review comments have file path in summary
  const fileLink = commentElement
    .closest('.review-thread-component')
    ?.querySelector('summary a.Link--primary');
  if (fileLink) {
    return fileLink.textContent.trim();
  }

  // Check for files view - old UI
  const fileHeader = commentElement
    .closest('.file')
    ?.querySelector('.file-header');
  if (fileHeader) {
    return fileHeader.dataset.path;
  }

  // Check for files view - new UI
  const newFileHeader = commentElement.closest('[data-tagsearch-path]');
  if (newFileHeader) {
    return newFileHeader.dataset.tagsearchPath;
  }

  // Also check for diff file markers in new UI
  const filePathElement = commentElement
    .closest('[data-testid^="diff-file-"]')
    ?.querySelector('[data-testid="file-header-text"]');
  if (filePathElement) {
    return filePathElement.textContent.trim();
  }

  // Check for data-file-path attribute in new files view
  const filePathButton = commentElement
    .closest('[role="region"]')
    ?.querySelector('[data-file-path]');
  if (filePathButton) {
    return filePathButton.dataset.filePath;
  }

  return null; // General comment, not file-specific
};

const getCommenterRole = (
  commenterLogin,
  ownershipData,
  prAuthor,
  filePath = null
) => {
  if (commenterLogin === prAuthor) {
    return 'author';
  }

  const isOwner = filePath
    ? isOwnerOfFile(commenterLogin, filePath, ownershipData)
    : isOwnerOfAnyFile(commenterLogin, ownershipData);

  return isOwner ? 'owner' : 'non-owner';
};

const createRoleIconWithTooltip = (
  role,
  commenterLogin,
  filePath,
  prNum,
  skipAnimation = false
) => {
  const container = document.createElement('span');
  container.style.display = 'contents'; // Makes container transparent in layout

  const icon = createSvgIcon(role, skipAnimation);
  icon.setAttribute('aria-label', `Comment by ${commenterLogin} as ${role}`);

  const tooltipText = getTooltipText(commenterLogin, role, filePath, prNum);
  const tooltip = createTooltip(icon.id, tooltipText);

  container.appendChild(icon);
  container.appendChild(tooltip);

  return container;
};

const createSvgIcon = (role, skipAnimation) => {
  const wrapper = document.createElement('span');
  wrapper.classList.add('ghco-comment-role-icon', 'ghco-icon-hidden');

  // Unique ID needed for tooltip
  const iconId = `ghco-icon-${Math.random().toString(36).substring(2, 11)}`;
  wrapper.id = iconId;

  const svg = svgTemplates[role].cloneNode(true);
  wrapper.appendChild(svg);

  // Trigger animation after DOM insertion (unless caller will handle it)
  if (!skipAnimation) {
    triggerIconAnimation(wrapper);
  }

  return wrapper;
};

const triggerIconAnimation = (iconOrContainer) => {
  // Handle both direct icon wrapper or container with icon inside
  const icon = iconOrContainer.classList?.contains('ghco-comment-role-icon')
    ? iconOrContainer
    : iconOrContainer.querySelector('.ghco-comment-role-icon');

  requestAnimationFrame(() => {
    icon.classList.remove('ghco-icon-hidden');
  });
};

const getTooltipText = (commenterLogin, role, filePath, prNum) => {
  if (role === 'author') {
    return `${commenterLogin} is the author of PR #${prNum}`;
  }

  if (filePath) {
    const basename = filePath.split('/').pop();
    return role === 'owner'
      ? `${commenterLogin} owns ${basename}`
      : `${commenterLogin} does not own ${basename}`;
  } else {
    return role === 'owner'
      ? `${commenterLogin} owns files in PR #${prNum}`
      : `${commenterLogin} does not own files in PR #${prNum}`;
  }
};

const createTooltip = (forId, text, direction = 'nw') => {
  const tooltip = document.createElement('tool-tip');
  tooltip.setAttribute('for', forId);
  tooltip.setAttribute('popover', 'manual');
  tooltip.setAttribute('data-direction', direction);
  tooltip.setAttribute('data-type', 'description');
  tooltip.setAttribute('role', 'tooltip');
  tooltip.classList.add('position-absolute', 'sr-only');
  tooltip.textContent = text;
  return tooltip;
};

// ------------------------------------------------------------------------------
// Main decoration functions
// ------------------------------------------------------------------------------

const decorateExistingComments = async () => {
  const authorSelectors = [
    '.timeline-comment a.author', // Old UI - conversation view
    '.review-comment a.author', // Old UI - files view
    '[data-testid="comment-header"] a[data-testid="avatar-link"]', // New UI
    '.TimelineItem-body a.author.Link--primary.text-bold', // Timeline messages
  ];
  const authorLinks = document.querySelectorAll(authorSelectors.join(', '));
  const undecorated = Array.from(authorLinks).filter(
    (link) => !link.parentNode?.querySelector('.ghco-comment-role-icon')
  );
  if (undecorated.length === 0) {
    return; // All comments already decorated
  }

  const [ownershipData, prAuthor] = await Promise.all([
    getPrOwnershipData(),
    github.getPrAuthor(),
  ]);
  if (!ownershipData || !prAuthor) {
    return;
  }
  const {num: prNum} = github.getPrInfo();

  // Batch process all icons so we can trigger animations together
  const iconsToAnimate = [];

  undecorated.forEach((authorLink) => {
    const commenterLogin =
      authorLink.textContent.trim() ||
      authorLink.getAttribute('href')?.replace('/', '');

    if (
      !commenterLogin ||
      // Check again to prevent race conditions
      authorLink.parentNode?.querySelector('.ghco-comment-role-icon') ||
      authorLink.dataset.ghcoDecorating === 'true'
    ) {
      return;
    }
    authorLink.dataset.ghcoDecorating = 'true';

    const filePath = getCommentFilePath(authorLink);
    const role = getCommenterRole(
      commenterLogin,
      ownershipData,
      prAuthor,
      filePath
    );
    const iconWithTooltip = createRoleIconWithTooltip(
      role,
      commenterLogin,
      filePath,
      prNum,
      true // Skip animation, we'll trigger it in batch
    );
    authorLink.parentNode.insertBefore(iconWithTooltip, authorLink);
    iconsToAnimate.push(iconWithTooltip);

    delete authorLink.dataset.ghcoDecorating;
  });

  // Trigger all animations together after DOM insertion
  if (iconsToAnimate.length > 0) {
    requestAnimationFrame(() => {
      iconsToAnimate.forEach(triggerIconAnimation);
    });
  }
};

const decorateDraftWriteTabs = async () => {
  const writeTabSelectors = [
    '.CommentBox-header .write-tab:not(:has(.ghco-comment-role-icon))', // Old UI
    '[class*="prc-TabNav"] button[role="tab"]:first-of-type:not(:has(.ghco-comment-role-icon))', // New UI - Write is always first
  ];
  const undecorated = document.querySelectorAll(writeTabSelectors.join(', '));

  if (undecorated.length === 0) {
    return;
  }

  const currentUser = getUserLogin();
  if (!currentUser) return;

  const [ownershipData, prAuthor] = await Promise.all([
    getPrOwnershipData(),
    github.getPrAuthor(),
  ]);
  if (!ownershipData || !prAuthor) return;
  const {num: prNum} = github.getPrInfo();

  undecorated.forEach((writeTab) => {
    // Double-check: icon might have been added since query (race condition protection)
    if (writeTab.querySelector('.ghco-comment-role-icon')) {
      return;
    }

    const filePath = getCommentFilePath(writeTab);
    const role = getCommenterRole(
      currentUser,
      ownershipData,
      prAuthor,
      filePath
    );
    const iconWithTooltip = createRoleIconWithTooltip(
      role,
      currentUser,
      filePath,
      prNum
    );

    writeTab.insertBefore(iconWithTooltip, writeTab.firstChild);
  });
};

const decorateReplyButtons = async () => {
  const replyButtonSelectors = [
    '.review-thread-reply-button:not(.ghco-processed)', // Old UI
    'button[class*="CompactCommentButton"]:not(.ghco-processed)', // New UI
  ];
  const replyButtons = document.querySelectorAll(
    replyButtonSelectors.join(', ')
  );

  if (replyButtons.length === 0) {
    return;
  }

  const currentUser = getUserLogin();
  if (!currentUser) return;

  const [ownershipData, prAuthor] = await Promise.all([
    getPrOwnershipData(),
    github.getPrAuthor(),
  ]);
  if (!ownershipData || !prAuthor) return;
  const {num: prNum} = github.getPrInfo();

  replyButtons.forEach((button) => {
    if (button.classList.contains('ghco-processed')) {
      return;
    }
    button.classList.add('ghco-processed');

    const filePath = getCommentFilePath(button);
    const role = getCommenterRole(
      currentUser,
      ownershipData,
      prAuthor,
      filePath
    );
    const iconWithTooltip = createRoleIconWithTooltip(
      role,
      currentUser,
      filePath,
      prNum,
      true // Skip animation, we'll trigger after DOM settles
    );

    button.insertBefore(iconWithTooltip, button.firstChild);

    const textNode = document.createTextNode(`Reply as ${role}...`);
    Array.from(button.childNodes).forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        node.remove();
      }
    });
    button.appendChild(textNode);

    // Double RAF: First for DOM update, second for animation
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        triggerIconAnimation(iconWithTooltip);
      });
    });
  });
};

const updateDraftPlaceholderText = async () => {
  // Quick check: is there any work to do?
  const hasPlaceholders =
    document.querySelector('.CommentBox-placeholder:not(.ghco-processed)') ||
    document.querySelector(
      'textarea[placeholder]:not(.ghco-placeholder-processed)'
    );

  if (!hasPlaceholders) {
    return;
  }

  const currentUser = getUserLogin();
  if (!currentUser) return;

  const [ownershipData, prAuthor] = await Promise.all([
    getPrOwnershipData(),
    github.getPrAuthor(),
  ]);
  if (!ownershipData || !prAuthor) {
    return;
  }

  const getPlaceholderText = (element, filePath) => {
    // Check if it's a reply context
    const isReply =
      element.closest('.review-thread-reply') !== null ||
      element.closest('[data-marker-navigation-thread-reply="true"]') !== null;
    const action = isReply ? 'Reply' : 'Comment';
    const role = getCommenterRole(
      currentUser,
      ownershipData,
      prAuthor,
      filePath
    );
    return `${action} as ${role}...`;
  };

  // Update CommentBox placeholder elements (old/conversation UI)
  const placeholders = document.querySelectorAll(
    '.CommentBox-placeholder:not(.ghco-processed)'
  );
  if (placeholders.length > 0) {
    placeholders.forEach((placeholder) => {
      const textarea = placeholder.parentElement?.querySelector('textarea');
      if (!textarea) return;

      const filePath = getCommentFilePath(textarea);
      placeholder.textContent = getPlaceholderText(textarea, filePath);
      placeholder.classList.add('ghco-processed');
    });
  }

  // Update textarea placeholder attributes (new files UI)
  const textareas = Array.from(
    document.querySelectorAll(
      'textarea[placeholder]:not(.ghco-placeholder-processed)'
    )
  ).filter(
    (textarea) =>
      textarea.placeholder === 'Leave a comment' ||
      textarea.placeholder === 'Add a comment' ||
      textarea.placeholder.includes('Reply')
  );
  if (textareas.length > 0) {
    textareas.forEach((textarea) => {
      const filePath = getCommentFilePath(textarea);
      textarea.placeholder = getPlaceholderText(textarea, filePath);
      textarea.classList.add('ghco-placeholder-processed');
    });
  }
};

export const updateCommentDecorations = async () => {
  await Promise.all([
    decorateExistingComments(),
    decorateDraftWriteTabs(),
    decorateReplyButtons(),
    updateDraftPlaceholderText(),
  ]);
};
