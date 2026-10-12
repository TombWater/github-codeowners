import * as vscode from 'vscode';

// View → Output → "GitHub Code Owners"
let channel;

export const log = (...parts) => {
  channel ??= vscode.window.createOutputChannel('GitHub Code Owners');
  channel.appendLine(
    `[${new Date().toISOString()}] ${parts
      .map((p) => (typeof p === 'string' ? p : JSON.stringify(p)))
      .join(' ')}`
  );
};
