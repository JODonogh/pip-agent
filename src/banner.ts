/**
 * Original monochrome geometric mark, in the spirit of Lissitzky / Malevich:
 * a tall vertical composition — wedge, overlapping circle, perpendicular bars.
 * Theme-aware via currentColor. Not a copy of any artwork.
 */
export const BANNER_SVG = `<svg class="bannerMark" viewBox="0 0 200 170" aria-hidden="true">
  <circle cx="70" cy="58" r="40" fill="none" stroke="currentColor" stroke-width="5" opacity="0.55"/>
  <circle cx="70" cy="58" r="16" fill="currentColor" opacity="0.3"/>
  <polygon points="96,164 158,44 188,164" fill="currentColor" opacity="0.9"/>
  <rect x="18" y="112" width="42" height="42" fill="currentColor" opacity="0.4"/>
  <polygon points="8,22 192,132 184,146 2,34" fill="currentColor" opacity="0.75"/>
  <rect x="142" y="8" width="8" height="84" fill="currentColor"/>
  <rect x="160" y="8" width="8" height="84" fill="currentColor" opacity="0.45"/>
  <polygon points="30,164 74,96 104,164" fill="currentColor" opacity="0.6"/>
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
  <div class="topGrid">
    <button id="explainBtn">Explain</button>
    <button id="markBtn">Mark</button>
    <button id="speakBtn">Read</button>
  </div>
  <div class="row timer">
    <label>Timebox <input id="timerMin" type="number" value="10" min="1" max="120" title="Minutes (session only, never saved)"></label>
    <button id="timerBtn">Start</button><span id="timerOut" class="muted"></span>
  </div>
  <div class="row styleRow">
    <button class="styleChip isActive" data-style="plain" title="Plain, direct explanation">Plain</button>
    <button class="styleChip" data-style="analogy" title="Inventive analogy first, then the plain truth">Analogy</button>
    <button class="styleChip" data-style="foundations" title="Structured theory: data structures, Big O, maths">Foundations</button>
    <select id="learnMode" title="Learning mode: switch when tired">
      <option value="visual">Visual mode</option>
      <option value="auditory">Auditory mode</option>
    </select>
  </div>

  <section class="duckBox">
    <input id="duckInput" type="text" placeholder="Rubber-duck it here — say what you think this code does… (Enter)">
    <div id="duckLog"></div>
  </section>

  <section id="hint" class="hint hidden"></section>
  <section id="result"></section>
  <div id="deepDives"></div>
  <div class="row deepRow">
    <button id="foundationsBtn" title="Data structures, Big O, the maths underneath">Foundations</button>
    <button id="rootsBtn" title="History: where this idea came from">Roots</button>
    <button id="pseudoBtn" title="The same logic as pseudocode">Pseudocode</button>
    <button class="tradeBtn" data-trade="Performance">Trade-off: Performance</button>
    <button class="tradeBtn" data-trade="Readability">Trade-off: Readability</button>
    <button class="tradeBtn" data-trade="Security">Trade-off: Security</button>
  </div>

  <details class="block" id="verifyBlock">
    <summary><strong>Verify it yourself</strong> <span class="muted">— test, API (Bruno-style), DB</span></summary>
    <div id="verifyBody"><span class="muted">Explain an endpoint or method and ways to prod it appear here.</span></div>
  </details>

  <details class="block" id="diagramBlock">
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
    <div class="row">
      <button id="walkPlayBtn" title="Walk the flow step by step">&#9654; Walk</button>
      <button id="walkPrevBtn" class="iconBtn" title="Previous step">&#8592;</button>
      <button id="walkNextBtn" class="iconBtn" title="Next step">&#8594;</button>
      <span id="walkCaption" class="muted"></span>
    </div>
  </details>

  <details class="block" id="innovatorBlock">
    <summary><strong>Innovator</strong> <span class="muted">— diverge, randomise, converge (SCAMPER)</span></summary>
    <div class="row">
      <button id="divergeBtn">Diverge: 4 approaches</button>
      <button id="randomiseBtn" title="Shuffle approaches and roll a random SCAMPER lens">Randomise</button>
    </div>
    <div class="row">
      <button class="scamperBtn" data-lens="Metaphor Mixer">Metaphor Mixer</button>
      <button class="scamperBtn" data-lens="Subtraction Dare">Subtraction Dare</button>
      <button class="scamperBtn" data-lens="Reverse It">Reverse It</button>
    </div>
    <div id="innovatorResult"></div>
  </details>

  <details class="block" id="todayBlock">
    <summary><strong>Today</strong> <span class="muted">— what you marked, summarised</span></summary>
    <div id="todayBody"><span class="muted">Mark concepts during the day; summarise them here tonight, meet them again tomorrow.</span></div>
    <div class="row"><button id="summariseDayBtn">Summarise my day</button></div>
    <div id="reviewCard"></div>
  </details>

  <details class="block" id="solverBlock">
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
  <footer id="stats" class="muted">Local models only · cost $0.00</footer>
  <div class="bottomBar">
    <button id="collapseAllBtn" class="iconBtn" title="Collapse everything" aria-label="Collapse everything">&#8963;</button>
  </div>`;
