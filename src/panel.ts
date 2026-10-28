import * as vscode from 'vscode';
import type { CodeContext } from './types';
import { BANNER_SVG, LEARN_BODY, SHORTCUTS_HTML } from './banner';

type Handler = (message: { type: string; [key: string]: unknown }) => void;

/** The disposable beside-editor panel. Close it and it is gone — no chat history. */
export class LearnPanel {
  private static current: LearnPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private handler: Handler = () => undefined;

  static show(extensionUri: vscode.Uri, context: CodeContext): LearnPanel {
    if (LearnPanel.current) {
      LearnPanel.current.panel.reveal(vscode.ViewColumn.Beside);
      LearnPanel.current.post({ type: 'context', context });
      return LearnPanel.current;
    }
    const panel = vscode.window.createWebviewPanel('pip.learn', 'PIP: Learn', vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: false,
      localResourceRoots: [extensionUri],
    });
    LearnPanel.current = new LearnPanel(panel, extensionUri);
    LearnPanel.current.post({ type: 'context', context });
    return LearnPanel.current;
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    const script = panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'learn.js'));
    const style = panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'panel.css'));
    const nonce = Math.random().toString(36).slice(2);
    panel.webview.html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${panel.webview.cspSource}; script-src 'nonce-${nonce}';">
<link href="${style}" rel="stylesheet"></head>
<body>
  <header class="banner">${BANNER_SVG}<h2>Agent PIP — Learn</h2></header>
  ${LEARN_BODY}
  ${SHORTCUTS_HTML}
  <script nonce="${nonce}" src="${script}"></script>
</body></html>`;
    panel.onDidDispose(() => {
      LearnPanel.current = undefined;
    });
    panel.webview.onDidReceiveMessage((m: { type: string }) => this.handler(m));
  }

  onMessage(handler: Handler): void {
    this.handler = handler;
  }

  post(message: Record<string, unknown>): void {
    void this.panel.webview.postMessage(message);
  }
}
