import * as vscode from 'vscode';
import { StructureEditorProvider } from './editor/provider';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new StructureEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(StructureEditorProvider.viewType, provider, {
      supportsMultipleEditorsPerDocument: true,
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.commands.registerCommand('molecularViewer.reopenAsText', async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (target) await vscode.commands.executeCommand('vscode.openWith', target, 'default');
    })
  );
}

export function deactivate(): void {}
