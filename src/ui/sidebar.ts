import * as vscode from 'vscode';
import type { PipStore } from '../platform/store';
import { sortForReview } from '../learning/memory';
import { reviewView } from '../learning/review';
import { bannerImage, LEARN_BODY } from './banner';

type Handler = (message: { type: string; [key: string]: unknown }) => void;

/**
 * PIP home in the sidebar: Canvas Kit layout with Constructivist/Proun hero header,
 * Primary Action Bar + Timebox, Segmented Control (Learn / Solve / Create / Review),
 * and flush Disclosure cards. Retained when hidden so session timer survives file switches.
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
    } as vscode.WebviewOptions;
    const learn = view.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'learn.js'));
    const cards = view.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'sidebar.js'));
    const tooltips = view.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'tooltip.js'));
    const style = view.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'panel.css'));
    const artwork = view.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'brand-transparent.png'));
    const nonce = Math.random().toString(36).slice(2);
    view.webview.html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${view.webview.cspSource}; style-src ${view.webview.cspSource}; script-src 'nonce-${nonce}';">
<link href="${style}" rel="stylesheet"></head>
<body>
  <main class="cnvs-shell">
    <header class="banner">
      ${bannerImage(artwork.toString())}
      <div class="bannerTitleRow">
        <h2>Agent PIP</h2>
        <span class="bannerSub">Constructivist Code Companion</span>
      </div>
    </header>

    ${LEARN_BODY}
  </main>

  <script nonce="${nonce}" src="${learn}"></script>
  <script nonce="${nonce}" src="${cards}"></script>
  <script nonce="${nonce}" src="${tooltips}"></script>
</body></html>`;
    view.webview.onDidReceiveMessage((m: { type: string }) => this.handler(m));
    this.refresh();
  }

  refresh(): void {
    this.view?.webview.postMessage({
      type: 'concepts',
      concepts: sortForReview(this.store.concepts()).map(reviewView),
    });
  }

  post(message: Record<string, unknown>): void {
    this.view?.webview.postMessage(message);
  }
}
