/**
 * Original monochrome geometric mark, loosely in the spirit of Lissitzky /
 * Malevich: overlapping wedge, circle, perpendicular bars and a solid square.
 * Theme-aware via currentColor. Not a copy of any artwork.
 */
export const BANNER_SVG = `<svg class="bannerMark" viewBox="0 0 300 108" aria-hidden="true">
  <circle cx="168" cy="54" r="40" fill="none" stroke="currentColor" stroke-width="3"/>
  <path d="M18 96 L118 14 L196 96 Z" fill="currentColor" opacity="0.88"/>
  <rect x="128" y="62" width="26" height="26" fill="var(--vscode-editor-background)" stroke="currentColor" stroke-width="2"/>
  <path d="M232 6 L232 102 M262 6 L262 102 M214 84 L286 84" stroke="currentColor" stroke-width="5"/>
  <path d="M36 96 L282 96" stroke="currentColor" stroke-width="2"/>
</svg>`;

export const SHORTCUTS_HTML = `<details class="shortcuts">
  <summary>Commands &amp; shortcuts</summary>
  <ul>
    <li><strong>Explain in this sidebar</strong> — the Explain button (no shortcut needed)</li>
    <li><strong>Explain beside the editor</strong> — select code, then <code>Cmd+Shift+L</code> (or right-click → PIP)</li>
    <li><strong>Clickable command list</strong> — Shortcuts button in the More drawer below</li>
  </ul>
</details>`;

export const LEARN_BODY = `
  <div id="where" class="muted">Select code in the editor, then press Explain.</div>
  <div class="row primary">
    <button id="explainBtn">Explain selection</button>
    <button id="markBtn">Mark concept</button>
    <button id="speakBtn">Read aloud</button>
  </div>
  <section id="hint" class="hint hidden"></section>
  <section id="status" class="muted"></section>
  <section id="result"></section>
  <div id="trail" class="muted"></div>
  <div id="nested"></div>

  <section class="block" id="diagramBlock">
    <h3>Diagrams</h3>
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
    <div id="diagram"><span class="muted">Explain something and its diagrams appear here — instantly, before the text. Click a box to dig into it.</span></div>
  </section>

  <section class="ask block">
    <input id="askInput" type="text" placeholder="Quick-fire question, or tell the duck what you think…">
    <div class="row">
      <button id="quickBtn">Quick-fire (1 sentence)</button>
      <button id="duckBtn">Rubber-duck it</button>
    </div>
    <div id="askResult"></div>
  </section>

  <details class="block" id="moreDrawer">
    <summary>More</summary>
    <div class="row">
      <button id="reexplainBtn" class="iconBtn" title="Re-explain the current selection" aria-label="Re-explain">&#8635;</button>
      <button id="openBesideBtn" class="iconBtn" title="Open the disposable panel beside the editor" aria-label="Open beside">&#8599;</button>
      <button id="helpBtn" class="iconBtn" title="Commands &amp; shortcuts list" aria-label="Shortcuts">&#9000;</button>
      <select id="voiceSelect" title="Voice for Read aloud"></select>
    </div>
    <div class="row timer">
      <label>Timebox (session only, never saved): <input id="timerMin" type="number" value="10" min="1" max="120"> min</label>
      <button id="timerBtn">Start</button><span id="timerOut" class="muted"></span>
    </div>
  </details>
  <footer id="stats" class="muted">Local models only · cost $0.00</footer>`;
