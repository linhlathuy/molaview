import * as path from 'node:path';
import * as vscode from 'vscode';
import { pairKey } from '../geometry/bonds';
import { isViewMessage, type HostMessage } from '../protocol';
import { StructureDocument } from './document';
import { createWebviewHtml } from './html';

function nonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

export class StructureEditorProvider implements vscode.CustomReadonlyEditorProvider<StructureDocument> {
  static readonly viewType = 'molecularViewer.structureEditor';

  constructor(private readonly context: vscode.ExtensionContext) {}

  openCustomDocument(uri: vscode.Uri): Promise<StructureDocument> {
    return StructureDocument.open(uri);
  }

  async resolveCustomEditor(document: StructureDocument, panel: vscode.WebviewPanel): Promise<void> {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')]
    };
    panel.webview.html = createWebviewHtml(panel.webview, this.context.extensionUri, nonce());

    const post = (message: HostMessage): Thenable<boolean> => panel.webview.postMessage(message);
    const showState = async (sampleIndex?: number, fullLoad = false): Promise<void> => {
      try {
        const state = await document.state(sampleIndex);
        await post(fullLoad ? { type: 'load', state } : {
          type: 'frame',
          structure: state.structure,
          sampleIndex: state.sampleIndex,
          originalFrameIndex: state.originalFrameIndex
        });
      } catch (error) {
        await post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    };

    const messages = panel.webview.onDidReceiveMessage(async (message: unknown) => {
      if (!isViewMessage(message)) return;
      switch (message.type) {
        case 'ready': await showState(undefined, true); break;
        case 'requestFrame': await showState(message.sampleIndex); break;
        case 'reopenAsText': await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default'); break;
        case 'saveScreenshot': await this.saveScreenshot(document.uri, message.bytes, message.suggestedName); break;
        case 'setBondOverrides': {
          const cutoffs = Object.fromEntries(Object.entries(message.cutoffs).map(([key, value]) => {
            const elements = key.split('-');
            return [elements.length === 2 ? pairKey(elements[0]!, elements[1]!) : key, value];
          }));
          document.setBondOptions({ tolerance: message.tolerance, hiddenPairs: new Set(message.hiddenPairs), cutoffs });
          await showState();
          break;
        }
        case 'setSupercell': break;
      }
    });

    const pattern = new vscode.RelativePattern(document.uri.with({ path: path.posix.dirname(document.uri.path) }), path.posix.basename(document.uri.path));
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    let reloadTimer: ReturnType<typeof setTimeout> | undefined;
    const reload = (): void => {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(async () => {
        try { await document.reload(); await showState(undefined, true); }
        catch (error) { await post({ type: 'error', message: 'Could not reload structure', detail: error instanceof Error ? error.message : String(error) }); }
      }, 180);
    };
    watcher.onDidChange(reload);
    watcher.onDidCreate(reload);
    watcher.onDidDelete(() => post({ type: 'error', message: 'The structure file was deleted' }));
    panel.onDidDispose(() => { messages.dispose(); watcher.dispose(); if (reloadTimer) clearTimeout(reloadTimer); });
  }

  private async saveScreenshot(source: vscode.Uri, values: number[], suggestedName: string): Promise<void> {
    if (values.length > 100_000_000 || values.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
      throw new Error('Invalid screenshot data');
    }
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.joinPath(source, '..', suggestedName),
      filters: { 'PNG image': ['png'] }
    });
    if (target) await vscode.workspace.fs.writeFile(target, Uint8Array.from(values));
  }
}
