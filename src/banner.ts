/**
 * Original monochrome geometric mark, in the spirit of Lissitzky / Malevich:
 * a tall vertical composition — wedge, overlapping circle, perpendicular bars.
 * Theme-aware via currentColor. Not a copy of any artwork.
 */
export const BANNER_SVG = `<svg class="bannerMark" viewBox="0 0 200 170" aria-hidden="true">
  <polygon points="30,150 118,14 142,14 66,150" fill="#2456a6"/>
  <polygon points="118,158 168,62 188,74 148,164" fill="#f2c230"/>
  <polygon points="8,66 26,52 196,128 186,150" fill="#d43a2f"/>
  <polygon points="18,14 28,10 188,158 178,164" fill="currentColor"/>
  <polygon points="136,8 148,6 52,162 42,158" fill="currentColor"/>
  <polygon points="82,92 112,44 128,52 102,104" fill="#7fb2d9"/>
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
    <label>Timebox <input id="timerMin" type="number" value="10" min="1" max="120" title="Minutes (session only, never saved)"> min</label>
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

  <details class="block" id="solverBlock" open>
    <summary><strong>Solver</strong> <span class="muted">— work a bug together, one check at a time</span></summary>
    <input id="solverProblem" type="text" placeholder="Problem: what is broken or puzzling?">
    <textarea id="solverError" rows="3" placeholder="Optional: paste an error / stack trace / log lines…"></textarea>
    <div class="row">
      <button id="solveBtn">Solve with me</button>
      <button id="solveNextBtn" class="hiddenBtn" title="That check did not work — next hypothesis">Didn't work — next</button>
      <button id="solveFixedBtn" class="hiddenBtn" title="Close this problem">Fixed it</button>
    </div>
    <div id="solverResult"></div>
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
