/**
 * Original monochrome geometric mark, in the spirit of Lissitzky / Malevich:
 * a tall vertical composition — wedge, overlapping circle, perpendicular bars.
 * Theme-aware via currentColor. Not a copy of any artwork.
 */
export const BANNER_SVG = `<svg class="bannerMark" viewBox="0 0 120 150" aria-hidden="true">
  <path d="M14 138 L60 18 L104 138 Z" fill="currentColor" opacity="0.9"/>
  <circle cx="74" cy="62" r="30" fill="none" stroke="currentColor" stroke-width="3"/>
  <rect x="42" y="96" width="20" height="20" fill="var(--vscode-editor-background)" stroke="currentColor" stroke-width="2"/>
  <path d="M98 8 L98 142 M110 8 L110 142" stroke="currentColor" stroke-width="4"/>
  <path d="M8 128 L112 128" stroke="currentColor" stroke-width="2"/>
</svg>`;

export const SHORTCUTS_HTML = `<details class="shortcuts bottomShortcuts">
  <summary>Commands &amp; shortcuts</summary>
  <ul>
    <li><strong>Explain in this sidebar</strong> — the Explain button (no shortcut needed)</li>
    <li><strong>Explain beside the editor</strong> — select code, then <code>Cmd+Shift+L</code> (or right-click → PIP)</li>
    <li><strong>Clickable command list</strong> — Shortcuts button in the More drawer</li>
  </ul>
</details>`;

export const LEARN_BODY = `
  <div class="row primary">
    <button id="explainBtn">Explain selection</button>
    <button id="markBtn">Mark concept</button>
    <button id="speakBtn">Read aloud</button>
  </div>
  <div class="row timer">
    <label>Timebox (session only, never saved): <input id="timerMin" type="number" value="10" min="1" max="120"> min</label>
    <button id="timerBtn">Start</button><span id="timerOut" class="muted"></span>
  </div>

  <section class="duckBox">
    <input id="duckInput" type="text" placeholder="Rubber-duck it here — say what you think this code does… (Enter)">
    <div id="duckLog"></div>
  </section>

  <section id="hint" class="hint hidden"></section>
  <section id="result"></section>
  <div id="trail" class="muted"></div>

  <details class="block" id="diagramBlock" open>
    <summary><strong>Diagrams</strong> <span class="muted">(click a box for a one-line popup)</span></summary>
    <div class="row">
      <button class="diagramTypeBtn isActive" data-type="dataFlow">Data flow</button>
      <button class="diagramTypeBtn" data-type="architecture">Architecture</button>
      <button class="diagramTypeBtn" data-type="testing">Testing flow</button>
    </div>
    <div class="row layers">
      <label><input type="checkbox" class="layerToggle" data-layer="calls" checked> calls</label>
      <label><input type="checkbox" class="layerToggle" data-layer="imports" checked> imports</label>
      <label><input type="checkbox" class="layerToggle" data-layer="params" checked> params</label>
      <label><input type="checkbox" class="layerToggle" data-layer="hooks" checked> hooks/state</label>
    </div>
    <div id="diagram"><span class="muted">Explain something and its diagrams appear here — instantly, before the text.</span></div>
  </details>

  <div id="wordPopup" class="wordPopup hidden">
    <div class="wordPopupHead"><strong id="wordPopupTitle"></strong><button id="wordPopupClose" title="Close">x</button></div>
    <div id="wordPopupBody"></div>
    <input id="wordPopupInput" type="text" placeholder="Ask a follow-up — one-line answer… (Enter)">
  </div>

  <details class="block" id="moreDrawer">
    <summary>More</summary>
    <div class="row">
      <button id="reexplainBtn" class="iconBtn" title="Re-explain the current selection" aria-label="Re-explain">&#8635;</button>
      <button id="openBesideBtn" class="iconBtn" title="Open the disposable panel beside the editor" aria-label="Open beside">&#8599;</button>
      <button id="helpBtn" class="iconBtn" title="Commands &amp; shortcuts list" aria-label="Shortcuts">&#9000;</button>
      <select id="voiceSelect" title="Voice for Read aloud"></select>
    </div>
  </details>
  <footer id="stats" class="muted">Local models only · cost $0.00</footer>`;
