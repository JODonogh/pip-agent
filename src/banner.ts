/**
 * Original monochrome geometric mark, loosely in the spirit of Lissitzky /
 * Malevich: a triangular wedge, a circle, perpendicular bars, one solid square.
 * Theme-aware via currentColor. Not a copy of any artwork.
 */
export const BANNER_SVG = `<svg class="bannerMark" viewBox="0 0 132 44" aria-hidden="true">
  <g fill="none" stroke="currentColor" stroke-width="2">
    <path d="M6 38 L34 8 L48 38 Z"/>
    <circle cx="74" cy="23" r="13"/>
    <path d="M102 5 L102 39 M116 5 L116 39"/>
  </g>
  <rect x="57" y="31" width="9" height="9" fill="currentColor"/>
</svg>`;

export const SHORTCUTS_HTML = `<details class="shortcuts">
  <summary>Commands &amp; shortcuts</summary>
  <ul>
    <li><strong>Explain selection in the side</strong> — click <em>Explain</em> above (no shortcut needed)</li>
    <li><strong>Explain beside the editor</strong> — select code, then <code>Cmd+Shift+L</code> (or right-click → PIP)</li>
    <li><strong>Shortcuts list</strong> — click <em>Shortcuts</em> above for a clickable command list</li>
    <li><strong>Close the beside panel</strong> — <code>Esc</code> focus / close tab; it is disposable</li>
  </ul>
</details>`;

export const LEARN_BODY = `
  <div id="where" class="muted">Select code in the editor, then press Explain.</div>
  <div class="row">
    <button id="explainBtn">Explain selection</button>
    <button id="reexplainBtn">Re-explain</button>
    <button id="openBesideBtn">Open beside</button>
    <button id="helpBtn">Shortcuts</button>
  </div>
  <div class="row">
    <button id="markBtn">Mark concept</button>
    <button id="speakBtn">Read aloud</button>
    <select id="voiceSelect" title="Voice"></select>
  </div>
  <div class="row timer">
    <label>Timebox (session only, never saved): <input id="timerMin" type="number" value="10" min="1" max="120"> min</label>
    <button id="timerBtn">Start</button><span id="timerOut" class="muted"></span>
  </div>
  <section id="hint" class="hint hidden"></section>
  <section id="status" class="muted"></section>
  <section id="result"></section>
  <div id="trail" class="muted"></div>

  <section class="block">
    <h3>Diagram — turn layers on/off</h3>
    <div class="row layers">
      <label><input type="checkbox" class="layerToggle" data-layer="calls" checked> calls</label>
      <label><input type="checkbox" class="layerToggle" data-layer="imports" checked> imports</label>
      <label><input type="checkbox" class="layerToggle" data-layer="params" checked> params</label>
      <label><input type="checkbox" class="layerToggle" data-layer="hooks" checked> hooks/state</label>
    </div>
    <div id="diagram"><span class="muted">Explain something and its flow diagram appears here. Click a box to explain it.</span></div>
  </section>

  <section class="ask block">
    <input id="askInput" type="text" placeholder="Quick-fire question, or tell the duck what you think…">
    <div class="row">
      <button id="quickBtn">Quick-fire (1 sentence)</button>
      <button id="duckBtn">Rubber-duck it</button>
    </div>
    <div id="askResult"></div>
  </section>
  <footer id="stats" class="muted">Local models only · cost $0.00</footer>`;
