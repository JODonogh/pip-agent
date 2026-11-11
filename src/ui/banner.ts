/** Full artwork shared by the sidebar and beside-editor panel. */
export function bannerImage(src: string): string {
  return `<img class="bannerMark" src="${src}" alt="Agent PIP emblem" width="1792" height="2400">`;
}

export const SHORTCUTS_HTML = `<details class="shortcuts">
  <summary><span>Commands &amp; shortcuts</span><span class="summaryMeta">Cmd+Shift+L</span></summary>
  <ul>
    <li><strong>Explain in this sidebar</strong> — press <em>Select</em> at the top (no shortcut needed)</li>
    <li><strong>Explain beside the editor</strong> — select code, then <code>Cmd+Shift+L</code> (or right-click → PIP)</li>
    <li><strong>Command palette</strong> — click <code>&#9000;</code> in Settings below for all PIP commands</li>
  </ul>
</details>`;


const CONTROL_HELP: Record<string, string> = {
  explainBtn: 'Explain the code currently selected in the editor.',
  markBtn: 'Keep this idea in Review so you can practise recalling it later.',
  aiBtn: 'Open or close the AI Lab micro-lesson studio.',
  pipAiLabCloseBtn: 'Collapse the AI Lab drawer.',
  pipStartBtn: 'Start or stop a timebox for this session.',
  pipMuteBtn: 'Mute or unmute timebox completion and voice feedback sounds.',
  pipMusicBtn: 'Toggle gentle ambient focus audio during the session.',
  pipResetBtn: 'Stop the timebox and explain the captured selection again.',
  visualiseBtn: 'Build diagrams from the current editor selection.',
  loadCoverageBtn: 'Load a local coverage report to colour only branches backed by report evidence.',
  diagramAskBtn: 'Ask about the current diagram using its code and visible relationships.',
  divergeBtn: 'Explore different ways to solve the same problem and compare their trade-offs.',
  improveBtn: 'Find focused improvements, then challenge their claims against this code.',
  pocIdeasBtn: 'Propose a small experiment with a prediction and a result that could disprove it.',
  duckSubmitBtn: 'Check your explanation of the code against the available evidence.',
  solveBtn: 'Work through a possible cause and check your thinking.',
  solveDirectBtn: 'Get a direct, evidence-qualified answer and ways to test it.',
  clearSolverSelectionBtn: 'Remove the selected code from this solver problem.',
  solverCheckBtn: 'Check your answer against the question and available evidence.',
  summariseDayBtn: 'Make recall hints from the ideas you kept today.',
  ideaHelpSubmit: 'Ask a follow-up about this idea, its evidence, or another approach.',
  ideaHelpClose: 'Close this idea discussion and return to the idea.',
  wordPopupClose: 'Close the concept explanation.',
};
const DIAGRAM_HELP: Record<string, string> = {
  dataFlow: 'Trace the inputs, transformations, and outputs visible in this excerpt.',
  sequence: 'Follow messages between call participants in source order; this is not a runtime trace.',
  dependencies: 'Inspect imports and call receivers referenced by this excerpt.',
  architecture: 'Inspect component and endpoint relationships visible in the supplied code.',
  testing: 'Explore inputs, actions, and outcomes to check when testing this code.',
  decisions: 'Inspect each decision outcome and any coverage report evidence.',
  circuit: 'View visible source relationships as a circuit-style wiring sketch.',
  wireframe: 'View source references as a spatial sketch.',
  growth: 'Compare illustrative growth rates; these curves are not measured timings.',
  cartesian: 'Inspect a code-based work estimate and its assumptions.',
  context: 'See the selected code in the context of its file.',
  security: 'Inspect security-relevant observations and the checks still needed.',
  llmPhysics: 'Glass box: attention scaling, KV growth, and local Ollama timings for this selection.',
};
const SECTION_HELP: Record<string, string> = {
  'With an analogy': 'Map this code to a familiar idea and see where the analogy stops helping.',
  Foundations: 'Learn the computer science, design, and testing principles this code illustrates, with a concrete example.',
  'Roots & history': 'Explore the origin of an idea used in this selection.',
  'Performance': 'Compare the performance costs and benefits of this implementation.',
  'Behind the Curtain': 'Inspect the explainer prompt, token budget, Ollama telemetry, and grounding hints for this answer.',
  'Verify it yourself': 'Choose a test, local API request, or database check to challenge your understanding.',
  Diagrams: 'Expand diagrams that are useful for the selected code.',
  'Ask about this diagram': 'Ask a follow-up about the current view and its source evidence.',
  'Lateral Thinking & SCAMPER': 'Try a different perspective, a metaphor, subtraction, or a reversed assumption.',
  'Kept ideas': 'Review the ideas you explicitly chose to keep.',
  'Review & drill': 'Practise recalling a kept idea in your own words.',
  "Today's Summary": 'Review recall hints from ideas kept during this session.',
  'Why this suggestion?': 'Inspect the observed clues, their sources, and what remains unknown.',
};
function withControlHelp(markup: string): string {
  const safe = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return markup.replace(/<(button|summary)\b([^>]*)>([\s\S]*?)<\/\1>/g, (whole, tag: string, attrs: string, body: string) => {
    if (tag === 'summary') return whole; // expandable sections carry no tooltip
    if (tag === 'button') {
      // Only icon-only buttons need a tooltip; a visible text label already says what the button does.
      const visible = body.replace(/<[^>]*>/g, '').replace(/&[#\w]+;/g, '');
      if (/[A-Za-z]/.test(visible)) return `<button${attrs.replace(/\s*\btitle="[^"]*"/, '')}>${body}</button>`;
    }
    if (/\btitle=/.test(attrs)) {
      const title = /\btitle="([^"]+)"/.exec(attrs)?.[1] || '';
      return tag === 'button' && !/aria-label=/.test(attrs) && /class="[^"]*(?:iconBtn|pip-icon-btn)/.test(attrs)
        ? `<${tag} aria-label="${title}"${attrs}>${body}</${tag}>` : whole;
    }
    const id = /\bid="([^"]+)"/.exec(attrs)?.[1];
    const type = /\bdata-type="([^"]+)"/.exec(attrs)?.[1];
    const mode = /\bdata-mode="([^"]+)"/.exec(attrs)?.[1];
    const lens = /\bdata-lens="([^"]+)"/.exec(attrs)?.[1];
    const label = body.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    const heading = body.match(/<span>([^<]+)<\/span>/)?.[1]?.replace(/&amp;/g, '&') || label;
    const help = id && CONTROL_HELP[id] || type && DIAGRAM_HELP[type] || mode && `Open ${label} to ${({ learn: 'understand selected code', visualise: 'explore diagrams', create: 'investigate improvements and experiments', solve: 'check a problem and your understanding', review: 'practise kept ideas' } as Record<string, string>)[mode] || 'explore this workspace'}.` ||
      lens && ({ Metaphor: 'Map code to one familiar domain, then return to a concrete code question.', Subtraction: 'Remove one step mentally and check what would change.', Reverse: 'Reverse one assumption and test what the reversal reveals.' } as Record<string, string>)[lens] ||
      tag === 'summary' && (SECTION_HELP[heading] || `Expand ${heading} to inspect the explanation.`) || `Apply ${label} to the current code or idea.`;
    return `<${tag} title="${safe(help)}"${attrs}>${body}</${tag}>`;
  });
}

