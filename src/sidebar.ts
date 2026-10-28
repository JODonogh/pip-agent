import * as vscode from 'vscode';
import type { PipStore } from './store';
import { sortForReview } from './memory';
import { BANNER_SVG, LEARN_BODY, SHORTCUTS_HTML } from './banner';

type Handler = (message: { type: string; [key: string]: unknown }) => void;

/**
 * PIP home in the sidebar: Learn first (no shortcut to remember), Diagram,
 * then Flashcards and Drill as their own subsections. Retained when hidden so
 * the session timer and current explanation survive hopping between files.
 */
export class SidebarProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private handler: Handler = () => undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly store: PipStore,
  ) {}

  onMessage(handler: Handler): void {
    this.handler = handler;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
      // Retain the page (timer, explanation) while the sidebar is hidden.
      retainContextWhenHidden: true,
    } as vscode.WebviewOptions;
    const learn = view.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'learn.js'));
    const cards = view.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'sidebar.js'));
    const style = view.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'panel.css'));
    const nonce = Math.random().toString(36).slice(2);
    view.webview.html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource}; script-src 'nonce-${nonce}';">
<link href="${style}" rel="stylesheet"></head>
<body>
  <header class="banner">${BANNER_SVG}<h2>Agent PIP</h2></header>
  ${LEARN_BODY}

  <details class="block" id="cardsBlock" open>
    <summary><strong>Flashcards &amp; Drill</strong> <span class="muted">— weak spots first</span></summary>
    <p class="muted">Drill me → answer in your own words → Check. Wrong = weak spot, two right = mastered.</p>
    <div id="drill"></div>
    <div id="cards"></div>
  </details>
  ${SHORTCUTS_HTML}

  <script nonce="${nonce}" src="${learn}"></script>
  <script nonce="${nonce}" src="${cards}"></script>
</body></html>`;
    view.webview.onDidReceiveMessage((m: { type: string }) => this.handler(m));
    this.refresh();
  }

  refresh(): void {
    this.view?.webview.postMessage({ type: 'concepts', concepts: sortForReview(this.store.concepts()) });
  }

  post(message: Record<string, unknown>): void {
    this.view?.webview.postMessage(message);
  }
}
