import * as path from 'path';
import * as vscode from 'vscode';
import {describeApprovalStatus} from '../../core/approval';
import {fileCommand} from './pr-diff';
import {log} from './log';
import {
  describeGroup,
  filesOwnedBy,
  memberLines,
  ownerMark,
  sortedGroups,
} from './ownership-view-model';

// Picks the viewsWelcome message shown while the tree is empty
export const setViewState = (state) =>
  vscode.commands.executeCommand('setContext', 'ghco.state', state);

const color = (id) => new vscode.ThemeColor(id);

// ★ for the user's teams, red only when the user is asked to approve
const groupIcon = ({approved, isYours, canApprove}) =>
  approved
    ? new vscode.ThemeIcon('pass-filled', color('charts.green'))
    : isYours
    ? new vscode.ThemeIcon(
        'star-full',
        color(canApprove ? 'charts.red' : 'charts.yellow')
      )
    : new vscode.ThemeIcon('color-mode', color('charts.yellow'));

// Team or person, in the browser extension's label colors: green approved,
// red waiting on the user, yellow waiting on others. Once the group is
// approved, the owners that didn't approve aren't waited on, so no color.
const ownerIcon = ({owner, approved, canApprove}, groupApproved) =>
  new vscode.ThemeIcon(
    owner.includes('/') ? 'organization' : 'person',
    approved
      ? color('charts.green')
      : groupApproved
      ? undefined
      : canApprove
      ? color('charts.red')
      : color('charts.yellow')
  );

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const ownerState = ({approved, isYours}) =>
  [approved && 'approved', isYours && 'your team'].filter(Boolean).join(', ');

// One member per line: a Markdown hard break is two spaces before \n
const memberList = (members) => memberLines(members).join('  \n');

const ownerLine = (o) => {
  const mark = ownerMark(o);
  const state = ownerState(o);
  const size = o.members ? ` (${plural(o.members.length, 'member')})` : '';
  return `- ${mark} **${o.name}**${size}${state ? ` — ${state}` : ''}`;
};