export const LEARN_BODY = withControlHelp(`
  <section class="cnvs-control-deck" aria-label="Primary actions and timebox">
    <div class="topGrid">
      <button id="explainBtn">Select</button>
      <button id="markBtn" title="Keep this idea in Review so you can practise it later">Keep</button>
      <button id="aiBtn" type="button" aria-expanded="false" aria-controls="pipAiLab">AI</button>
    </div>
    <div class="pip-toolbar-row">
      <span class="pip-toolbar-label">Timebox</span>
      <input type="number" id="pipTimeboxInput" class="pip-input-compact" value="10" min="1" max="60" aria-label="Minutes" />
      <button id="pipStartBtn" class="pip-btn pip-btn-sm" type="button">Start</button>
      <span id="timerOut" class="pip-toolbar-status muted" role="status" aria-live="polite"></span>
      <div class="pip-toolbar-actions">
        <button id="pipMuteBtn" class="pip-icon-btn" type="button" aria-label="Voice">Mute</button>
        <button id="pipMusicBtn" class="pip-icon-btn" type="button" aria-label="Audio">Audio</button>
        <button id="pipResetBtn" class="pip-icon-btn" type="button" aria-label="Reset">Reset</button>
      </div>
    </div>
  </section>

  <div class="pip-ai-lab-container" id="pipAiLab" hidden>
    <div class="pip-ai-lab-header">
      <span class="pip-ai-lab-title">Model Observability &amp; Architecture Lab</span>
      <div class="pip-ai-lab-controls">
        <select id="pipModelSelector" class="pip-select-compact" title="Active Model">
          <option value="">Loading models...</option>
        </select>
        <button id="pipAiLabCloseBtn" class="pip-btn pip-btn-sm" type="button">Collapse</button>
      </div>
    </div>

    <div id="pipTelemetryBar" class="pip-telemetry-bar">
      <div class="pip-stat"><span class="pip-stat-label">Throughput:</span> <span id="pipStatTps">-- tok/s</span></div>
      <div class="pip-stat"><span class="pip-stat-label">Latency:</span> <span id="pipStatLatency">-- ms</span></div>
      <div class="pip-stat"><span class="pip-stat-label">Eval Tokens:</span> <span id="pipStatTokens">--</span></div>
      <div class="pip-stat"><span class="pip-stat-label">Prompt Tokens:</span> <span id="pipStatPrompt">--</span></div>
    </div>

    <div class="pip-probe-row">
      <select id="pipProbeSelect" class="pip-select">
        <option value="scale_negative">Parameter Scaling: Negative Constraint Leaks (1.5B vs 14B)</option>
        <option value="test_time_compute">Test-Time Compute: Raw Reasoning Trace</option>
        <option value="synthetic_vs_web">Pre-Training Bias: Synthetic (Phi-4) vs Web Scrape (Llama 3.1)</option>
        <option value="attention_temperature">Sampling Entropy: Temperature &amp; Top-P on AST Stability</option>
        <option value="custom">Custom Probe</option>
      </select>
      <button id="pipRunProbeBtn" class="pip-btn pip-btn-accent" type="button">Run Probe</button>
    </div>

    <div class="pip-custom-probe-row" id="pipCustomProbeRow" hidden>
      <textarea id="pipCustomPrompt" class="pip-textarea" rows="2" placeholder="Custom test prompt to evaluate model behavior..."></textarea>
    </div>

    <div id="pipLabResult" class="pip-lab-result" hidden>
      <div class="pip-tab-bar">
        <button id="pipTabFormatted" class="pip-tab active" type="button">Analysis</button>
        <button id="pipTabRaw" class="pip-tab" type="button">Raw Output &amp; Reasoning Tokens</button>
      </div>
      <div id="pipContentFormatted" class="pip-tab-content"></div>
      <pre id="pipContentRaw" class="pip-tab-content" hidden></pre>
    </div>
  </div>

  <nav class="a2uiBar" role="tablist" aria-label="Workspace mode">
    <button class="a2uiBtn isActive" data-mode="solve">Solve</button>
    <button class="a2uiBtn" data-mode="learn">Learn</button>
    <button class="a2uiBtn" data-mode="visualise">Visualise</button>
    <button class="a2uiBtn" data-mode="create">Ideate</button>
    <button class="a2uiBtn" data-mode="review">Review</button>
  </nav>

  <!-- ==================== LEARN MODE ==================== -->
  <div data-section="learn" class="cnvs-shell">
    <section class="cnvs-card">
      <div id="hint" class="hint hidden"></div>
      <div id="result"><div class="cnvs-empty-state">Select code in the editor and press <strong>Select</strong>, or switch to <strong>Ideate</strong> to improve the codebase.</div></div>
      <section class="cnvs-card cnvs-card-inset" id="testMapBlock" hidden>
        <details id="testMapDetails">
          <summary><span>Test map</span><span class="summaryMeta">skim \u00b7 jump</span></summary>
          <div id="testMapBody" class="detailsBody"></div>
        </details>
      </section>
      <div id="deepDives"></div>
      <div id="lazyDeep">
        <details class="deepLazy" data-kind="analogy">
          <summary><span>With an analogy</span><span class="summaryMeta">mental hook</span></summary>
          <div class="deepBody muted">Prepared after you select code\u2026</div>
        </details>
        <details class="deepLazy" data-kind="foundations">
          <summary><span>Foundations</span><span class="summaryMeta">CS \u00b7 design \u00b7 testing</span></summary>
          <div class="deepBody muted">Prepared after you select code\u2026</div>
        </details>
        <details class="deepLazy" data-kind="roots">
          <summary><span>Roots &amp; history</span><span class="summaryMeta">origins</span></summary>
          <div class="deepBody muted">Prepared after you select code\u2026</div>
        </details>
        <details class="deepLazy" data-kind="Trade-off: Performance">
          <summary><span>Performance</span><span class="summaryMeta">cost &amp; speed</span></summary>
          <div class="deepBody muted">Prepared after you select code\u2026</div>
        </details>
        <details class="deepLazy" data-kind="glass-box" id="glassBoxDrawer">
          <summary><span>Behind the Curtain</span><span class="summaryMeta">telemetry &amp; prompt</span></summary>
          <div class="deepBody muted">Model telemetry and prompt anatomy appear after the overview.</div>
        </details>
      </div>
    </section>

    <section class="cnvs-card">
      <details id="verifyBlock">
        <summary><span>Verify it yourself</span><span class="summaryMeta">test \u00b7 API \u00b7 DB</span></summary>
        <div id="verifyBody" class="detailsBody"><span class="muted">Explain an endpoint or method and ways to prod it appear here.</span></div>
      </details>
    </section>
  </div>

  <!-- ==================== VISUALISE MODE ==================== -->
  <div data-section="visualise" class="cnvs-shell">
    <section class="cnvs-card cnvs-card-pad">
      <div class="visualiseActions"><button id="visualiseBtn" class="primaryActionBtn">Visualise selection</button><button id="loadCoverageBtn">Load coverage</button></div>
      <label for="diagramGoal">Goal or constraint (optional)</label>
      <input id="diagramGoal" type="text" maxlength="600" placeholder="Goal or constraint, e.g. avoid duplicate requests on expansion" title="Guide architectural discussion with a business goal or constraint. This does not change source extraction or establish measurements.">
      <p class="muted">Explore the selected code through different diagrams. Only relevant views are offered.</p>
    </section>
    <section class="cnvs-card">
      <details id="diagramBlock" open>
        <summary><span>Diagrams</span><span class="summaryMeta">views matched to this code</span></summary>
        <div class="detailsBody">
          <div class="diagramFamilies">
            <label>Flow<select class="diagramFamilySelect" disabled title="Choose a data flow, sequence or dependency view"><option value="">Choose a view</option><option value="dataFlow">Data flow</option><option value="sequence">Sequence</option><option value="dependencies">Dependencies</option></select></label>
            <label>Decisions<select class="diagramFamilySelect" disabled title="Choose a testing or decision view"><option value="">Choose a view</option><option value="testing">Testing flow</option><option value="decisions">Decisions</option><option value="growth">Performance growth</option><option value="cartesian">Code estimate</option></select></label>
            <label>Structure<select class="diagramFamilySelect" disabled title="Choose an architecture, structure or security view"><option value="">Choose a view</option><option value="architecture">Architecture</option><option value="circuit">Circuit</option><option value="wireframe">Wireframe</option><option value="context">File context</option><option value="security">Security</option></select></label>
          </div>
          <div class="row">
            <span hidden>
            <button class="diagramTypeBtn isActive" data-type="dataFlow">Data flow</button>
            <button class="diagramTypeBtn" data-type="sequence">Sequence</button>
            <button class="diagramTypeBtn" data-type="dependencies">Dependencies</button>
            <button class="diagramTypeBtn" data-type="architecture">Architecture</button>
            <button class="diagramTypeBtn" data-type="testing">Testing flow</button>
            <button class="diagramTypeBtn" data-type="decisions">Decisions</button>
            <button class="diagramTypeBtn" data-type="circuit">Circuit</button>
            <button class="diagramTypeBtn" data-type="wireframe">Wireframe</button>
            <button class="diagramTypeBtn" data-type="growth">Performance growth</button>
            <button class="diagramTypeBtn" data-type="cartesian">Code estimate</button>
            <button class="diagramTypeBtn" data-type="context">File context</button>
            <button class="diagramTypeBtn" data-type="security">Security</button>
            <button class="diagramTypeBtn" data-type="llmPhysics">LLM physics</button>
            </span>
            <span class="zoomGroup">
              <button id="zoomOutBtn" class="iconBtn" title="Zoom out">\u2212</button>
              <span id="zoomLabel" class="muted">100%</span>
              <button id="zoomInBtn" class="iconBtn" title="Zoom in">+</button>
              <button id="expandDiagramBtn" class="iconBtn" title="Pop out full-size diagram beside editor">&#10530;</button>
            </span>
          </div>
          <div class="row layers">
            <label><input type="checkbox" class="layerToggle" data-layer="calls" checked> calls</label>
            <label><input type="checkbox" class="layerToggle" data-layer="imports"> imports</label>
            <label><input type="checkbox" class="layerToggle" data-layer="params" checked> params</label>
            <label><input type="checkbox" class="layerToggle" data-layer="hooks" checked> hooks/state</label>
            <label><input type="checkbox" class="layerToggle" data-layer="tokens" checked> tokens</label>
          </div>
          <p id="diagramSelection" class="muted" role="status">No diagram yet. Select code, then press Visualise selection.</p>
          <div id="diagram" class="diagramStage"><span class="muted">Select code to render an excerpt sketch. Click any node for a one-line popup.</span></div>
          <details class="diagramDiscussion">
            <summary>Ask about this diagram</summary>
            <label for="diagramQuestion">What would you like to understand?</label>
            <textarea id="diagramQuestion" rows="2" placeholder="For example: what does this line represent?"></textarea>
            <button id="diagramAskBtn" type="button">Ask PIP</button>
            <div id="diagramAnswer" role="status" aria-live="polite"></div>
          </details>
          <div class="row">
            <button id="walkPlayBtn" title="Walk the flow step by step">&#9654; Walk</button>
            <button id="walkPrevBtn" class="iconBtn" title="Previous step">&#8592;</button>
            <button id="walkNextBtn" class="iconBtn" title="Next step">&#8594;</button>
            <span id="walkCaption" class="muted"></span>
          </div>
        </div>
      </details>
    </section>
  </div>

  <!-- ==================== IDEATE MODE ==================== -->
  <div data-section="create" class="cnvs-shell">
    <section class="cnvs-card cnvs-card-pad">
      <div class="ideateHeader"><strong>Your idea first</strong><span class="summaryMeta">PIP questions it; it never answers it</span></div>
      <p id="ideaContext" class="muted"></p>
      <ul class="muted ideaSparks"><li>What would you remove?</li><li>What breaks if this runs 100&times; more often?</li><li>Who calls this, and what do they assume?</li><li>What would you check first if it failed tonight?</li></ul>
      <textarea id="ideaOwn" rows="3" placeholder="Write your own idea or hunch in a sentence or two…"></textarea>
      <div class="row"><button id="ideaChallengeBtn" class="primaryActionBtn" type="button">Challenge my idea</button></div>
      <div id="ideaChallengeOut" role="status" aria-live="polite"></div>
    </section>
    <details id="ideaSpoilers" class="cnvs-card">
      <summary><span>Ready-made suggestions</span><span class="summaryMeta">answers, not exercises</span></summary>
    <section class="cnvs-card cnvs-card-pad">
      <div class="ideateHeader">
        <strong>Improve</strong>
      </div>
      <div class="row">
        <button class="improveLensBtn isActive" data-lens="All">All lenses</button>
        <button class="improveLensBtn" data-lens="Architecture">Architecture</button>
        <button class="improveLensBtn" data-lens="Performance">Performance</button>
        <button class="improveLensBtn" data-lens="DX & Testing">DX &amp; Tests</button>
      </div>
      <div class="row">
        <button id="improveBtn" class="primaryActionBtn">Spot improvements</button>
      </div>
      <div id="improveResult"></div>
    </section>

    <section class="cnvs-card cnvs-card-pad">
      <div class="ideateHeader">
        <strong>Experiments</strong>
        <span class="summaryMeta">small trials \u00b7 measurable outcomes</span>
      </div>
      <input id="pocSeedInput" type="text" placeholder="What problem or uncertainty do you want to test?">
      <div class="row">
        <button id="pocIdeasBtn" class="primaryActionBtn">Propose experiments</button>
      </div>
      <div id="pocResult"></div>
      <div id="pocBlueprintOut"></div>
    </section>

    <section class="cnvs-card">
      <details id="innovatorBlock">
        <summary><span>Lateral Thinking &amp; SCAMPER</span><span class="summaryMeta">explore \u00b7 challenge \u00b7 learn</span></summary>
        <div class="detailsBody">
          <div class="ideationActions">
            <button id="divergeBtn">Diverge</button>
            <button class="scamperBtn" data-lens="Metaphor">Metaphor</button>
            <button class="scamperBtn" data-lens="Subtraction">Subtract</button>
            <button class="scamperBtn" data-lens="Reverse">Reverse</button>
          </div>
          <div id="innovatorResult"></div>
        </div>
      </details>
    </section>
  </details>
  </div>

  <!-- ==================== SOLVE MODE ==================== -->
  <div data-section="solve" class="cnvs-shell">
    <section class="cnvs-card cnvs-card-pad chatShell">
      <div id="semanticStatus" class="muted"></div>
      <div id="chatLog" class="chatLog" role="log" aria-live="polite"></div>
      <div class="chatBox">
        <label for="chatInput" class="chatQuestionLabel">Question</label>
        <textarea id="chatInput" rows="2" aria-label="Question" placeholder="Ask about the failure, a Pair suggestion, or how to run a check…"></textarea>
        <div class="chatBar">
          <div class="chatBarStart">
            <button id="chatClearBtn" class="iconBtn chatRound" type="button" title="New chat" aria-label="New chat">+</button>
            <button id="chatSendBtn" class="iconBtn chatRound chatSendArrow" type="button" title="Send" aria-label="Send">&#8593;</button>
          </div>
          <div class="chatBarEnd">
            <span id="chatModePair" class="chatModeLabel isActive">Pair</span>
            <button id="chatModeSwitch" class="pipSwitch" type="button" role="switch" aria-checked="false" aria-label="Answer mode" ><span class="pipSwitchThumb"></span></button>
            <span id="chatModeVibe" class="chatModeLabel">Answer</span>
          </div>
        </div>
        <div class="chatDebugRow">
          <button id="chatModeDebugBtn" type="button" class="chatModeChip">Debug trace</button>
          <span id="chatDebugControls" class="chatDebugControls hidden" aria-hidden="true">
            <span class="muted">Temperature</span>
            <button type="button" class="chatTempBtn" id="chatTempLow" data-temp="0.1">0.1</button>
            <button type="button" class="chatTempBtn" id="chatTempHigh" data-temp="0.7">0.7</button>
          </span>
        </div>
      </div>
      <div class="row chatFlow"><span class="muted">Explore further:</span><button id="chatOpenLearnBtn" type="button">Learn</button><button id="chatVisualiseBtn" type="button" title="Diagram the code you selected">Visualise</button><button id="chatIdeateBtn" type="button" title="Write your own idea and have it challenged">Ideate</button><button id="chatReviewBtn" type="button" title="Keep this answer and open Review">Review</button><button id="chatHandoffBtn" type="button">Hand off</button></div>
      <details id="cursorPasteBlock" class="cursorPaste qaBlock">
        <summary>Question &amp; Answer</summary>
        <div class="detailsBody cursorPasteBody">
          <label for="cursorPasteExcerpt">Context</label>
          <textarea id="cursorPasteExcerpt" rows="4" placeholder="Optional: paste code or notes to anchor Learn, Visualise, and follow-ups…"></textarea>
          <div id="cursorPasteStatus" class="muted" role="status" aria-live="polite"></div>
        </div>
      </details>
    </section>

    <div class="hidden" aria-hidden="true">
    <section class="cnvs-card">
      <details id="solverBlock">
        <summary><span>Pair Solver</span><span class="summaryMeta">hypothesis \u2192 fastest check</span></summary>
        <div class="detailsBody">
          <div id="solverSelectionInfo" class="muted" role="status">No code selected. In Solve, select code and press Select to include it.</div>
          <button id="clearSolverSelectionBtn" class="hiddenBtn">Remove selected code</button>
          <input id="solverProblem" type="text" placeholder="Problem: what is broken or puzzling?">
          <textarea id="solverError" rows="3" placeholder="Optional: paste an error / stack trace / log lines\u2026"></textarea>
          <div class="solverTraceRow">
            <label class="solverTraceToggle"><input id="solverTraceToggle" type="checkbox"> Reasoning trace (reasoning model)</label>
            <span id="solverTraceControls" class="solverTraceControls hidden" aria-hidden="true">
              <button type="button" class="chatTempBtn solverTempBtn" data-temp="0.1" id="solverTempLow">T=0.1</button>
              <button type="button" class="chatTempBtn solverTempBtn" data-temp="0.7" id="solverTempHigh">T=0.7</button>
            </span>
          </div>
          <div class="row">
            <button id="solveBtn">Solve with me</button>
            <button id="solveDirectBtn">Give me an answer</button>
            <button id="solveNextBtn" class="hiddenBtn" title="That check did not work \u2014 next hypothesis">Didn't work \u2014 next</button>
            <button id="solveFixedBtn" class="hiddenBtn" title="Close this problem">Fixed it</button>
          </div>
          <div id="solverResult" aria-live="polite"></div>
          <div id="solverQuestionBox" hidden>
            <label for="solverAnswer">Your answer to the question</label>
            <textarea id="solverAnswer" rows="2" placeholder="Explain what you think, or paste what you found…"></textarea>
            <button id="solverCheckBtn">Check my answer</button>
            <div id="solverCheckResult" role="status" aria-live="polite"></div>
          </div>
        </div>
      </details>
    </section>
    </div>
  </div>

  <!-- ==================== REVIEW MODE ==================== -->
  <div data-section="review" class="cnvs-shell">
    <section class="cnvs-card">
      <details id="ledgerBlock" open>
        <summary><span>Kept ideas</span><span class="summaryMeta">read-only here</span></summary>
        <div class="detailsBody">
          <p class="muted">Ideas you pressed Keep on, saved in this editor and not the repo. Practise or remove them from the PIP sidebar.</p>
          <div id="ledger"><span class="muted">Nothing kept yet. Press Keep on an explanation to save it.</span></div>
        </div>
      </details>

      <details id="cardsBlock" open>
        <summary><span>Review &amp; drill</span><span class="summaryMeta">only what you keep</span></summary>
        <div class="detailsBody">
          <p class="muted" id="reviewIntro">Nothing is added automatically: press <strong>Keep</strong> on an explanation, probe, or prompt quirk to save that idea here. Open a card to practise it with a question you answer in your own words, a quiz, or a fill-in-the-blank. Ideas you miss come first; ideas you recall twice are marked solid. Use ✕ to remove a card. Filter by <strong>Data &amp; persistence</strong>, <strong>UI &amp; human interface</strong>, <strong>Backend &amp; communication</strong>, or <strong>AI &amp; Inference</strong> to choose what to practise.</p>
          <div id="drill"></div>
          <div id="undoBar" class="hint hidden" role="status"></div>
          <div id="cards"></div>
        </div>
      </details>

      <details id="todayBlock">
        <summary><span>Today's Summary</span><span class="summaryMeta">next-day recall hints</span></summary>
        <div class="detailsBody">
          <div id="todayBody"><span class="muted">Keep ideas during the day; summarise them here tonight, meet them again tomorrow.</span></div>
          <div class="row"><button id="summariseDayBtn">Summarise my day</button></div>
          <div id="reviewCard"></div>
        </div>
      </details>
    </section>
  </div>

  <div id="ideaHelpDialog" class="ideaHelpDialog hidden" role="dialog" aria-modal="true" aria-labelledby="ideaHelpTitle">
    <div class="wordPopupHead"><strong id="ideaHelpTitle"></strong><button id="ideaHelpClose" type="button" aria-label="Close idea discussion">\u00d7</button></div>
    <div id="ideaHelpAnswer" class="ideaHelpAnswer" role="status" aria-live="polite"></div>
    <label for="ideaHelpQuestion">Your question</label>
    <textarea id="ideaHelpQuestion" rows="3" placeholder="Ask about the evidence, trade-offs, or alternatives\u2026"></textarea>
    <button id="ideaHelpSubmit" type="button">Ask</button>
  </div>

  <!-- ==================== DISPOSABLE WORD POPUP ==================== -->
  <div id="wordPopup" class="wordPopup hidden">
    <div class="wordPopupHead"><button id="wordPopupBack" type="button" title="Back to the overview (closes this popup)" aria-label="Back to overview">\u2190 Overview</button><strong id="wordPopupTitle"></strong><button id="wordPopupClose" title="Close the concept explanation" aria-label="Close the concept explanation">\u00d7</button></div>
    <nav id="wordPopupCrumbs" class="wordPopupCrumbs" aria-label="Exploration trail"></nav>
    <div id="wordPopupBody"></div>
    <input id="wordPopupInput" type="text" placeholder="Ask a follow-up \u2014 one-line answer\u2026 (Enter)">
  </div>

  <!-- ==================== PREFERENCES & TELEMETRY FOOTER ==================== -->
  <section id="moreDrawer" class="cnvs-card cnvs-card-pad hidden" aria-label="Voice and learning mode">
    <div class="row">
      <label for="voiceSelect">Read aloud voice</label>
      <select id="voiceSelect" title="Natural human voice for Read aloud"></select>
      <label for="learnMode">Learning mode</label>
      <select id="learnMode" title="Learning mode: switch when tired">
        <option value="visual">Visual mode</option>
        <option value="auditory">Auditory mode</option>
      </select>
    </div>
  </section>

  <footer class="cnvs-footer">
    <span id="stats" class="muted">Local models only \u00b7 cost $0.00</span>
    <div class="footerControls">
      <button id="voiceModeBtn" class="iconBtn" title="Voice &amp; Mode" aria-label="Voice and mode" aria-expanded="false" aria-controls="moreDrawer">&#9881;</button>
      <button id="helpBtn" class="iconBtn" title="Commands &amp; shortcuts" aria-label="Commands and shortcuts">&#9000;</button>
      <button id="collapseAllBtn" class="iconBtn" title="Collapse all open sections" aria-label="Collapse all">&#8963;</button>
    </div>
  </footer>`);
