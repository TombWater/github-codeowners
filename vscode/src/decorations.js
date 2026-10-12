import * as vscode from 'vscode';
import {
  describeGroup,
  groupForPath,
  memberLines,
  ownerMark,
} from './ownership-view-model';

// The PR extension's changed-file tree items carry a JSON query holding
// `prNumber` and the repo-relative `fileName`. Their scheme is `file` for
// the checked-out PR and `pr` for others. Explorer files have no query, so
// they stay undecorated.
const PR_SCHEMES = new Set(['file', 'filechange', 'pr']);

// Equal widths keep the PR extension's M/A/D letter before our badge in
// place. A badge may be 2 characters, so narrower symbols get a Unicode
// space in front to match ★ (1.016 em in the macOS system font):
// U+2006 + ✓ = 1.032 em, U+2006 + ◐ (Apple Symbols) = 0.996 em
const BADGES = {
  yours: '★',
  approved: '\u2006✓',
  waiting: '\u2006◐',
};

// VSCode appends this to the PR extension's own hover text after " • " and
// shows it as plain text with line breaks kept, so the first line joins
// that line and the owners follow on lines of their own
const hoverText = ({state, owners, anyApprovers}) => {
  const lines = [`Code owners: ${state}`];
  if (!owners.length) {
    lines.push('', 'Any reviewer can approve');
    if (anyApprovers.length)
      lines.push(`Approved by ${anyApprovers.join(', ')}`);
  }
  if (owners.length > 1) lines.push('', 'Any one of these owners can approve:');
  for (const o of owners) {
    const size = o.members ? ` (${o.members.length})` : '';
    lines.push('', `${ownerMark(o)} ${o.name}${size}`);
    lines.push(...memberLines(o.members).map((m) => `    ${m}`));
  }
  return lines.join('\n');
};

const parsePrUri = (uri) => {
  if (!PR_SCHEMES.has(uri.scheme) || !uri.query) return null;
  try {
    const {prNumber, fileName} = JSON.parse(uri.query);
    return prNumber && fileName ? {prNumber, fileName} : null;
  } catch {
    return null;
  }
};

export class OwnerDecorationProvider {
  constructor(tracker) {
    this.tracker = tracker;
    this._onDidChange = new vscode.EventEmitter();
    this.onDidChangeFileDecorations = this._onDidChange.event;
    // `undefined` asks VSCode to re-query every decoration
    tracker.onDidChange(() => this._onDidChange.fire(undefined));
  }

  provideFileDecoration(uri) {
    const target = parsePrUri(uri);
    if (!target) return undefined;

    const data = this.tracker.peek(target.prNumber);
    const group = data && groupForPath(target.fileName, data);
    if (!group) return undefined;

    const info = describeGroup(group, data);
    const {approved, isYours, canApprove} = info;
    const tooltip = hoverText(info);

    // ★ is membership, also on the user's own PR. Color only where the
    // user has to act; the PR extension already colors labels by change
    // type and we shouldn't override that everywhere
    if (approved) return new vscode.FileDecoration(BADGES.approved, tooltip);
    if (isYours) {
      return new vscode.FileDecoration(
        BADGES.yours,
        tooltip,
        canApprove ? new vscode.ThemeColor('charts.red') : undefined
      );
    }
    return new vscode.FileDecoration(BADGES.waiting, tooltip);
  }
}