// File row hover: the path, then every owner with its members
const fileTooltip = (filePath, info) => {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${filePath}**\n\n${info.state}\n\n`);
  if (!info.owners.length) {
    md.appendMarkdown('No CODEOWNERS entry: any reviewer can approve.');
    if (info.anyApprovers.length) {
      md.appendMarkdown(`\n\nApproved by ${info.anyApprovers.join(', ')}`);
    }
    return md;
  }
  if (info.owners.length > 1) {
    md.appendMarkdown('Any one of these owners can approve:\n\n');
  }
  md.appendMarkdown(
    info.owners
      .map((o) =>
        [ownerLine(o), memberList(o.members)].filter(Boolean).join('\n\n')
      )
      .join('\n\n')
  );
  return md;
};

const orList = (names) =>
  names.length > 1
    ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`
    : names[0];

// Status sentence:
// "Approved by platform", "Waiting on you (ui) — or docs, @carol",
// "Waiting on infra"
const groupLabel = (info) => {
  const names = (owners) => owners.map((o) => o.name);
  if (info.approved) {
    const approvers = names(info.owners.filter((o) => o.approved));
    return {
      label: approvers.length
        ? `Approved by ${approvers.join(', ')}`
        : info.anyApprovers.length
        ? `Approved by ${info.anyApprovers.join(', ')}`
        : 'Approved',
    };
  }
  if (!info.owners.length) return {label: 'Waiting on any reviewer'};
  if (info.canApprove) {
    const yours = `you (${names(info.owners.filter((o) => o.canApprove)).join(
      ', '
    )})`;
    const others = names(info.owners.filter((o) => !o.canApprove));
    const label = `Waiting on ${yours}${
      others.length ? ` — or ${others.join(', ')}` : ''
    }`;
    return {label};
  }
  return {label: `Waiting on ${orList(names(info.owners))}`};
};

const ownerItem = (o, groupApproved) => {
  const item = new vscode.TreeItem(o.name);
  item.iconPath = ownerIcon(o, groupApproved);
  item.description = [
    ownerState(o),
    o.members && plural(o.members.length, 'member'),
  ]
    .filter(Boolean)
    .join(' · ');
  return item;
};

// Owner row hover: who it is, and what its inline button opens
const ownerTooltip = (o, fileCount) => {
  const md = new vscode.MarkdownString(`**${o.owner}**`);
  md.appendMarkdown(
    `\n\nCan approve ${plural(fileCount, 'file')} in this pull request, ` +
      'in this group and any others it co-owns.'
  );
  if (o.members) md.appendMarkdown(`\n\n${memberList(o.members)}`);
  return md;
};

// Group row hover: what its files have in common
const groupScope = (group, info) => {
  const files = plural(group.paths.length, 'file');
  return info.owners.length
    ? `${files} with exactly these owners in CODEOWNERS.`
    : `${files} with no CODEOWNERS entry.`;
};

const fileItem = (filePath, root, prNumber, info, command) => {
  const file = new vscode.TreeItem(path.posix.basename(filePath));
  file.description = path.posix.dirname(filePath).replace(/^\.$/, '');
  file.tooltip = fileTooltip(filePath, info);
  // For the file type icon only
  if (root) file.resourceUri = vscode.Uri.joinPath(root, filePath);
  // Shows the inline "Open File" button (package.json view/item/context)
  file.contextValue = 'ghco.file';
  file.prFile = {prNumber, filePath};
  file.command = command;
  return file;
};

// "Code Owners" tree: one node per owner group. Each group lists its owners
// first, then the files.
// Shows the checked-out PR.
export class OwnersViewProvider {
  constructor(tracker) {
    this.tracker = tracker;
    this.prNumber = null;
    this.fileItems = new Map(); // path → row, for revealFile()
    this._onDidChange = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChange.event;
    tracker.onDidChange((number) => {
      if (number === undefined || number === this.prNumber) {
        this._onDidChange.fire();
      }
    });
  }

  setPrNumber(number) {
    if (number === this.prNumber) return;
    this.prNumber = number;
    this._onDidChange.fire();
  }

  attach(view) {
    this.view = view;
  }

  getTreeItem(element) {
    return element;
  }

  // Needed by TreeView.reveal()
  getParent(element) {
    return element.parent;
  }

  // Select a file's row, as the PR extension's list follows the editor.
  // Doesn't take focus from the editor.
  revealFile(prNumber, filePath) {
    if (prNumber !== this.prNumber || !this.view?.visible) return;
    const item = this.fileItems.get(filePath);
    if (!item || this.view.selection.includes(item)) return;
    this.view
      .reveal(item, {select: true, focus: false})
      .then(undefined, () => {});
  }

  async getChildren(element) {
    if (element) return element.children ?? [];
    if (!this.prNumber) return [];

    setViewState('loading');
    const data = await this.tracker.get(this.prNumber);
    setViewState(this.tracker.statusFor(this.prNumber));
    if (this.view) {
      this.view.description = `#${this.prNumber}`;
      this.view.message =
        data?.approvalStatus && describeApprovalStatus(data.approvalStatus);
    }
    if (!data) return [];

    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    const checkedOut =
      (await this.tracker.describe())?.pullRequest?.number === this.prNumber;
    this.fileItems = new Map();
    const groups = sortedGroups(data).map((group) => {
      const info = describeGroup(group, data);
      const item = new vscode.TreeItem(
        groupLabel(info),
        info.approved
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.Expanded
      );
      item.description = plural(group.paths.length, 'file');
      item.iconPath = groupIcon(info);
      // The status, and what the inline button opens. The owner rows
      // below list owners and members.
      item.tooltip = `${info.state}\n\n${groupScope(group, info)}`;
      // Inline "Open Changes" button (package.json view/item/context)
      item.contextValue = 'ghco.group';
      item.changes = {
        prNumber: this.prNumber,
        paths: group.paths,
        title: info.owners.length
          ? orList(info.owners.map((o) => o.name))
          : 'Any reviewer',
        key: `group/${[...(group.owners ?? [])].sort().join(',')}`,
      };
      item.children = [
        ...info.owners.map((o) => {
          const row = ownerItem(o, info.approved);
          // Everything this owner can approve, across groups
          const paths = filesOwnedBy([o.owner], data);
          row.tooltip = ownerTooltip(o, paths.length);
          row.contextValue = 'ghco.owner';
          row.changes = {
            prNumber: this.prNumber,
            paths,
            title: `All files of ${o.name}`,
            key: `owner/${o.owner}`,
          };
          return row;
        }),
        ...group.paths.map((filePath) => {
          const file = fileItem(
            filePath,
            root,
            this.prNumber,
            info,
            root && fileCommand(data, root, filePath, checkedOut)
          );
          this.fileItems.set(filePath, file);
          return file;
        }),
      ];
      for (const child of item.children) child.parent = item;
      return item;
    });
    // Let the editor sync select the active file in the rebuilt tree, once
    // VSCode has taken the new rows
    setTimeout(() => this.onDidRebuild?.(), 100);
    return groups;
  }
}
