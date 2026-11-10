/* Learn UI. Word click = small popup (one-line answers). Nothing replaces
   the original explanation. Diagrams have per-type layouts. */
const vscode = acquireVsCodeApi();
window.pipPost = (msg) => vscode.postMessage(msg);

let codeCtx = null;
let learningSessionId = null;
let current = { term: '', bottomLine: '' };
let keywordSet = new Set();
let diagrams = null;
let diagramType = 'dataFlow';
let diagramRequest = null;
let diagramSequence = 0;
let diagramHistory = [];
let visualisePinned = false;
let testOutline = null;
let popupWord = '';
let popupHistory = [];
let popupPending = '';
let popupScope = '';
let popupAnchor = { x: 8, y: 8 };
/* Breadcrumb trail: Overview > word1 > word2. Threads are kept per word so going
   back never re-asks the model and the overview underneath is never touched. */
let popupTrail = [];
let popupFirst = '';
const popupThreads = new Map();
let solverKeywords = new Set();
const initialSolverState = vscode.getState?.()?.solver || {};
let solverSelection = initialSolverState.selection || null;
let solverLastReply = initialSolverState.reply || null;
let solverResponseMode = initialSolverState.mode === 'direct' || initialSolverState.reply?.mode === 'direct' ? 'direct' : 'together';
let solverCheckId = 0;
let solverSelectionPending = false;
let activeMode = initialSolverState.activeMode || 'solve';
function saveSolverState() {
  vscode.setState?.({ ...(vscode.getState?.() || {}), solver: {
    problem: $('solverProblem')?.value || '', errorText: $('solverError')?.value || '',
    answer: $('solverAnswer')?.value || '', selection: solverSelection,
    reply: solverLastReply, mode: solverResponseMode, activeMode, open: !!$('solverBlock')?.open,
  } });
}
function renderSolverSelection() {
  const info = $('solverSelectionInfo');
  if (info) info.textContent = solverSelection ? `Selected: ${solverSelection.file}:${solverSelection.line} (${solverSelection.selection.length} characters)` : 'No code selected. In Solve, select code and press Select to include it.';
  if ($('clearSolverSelectionBtn')) $('clearSolverSelectionBtn').style.display = solverSelection ? 'inline-flex' : 'none';
}

let duckPending = null;
let duckSequence = 0;
let speaking = false;
let aiLabPending = false;
let timer = null;
let remaining = 0;

const $ = (id) => document.getElementById(id);
const on = (id, event, fn) => {
  const el = $(id);
  if (el) el.addEventListener(event, fn);
};
function norm(word) {
  return word.replace(/^[^\p{L}\p{N}@]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase();
}


/* Tooltips describe the action, including controls generated after model replies. */
function describeControl(element, description) {
  if (element.tagName?.toLowerCase() === 'summary') return element; // expandable sections carry no tooltip
  const label = String(element.textContent || '').replace(/\s+/g, ' ').trim();
  // A visible text label already says what a button does; only icon-only controls get a tooltip.
  if (!element.classList?.contains('iconBtn') && !element.classList?.contains('pip-icon-btn') && /[\p{L}]/u.test(label) && !description) return element;
  const descriptions = {
    Ask: 'Ask a follow-up about this idea and its supporting code.',
    'How to spot this': 'Learn the visible clue, alternative explanations, and a test you can reuse.',
    'Plan experiment': 'Turn this hypothesis into a small trial with a rejection criterion.',
    Keep: 'Keep this idea for later recall practice.',
    'Converge on this': 'Compare the costs and assumptions of this approach before choosing it.',
    'Evidence and challenge': 'Inspect the quoted clue, objection, and check still needed.',
    'Why this suggestion?': 'Inspect the clues, their sources, and what remains uncertain.',
    'Generate a test skeleton': 'Create a test outline to fill in and run against this code.',
    'Send request': 'Send this API request to the local address shown above.',
  };
  const help = description || element.title || element.getAttribute?.('data-pip-tooltip') || descriptions[label] ||
    (element.tagName.toLowerCase() === 'summary' ? `Expand ${label} to explore this part of the explanation.` : `Use ${label} for the current code or idea.`);
  if (help) { if (element.hasAttribute?.('data-pip-tooltip')) element.setAttribute('data-pip-tooltip', help); else element.title = help; }
  if ((element.classList?.contains('iconBtn') || element.classList?.contains('pip-icon-btn') || !/[\p{L}]/u.test(label)) && !element.getAttribute?.('aria-label')) element.setAttribute('aria-label', help);
  return element;
}
function describeControls(root = document) {
  root.querySelectorAll('button, summary').forEach((element) => describeControl(element));
}

/* ---------- Word popup: disposable, one-line, follow-ups one-line ---------- */
function popupThreadText(thread) {
  const parts = [];
  if (thread && thread.first) parts.push(thread.first);
  for (const turn of (thread && thread.history) || []) {
    parts.push(`You: ${turn.question}`);
    parts.push(turn.answer);
  }
  return parts;
}
function renderCrumbs() {
  const crumbs = $('wordPopupCrumbs');
  if (!crumbs) return;
  crumbs.replaceChildren();
  const overview = document.createElement('button');
  overview.type = 'button';
  overview.textContent = 'Overview';
  overview.onclick = () => closePopup();
  crumbs.appendChild(overview);
  popupTrail.forEach((word) => {
    const sep = document.createTextNode(' › ');
    crumbs.appendChild(sep);
    const link = document.createElement('button');
    link.type = 'button';
    link.textContent = word;
    link.onclick = () => openPopup(word, popupAnchor.x, popupAnchor.y, (popupThreads.get(word) || {}).scope || popupScope);
    crumbs.appendChild(link);
  });
  if (popupWord) {
    crumbs.appendChild(document.createTextNode(' › '));
    const here = document.createElement('strong');
    here.textContent = popupWord;
    crumbs.appendChild(here);
  }
}
function renderPopupThread() {
  const body = $('wordPopupBody');
  if (!body) return;
  body.replaceChildren();
  const set = popupScope === 'solver' ? solverKeywords : keywordSet;
  for (const text of popupThreadText({ first: popupFirst, history: popupHistory })) {
    const row = document.createElement('p');
    if (text.startsWith('You: ')) row.textContent = text;
    else row.appendChild(rich(text, set, { scope: popupScope }));
    body.appendChild(row);
  }
  positionPopup();
}
function openPopup(word, x, y, scope = '') {
  // Keep the current thread before moving: going back restores it with no new model call.
  if (popupWord && popupWord !== word && !$('wordPopup').classList.contains('hidden')) {
    popupThreads.set(popupWord, { first: popupFirst, history: [...popupHistory], scope: popupScope });
    if (popupTrail[popupTrail.length - 1] !== popupWord) popupTrail.push(popupWord);
  }
  popupWord = word;
  popupPending = '';
  popupScope = scope;
  popupAnchor = { x, y };
  const popup = $('wordPopup');
  $('wordPopupTitle').textContent = word;
  const saved = popupThreads.get(word);
  renderCrumbs();
  popup.classList.remove('hidden');
  if (saved && (saved.first || (saved.history && saved.history.length))) {
    popupFirst = saved.first || '';
    popupHistory = [...(saved.history || [])];
    renderPopupThread();
  } else {
    popupFirst = '';
    popupHistory = [];
    $('wordPopupBody').textContent = 'Thinking locally…';
    positionPopup();
    vscode.postMessage({ type: 'popupExplain', word, scope });
  }
  $('wordPopupInput').focus();
}
function positionPopup() {
  const popup = $('wordPopup');
  const bounds = popup.getBoundingClientRect?.();
  const width = bounds?.width || Math.min(320, window.innerWidth - 16);
  const height = bounds?.height || 200;
  const viewportHeight = window.innerHeight || 720;
  popup.style.left = `${Math.max(8, Math.min(popupAnchor.x, window.innerWidth - width - 8))}px`;
  popup.style.top = `${Math.max(8, Math.min(popupAnchor.y + 8, viewportHeight - height - 8))}px`;
}
function closePopup() {
  $('wordPopup').classList.add('hidden');
}
on('wordPopupClose', 'click', closePopup);
on('wordPopupBack', 'click', closePopup);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closePopup(); closeIdeaHelp(); }
});
document.addEventListener('click', (e) => {
  const popup = $('wordPopup');
  if (!popup.classList.contains('hidden') && !popup.contains(e.target) && !e.target.classList?.contains('word')) {
    closePopup();
  }
});
on('wordPopupInput', 'keydown', (e) => {
  if (e.key === 'Enter' && e.target.value.trim()) {
    const question = e.target.value.trim();
    const row = document.createElement('p'); row.textContent = `You: ${question}`; $('wordPopupBody').appendChild(row);
    popupPending = question;
    vscode.postMessage({ type: 'popupAsk', word: popupWord, question, scope: popupScope, history: popupHistory.slice(-4) });
    e.target.value = '';
  }
});

/* ---------- Rich text: **bold**, *italic*, `code`; keywords only ---------- */
function wordNode(word, set, options = {}) {
  const clean = norm(word);
  const file = (options.files || []).find((item) => item.label === word);
  if (file) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inlineFile';
    button.textContent = word;
    button.title = `Open ${word}${file.line ? `:${file.line}` : ''} in the editor`;
    button.onclick = () => vscode.postMessage({ type: 'openSolverFile', id: file.id });
    return button;
  }
  // Filenames and paths are navigation targets, never terms to explain.
  if (/[\\/]|\.[a-z][\w-]*(?::\d+)?$/i.test(word)) return document.createTextNode(word);
  if (clean && set.has(clean)) {
    const span = document.createElement('button');
    span.type = 'button';
    span.className = 'word';
    span.textContent = word;
    span.title = 'One-line popup explanation';
    span.onclick = (e) => openPopup(word, e.clientX, e.clientY, options.scope);
    return span;
  }
  return document.createTextNode(word);
}
function rich(text, set, options = {}) {
  const frag = document.createDocumentFragment();
  const terms = [...new Set([...(options.files || []).map((file) => file.label), ...set])]
    .filter(Boolean).sort((a, b) => b.length - a.length);
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = terms.length ? new RegExp(`(${terms.map(escape).join('|')})`, 'gi') : null;
  const appendWords = (parent, value) => {
    const pieces = pattern ? value.split(pattern) : [value];
    let offset = 0;
    for (const piece of pieces) {
      const before = value[offset - 1] || '';
      const after = value[offset + piece.length] || '';
      // Avoid matching a term inside another identifier or a file/path.
      const continuesAfter = /[\p{L}\p{N}_/\\]/u.test(after) || (after === '.' && /[\p{L}\p{N}_]/u.test(value[offset + piece.length + 1] || ''));
      const boundary = !/[\p{L}\p{N}_./\\]/u.test(before) && !continuesAfter;
      parent.appendChild(boundary ? wordNode(piece, set, options) : document.createTextNode(piece));
      offset += piece.length;
    }
  };
  for (const part of String(text).split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*)/g)) {
    if (!part) continue;
    if (part.startsWith('`') && part.endsWith('`')) {
      const span = document.createElement('span');
      span.className = 'code';
      appendWords(span, part.slice(1, -1));
      frag.appendChild(span);
    } else if (part.startsWith('**')) {
      const strong = document.createElement('strong');
      strong.className = 'hl';
      appendWords(strong, part.slice(2, -2));
      frag.appendChild(strong);
    } else if (part.startsWith('*')) {
      const em = document.createElement('em');
      appendWords(em, part.slice(1, -1));
      frag.appendChild(em);
    } else {
      appendWords(frag, part);
    }
  }
  return frag;
}
function explanationBody(explanation, set) {
  const frag = document.createDocumentFragment();
  const bottom = document.createElement('div');
  bottom.className = 'bottomline';
  bottom.appendChild(rich(explanation.bottomLine, set));
  frag.appendChild(bottom);
  for (const chunk of explanation.chunks) {
    const tokens = (value) => new Set(String(value).toLowerCase().match(/[a-z]{4,}/g) || []);
    const a = tokens(explanation.bottomLine), b = tokens(chunk.body);
    if (a.size && b.size && [...a].filter(word => b.has(word)).length / Math.min(a.size, b.size) > 0.8) continue;
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = chunk.title;
    const body = document.createElement('div');
    body.appendChild(rich(chunk.body, set));
    details.append(summary, body);
    frag.appendChild(details);
  }
  return frag;
}

function renderExplanation(msg) {
  const set = new Set((msg.keywords || []).map((k) => String(k).toLowerCase()));
  keywordSet = set;
  current = {
    term: msg.term || msg.focus || '',
    bottomLine: msg.explanation.bottomLine,
  };
  if ($('hint')) {
    const reference = msg.learning?.reference || '';
    const line = /^(?:Nothing (?:stored|kept)|No (?:saved|kept|stored) (?:ideas|concepts|notes)|Select code)/i.test(reference.trim()) ? '' : reference;
    $('hint').classList.toggle('hidden', !line);
    if (line) $('hint').textContent = line;
  }
  const result = $('result');
  result.replaceChildren();
  result.appendChild(explanationBody(msg.explanation, set));
  // A review updates only the overview; prepared sections belong to this selection.
  if (!msg.reviewUpdate) resetDeepSections();
  if (msg.diagrams && !visualisePinned) {
    diagrams = msg.diagrams;
    walkIndex = -1;
    renderDiagram();
  }
  if (msg.verify) renderVerify(msg.verify);
  if (Object.prototype.hasOwnProperty.call(msg, 'testOutline')) renderTestOutline(msg.testOutline);
  // Auditory mode (tired eyes): read the bottom line automatically.
  if (!msg.reviewUpdate && $('learnMode')?.value === 'auditory' && current.bottomLine) {
    vscode.postMessage({ type: 'speak', text: current.bottomLine, voice: $('voiceSelect')?.value || '' });
  }
}

function deepSection(kind) {
  return [...document.querySelectorAll('.deepLazy[data-kind]')]
    .find((section) => section.getAttribute('data-kind') === kind);
}
function resetDeepSections() {
  document.querySelectorAll('.deepLazy[data-kind]').forEach((section) => {
    section.open = false;
    delete section.dataset.loaded;
    delete section.dataset.requested;
    const body = section.querySelector('.deepBody');
    if (body) {
      body.textContent = 'Queued while you read the overview…';
      body.classList.add('muted');
    }
  });
}
function renderReview(msg) {
  if (msg.status !== 'revised' || !msg.explanation) return;
  if (msg.explanation) {
    const result = $('result');
    const open = [...result.querySelectorAll('details')].map((details) => details.open);
    keywordSet = new Set((msg.keywords || []).map((term) => String(term).toLowerCase()));
    result.replaceChildren(explanationBody(msg.explanation, keywordSet));
    result.querySelectorAll('details').forEach((details, index) => { details.open = Boolean(open[index]); });
    current.bottomLine = msg.explanation.bottomLine;
  }
  const old = $('learningReviewNote');
  if (old) old.remove();
  const note = document.createElement('div');
  note.id = 'learningReviewNote';
  note.className = 'muted cnvs-card-pad';
  note.textContent = msg.text || (msg.status === 'revised' ? 'Updated after a separate source review.' : 'Source review completed; this does not replace running the code.');
  $('result').appendChild(note);
}

let verifyInfo = null;
function renderTestOutline(outline) {
  testOutline = outline || null;
  const block = $('testMapBlock');
  const host = $('testMapBody');
  if (!block || !host) return;
  if (!outline?.tests?.length) {
    block.hidden = true;
    host.replaceChildren();
    return;
  }
  block.hidden = false;
  const details = $('testMapDetails');
  if (details) details.open = outline.tests.length >= 3;
  host.replaceChildren();
  const note = document.createElement('p');
  note.className = 'muted testMapNote';
  note.textContent = outline.note;
  host.appendChild(note);
  if (outline.setup?.length) {
    const setup = document.createElement('p');
    setup.className = 'testMapSetup';
    setup.textContent = `Shared setup: ${outline.setup.map((entry) => `@BeforeEach ${entry.name}()`).join(' · ')}`;
    host.appendChild(setup);
  }
  const list = document.createElement('ul');
  list.className = 'testMapList';
  for (const test of outline.tests) {
    const item = document.createElement('li');
    item.className = 'testMapRow';
    const jump = describeControl(document.createElement('button'), 'Jump to this test in the editor.');
    jump.type = 'button';
    jump.className = 'testMapJump';
    jump.textContent = `${test.name} · L${test.line}`;
    jump.onclick = () => vscode.postMessage({ type: 'openEditorLine', file: outline.file, line: test.line });
    item.appendChild(jump);
    if (test.assertions?.length) {
      const asserts = document.createElement('ul');
      asserts.className = 'testMapAsserts';
      for (const assertion of test.assertions.slice(0, 3)) {
        const line = document.createElement('li');
        line.className = 'muted';
        line.textContent = assertion;
        asserts.appendChild(line);
      }
      item.appendChild(asserts);
    }
    list.appendChild(item);
  }
  host.appendChild(list);
}
function renderVerify(verify) {
  verifyInfo = verify;
  const host = $('verifyBody');
  if (!host) return;
  host.replaceChildren();
  if (verify.engagementLine) {
    const lead = document.createElement('p');
    lead.className = 'engagementLine';
    lead.textContent = verify.engagementLine;
    host.appendChild(lead);
  }
  if (verify.debugHint) {
    const debug = document.createElement('div');
    debug.textContent = verify.debugHint;
    host.appendChild(debug);
  }
  if (verify.http) {
    const line = document.createElement('div');
    line.innerHTML = '';
    const label = document.createElement('strong');
    label.textContent = `API (Bruno-style): ${verify.http.method} ${verify.http.path}`;
    const row = document.createElement('div');
    row.className = 'row';
    const base = document.createElement('input');
    base.type = 'text';
    base.id = 'brunoBase';
    base.value = 'http://localhost:8081';
    base.title = 'Local base URL (localhost only)';
    const send = document.createElement('button');
    send.textContent = 'Send request';
    send.onclick = () =>
      vscode.postMessage({ type: 'brunoSend', baseUrl: base.value, method: verify.http.method, path: verify.http.path });
    row.append(base, send);
    host.append(label, row);
  }
  if (verify.sqlHint) {
    const db = document.createElement('div');
    db.textContent = verify.sqlHint.startsWith('DB (DBeaver):') ? verify.sqlHint : `DB (DBeaver): ${verify.sqlHint}`;
    host.appendChild(db);
  }
  const testRow = document.createElement('div');
  testRow.className = 'row';
  const testBtn = document.createElement('button');
  testBtn.textContent = 'Generate a test skeleton';
  testBtn.onclick = () => vscode.postMessage({ type: 'genTest' });
  testRow.appendChild(testBtn);
  const out = document.createElement('pre');
  out.id = 'verifyOut';
  host.append(testRow, out);
}

/* ---------- Diagrams: a different layout per kind ---------- */
const KIND_RANK = { endpoint: 0, method: 1, param: 2, hook: 3, state: 3, branch: 4, call: 5, return: 7, assert: 7, import: 9 };
const LAYER_OF = { endpoint: 'core', method: 'core', return: 'core', branch: 'core', assert: 'core', call: 'calls', import: 'imports', param: 'params', hook: 'hooks', state: 'hooks' };
const SVGNS = 'http://www.w3.org/2000/svg';

function breakWord(word, maxChars) {
  if (word.length <= maxChars) return [word];
  const out = [];
  let current = '';
  for (const part of word.split(/(?<=[_.])|(?<=[a-z])(?=[A-Z])/)) {
    if (current && (current + part).length > maxChars) { out.push(current); current = ''; }
    current += part;
  }
  if (current) out.push(current);
  return out.flatMap((piece) => piece.match(new RegExp(`.{1,${maxChars}}`, 'gu')) || ['']);
}
function wrapDiagramLabel(label, maxChars) {
  const lines = [];
  let line = '';
  for (const word of String(label).split(/\s+/)) {
    const pieces = breakWord(word, maxChars);
    for (const piece of pieces) {
      if (line && line.length + piece.length + 1 > maxChars) { lines.push(line); line = ''; }
      line = line ? `${line} ${piece}` : piece;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}
function nodeMetrics(node, width) {
  const usable = node.kind === 'branch' ? width * 0.48 : width - 40;
  const lines = wrapDiagramLabel(node.label, Math.max(8, Math.floor(usable / 8.5)));
  const contentHeight = 24 + lines.length * 17;
  const height = node.kind === 'branch' ? contentHeight * 2 + 18 : contentHeight + 24;
  return { lines, height, contentHeight };
}
function shapeFor(g, node, cx, cy, width, height) {
  if (node.kind === 'branch' || node.kind === 'call') {
    const polygon = document.createElementNS(SVGNS, 'polygon');
    const points = node.kind === 'branch'
      ? `${cx},${cy - height / 2} ${cx + width / 2},${cy} ${cx},${cy + height / 2} ${cx - width / 2},${cy}`
      : `${cx - width / 2 + 12},${cy - height / 2} ${cx + width / 2},${cy - height / 2} ${cx + width / 2 - 12},${cy + height / 2} ${cx - width / 2},${cy + height / 2}`;
    polygon.setAttribute('points', points);
    polygon.setAttribute('class', 'shape');
    g.appendChild(polygon);
    return;
  }
  const rect = document.createElementNS(SVGNS, 'rect');
  rect.setAttribute('x', cx - width / 2); rect.setAttribute('y', cy - height / 2);
  rect.setAttribute('width', width); rect.setAttribute('height', height);
  rect.setAttribute('rx', ['endpoint', 'return', 'assert'].includes(node.kind) ? 25 : 10);
  rect.setAttribute('class', 'shape');
  if (['param', 'state'].includes(node.kind)) rect.setAttribute('stroke-dasharray', '5 3');
  g.appendChild(rect);
}
function svgNode(node, cx, cy, width, stepIndex) {
  const metrics = nodeMetrics(node, width);
  const g = document.createElementNS(SVGNS, 'g');
  g.setAttribute('class', `node kind-${node.kind} coverage-${node.coverageState || 'unknown'}`);
  g.style.cursor = 'pointer';
  shapeFor(g, node, cx, cy, width, metrics.height);
  const title = document.createElementNS(SVGNS, 'title');
  title.textContent = `${node.label} — ${node.detail}${node.coverage ? ` — ${node.coverage.covered}/${node.coverage.total} branches reported by ${node.coverage.source}` : ''}`;
  const kind = document.createElementNS(SVGNS, 'text');
  const top = cy - metrics.contentHeight / 2;
  kind.setAttribute('x', cx); kind.setAttribute('y', top + 10);
  kind.setAttribute('text-anchor', 'middle'); kind.setAttribute('class', 'nodeKind');
  kind.textContent = `${typeof stepIndex === 'number' ? `${String(stepIndex + 1).padStart(2, '0')}  ` : ''}${(node.tag || node.kind).toUpperCase()}${node.coverage ? ` · ${node.coverage.covered}/${node.coverage.total} branches` : ''}`;
  const text = document.createElementNS(SVGNS, 'text');
  text.setAttribute('text-anchor', 'middle'); text.setAttribute('class', 'nodeLabel');
  metrics.lines.forEach((line, index) => {
    const span = document.createElementNS(SVGNS, 'tspan');
    span.setAttribute('x', cx); span.setAttribute('y', top + 32 + index * 17);
    span.textContent = line;
    text.appendChild(span);
  });
  g.append(title, kind, text);
  g.onclick = (event) => openPopup(node.detail, event.clientX, event.clientY);
  return g;
}
function svgArrow(svg, x1, y1, x2, y2) {
  const path = document.createElementNS(SVGNS, 'path');
  path.setAttribute('d', `M ${x1} ${y1} L ${x2} ${y2}`);
  path.setAttribute('class', 'edge');
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = document.createElementNS(SVGNS, 'path');
  head.setAttribute('d', `M ${x2} ${y2} L ${x2 - 8 * Math.cos(angle - 0.4)} ${y2 - 8 * Math.sin(angle - 0.4)} L ${x2 - 8 * Math.cos(angle + 0.4)} ${y2 - 8 * Math.sin(angle + 0.4)} Z`);
  head.setAttribute('class', 'edgeHead');
  svg.append(path, head);
}
function makeSvg(width, height) {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'diagramSvg');
  return svg;
}
const hasCostCards = () => !!diagrams?.growth?.nodes?.length && !diagrams.growth.series?.length;
function diagramOptions() {
  const supplied = diagrams?.availableTypes;
  const available = (Array.isArray(supplied) ? supplied : ['dataFlow', 'sequence', 'dependencies', 'architecture', 'testing']).filter((type) => {
    const graph = diagrams?.[type];
    if (['cartesian', 'growth'].includes(type) && graph?.series?.length) return true;
    if (!graph?.nodes?.length) return false;
    return type !== 'architecture' || (graph.nodes.length > 1 && graph.edges?.length > 0);
  });
  document.querySelectorAll('.diagramTypeBtn').forEach((button) => {
    const type = button.getAttribute('data-type');
    const shown = available.includes(type);
    if (type === 'cartesian') button.textContent = /request count/i.test(diagrams?.cartesian?.yLabel || '') ? 'Request counts' : 'Code estimate';
    if (type === 'growth') button.textContent = hasCostCards() ? 'Query performance' : 'Performance growth';
    button.classList.toggle('hidden', !shown);
  });
  if (!available.includes(diagramType)) diagramType = available[0] || 'dataFlow';
  document.querySelectorAll('.diagramTypeBtn').forEach((button) => button.classList.toggle('isActive', button.getAttribute('data-type') === diagramType));
  document.querySelectorAll('.diagramFamilySelect').forEach((select) => {
    const choices = Array.from(select.options).filter((option) => option.value);
    choices.forEach((option) => {
      option.hidden = !available.includes(option.value);
      option.disabled = option.hidden;
      if (option.value === 'cartesian') option.textContent = /request count/i.test(diagrams?.cartesian?.yLabel || '') ? 'Request counts' : 'Code estimate';
      if (option.value === 'growth') option.textContent = hasCostCards() ? 'Query performance' : 'Performance growth';
    });
    select.disabled = !choices.some((option) => !option.disabled);
    select.value = choices.some((option) => option.value === diagramType && !option.disabled) ? diagramType : '';
  });
  return available;
}
function visibleNodes() {
  const graph = diagrams?.[diagramType];
  if (!graph) return [];
  if (diagramType === 'sequence' && graph.sequence?.messages?.length) return graph.sequence.messages.map((message, index) => ({ id: `message:${index}`, kind: 'call', label: message.label, detail: `${message.label}${message.sourceLine ? ` at source line ${message.sourceLine}` : ''}` }));
  if (['decisions', 'circuit', 'wireframe', 'cartesian', 'growth', 'context', 'security'].includes(diagramType)) return graph.nodes || [];
  const enabled = new Set([...document.querySelectorAll('.layerToggle:checked')].map((box) => box.getAttribute('data-layer')));
  enabled.add('core');
  if (diagramType === 'dependencies' || diagramType === 'architecture') { enabled.add('imports'); enabled.add('calls'); }
  const nodes = graph.nodes.filter((node) => enabled.has(node.layer || LAYER_OF[node.kind] || 'core'));
  return diagramType === 'sequence' ? nodes : nodes.sort((a, b) => (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9));
}
let diagramZoom = 100;
function applyDiagramZoom() {
  const svg = document.querySelector('#diagram .diagramSvg');
  if (svg) {
    const naturalWidth = Number(svg.getAttribute('data-natural-width'));
    svg.style.width = naturalWidth ? `${naturalWidth * diagramZoom / 100}px` : `${diagramZoom}%`;
    if (naturalWidth) svg.style.minWidth = svg.style.width;
  }
  if ($('zoomLabel')) $('zoomLabel').textContent = `${diagramZoom}%`;
}
function svgText(svg, text, x, y, className = 'plotLabel') {
  const element = document.createElementNS(SVGNS, 'text');
  element.setAttribute('x', x); element.setAttribute('y', y); element.setAttribute('class', className);
  element.textContent = text; svg.appendChild(element); return element;
}
function svgLine(svg, x1, y1, x2, y2, className = 'edge') {
  const path = document.createElementNS(SVGNS, 'path');
  path.setAttribute('d', `M ${x1} ${y1} L ${x2} ${y2}`); path.setAttribute('class', className); svg.appendChild(path);
}
function sequenceDiagram(graph) {
  const model = graph.sequence;
  if (!model?.participants?.length || !model.messages?.length) return null;
  const participants = model.participants;
  const width = Math.max(400, participants.length * 160 + 100);
  const x = (id) => 90 + participants.findIndex((item) => item.id === id) * 160;
  const headers = participants.map((participant) => wrapDiagramLabel(participant.label, 17));
  const headerHeight = Math.max(52, ...headers.map((lines) => lines.length * 16 + 20));
  const rows = model.messages.map((message) => {
    const span = Math.max(120, Math.abs(x(message.to) - x(message.from)) - 16);
    const lines = wrapDiagramLabel(`${message.label}${message.sourceLine ? ` · L${message.sourceLine}` : ''}`, Math.max(14, Math.floor(span / 7.2)));
    return { message, lines, height: Math.max(64, lines.length * 16 + 28) };
  });
  const height = headerHeight + 50 + rows.reduce((sum, row) => sum + row.height, 0);
  const svg = makeSvg(width, height);
  svg.setAttribute('class', 'diagramSvg sequenceDiagram');
  svg.style.minWidth = `${width}px`;
  svg.style.width = `${width}px`;
  svg.setAttribute('data-natural-width', String(width));
  for (const participant of participants) {
    const center = x(participant.id);
    const header = document.createElementNS(SVGNS, 'rect');
    header.setAttribute('x', center - 64); header.setAttribute('y', 12);
    header.setAttribute('width', 128); header.setAttribute('height', headerHeight); header.setAttribute('rx', 6);
    header.setAttribute('class', 'sequenceParticipant'); svg.appendChild(header);
    const title = document.createElementNS(SVGNS, 'title'); title.textContent = `Call participant: ${participant.label}`; header.appendChild(title);
    wrapDiagramLabel(participant.label, 17).forEach((line, index) => {
      const text = svgText(svg, line, center, 33 + index * 16, 'sequenceLabel'); text.setAttribute('text-anchor', 'middle');
    });
    svgLine(svg, center, headerHeight + 17, center, height - 12, 'sequenceLifeline');
  }
  let top = headerHeight + 32;
  rows.forEach(({ message, lines, height }, index) => {
    const group = document.createElementNS(SVGNS, 'g');
    group.setAttribute('class', `sequenceMessage${index === walkIndex ? ' walkActive' : ''}`);
    svg.appendChild(group);
    const from = x(message.from), to = x(message.to);
    const center = from === to ? from + 45 : (from + to) / 2;
    lines.forEach((line, lineIndex) => {
      const text = svgText(group, `${lineIndex === 0 ? `${index + 1}. ` : ''}${line}`, center, top + lineIndex * 16, 'sequenceLabel');
      text.setAttribute('text-anchor', 'middle');
    });
    const y = top + lines.length * 16 + 2;
    if (from === to) {
      svgLine(group, from, y, from + 45, y); svgLine(group, from + 45, y, from + 45, y + 17); svgArrow(group, from + 45, y + 17, from, y + 17);
    } else svgArrow(group, from, y, to, y);
    top += height;
  });
  return svg;
}
function dataFlowDiagram(graph, nodes) {
  if (!nodes.length) return null;
  const shown = new Set(nodes.map((node) => node.id));
  const edges = (graph.edges || []).filter((edge) => shown.has(edge.from) && shown.has(edge.to) && edge.from !== edge.to);
  const incoming = new Set(edges.map((edge) => edge.to));
  const roots = nodes.filter((node) => !incoming.has(node.id));
  const depth = new Map((roots.length ? roots : nodes.slice(0, 1)).map((node) => [node.id, 0]));
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false;
    for (const edge of edges) {
      if (depth.has(edge.from) && !depth.has(edge.to)) { depth.set(edge.to, depth.get(edge.from) + 1); changed = true; }
    }
    if (!changed) break;
  }
  const groups = new Map();
  for (const node of nodes) {
    const level = depth.get(node.id) ?? 0;
    if (!groups.has(level)) groups.set(level, []);
    groups.get(level).push(node);
  }
  const positions = [];
  let top = 18;
  for (const [, group] of [...groups].sort((a, b) => a[0] - b[0])) {
    for (let index = 0; index < group.length; index += 2) {
      const row = group.slice(index, index + 2);
      const nodeWidth = row.length === 1 ? 340 : 166;
      const height = Math.max(...row.map((node) => nodeMetrics(node, nodeWidth).height));
      row.forEach((node, column) => positions.push({ node, width: nodeWidth, x: row.length === 1 ? 200 : column ? 297 : 103,
        y: top + height / 2, height: nodeMetrics(node, nodeWidth).height }));
      top += height + 66;
    }
  }
  const svg = makeSvg(400, top - 36); svg.setAttribute('class', 'diagramSvg dataFlowDiagram');
  for (const edge of edges) {
    const from = positions.find((position) => position.node.id === edge.from), to = positions.find((position) => position.node.id === edge.to);
    if (!from || !to) continue;
    const relation = document.createElementNS(SVGNS, 'g');
    relation.setAttribute('class', 'graphRelation');
    relation.setAttribute('data-from', edge.from); relation.setAttribute('data-to', edge.to);
    svg.appendChild(relation);
    svgArrow(relation, from.x, from.y + from.height / 2 + 3, to.x, to.y - to.height / 2 - 3);
    if (edge.label) {
      const label = svgText(relation, edge.label, (from.x + to.x) / 2, (from.y + from.height / 2 + to.y - to.height / 2) / 2 - 6, 'flowEdgeLabel');
      label.setAttribute('text-anchor', 'middle');
      const title = document.createElementNS(SVGNS, 'title'); title.textContent = edge.label; label.appendChild(title);
    }
  }
  positions.forEach(({ node, x, y, width }, index) => svg.appendChild(svgNode(node, x, y, width, index)));
  return svg;
}
function costMapDiagram(graph, nodes) {
  if (!nodes.length) return null;
  const rows = nodes.map((node) => {
    const title = wrapDiagramLabel(node.label, 40);
    const snippet = node.snippet ? wrapDiagramLabel(node.snippet, 50).slice(0, 2) : [];
    const body = wrapDiagramLabel(node.detail, 54);
    return { node, title, snippet, body, height: 40 + (title.length - 1) * 18 + (snippet.length ? 18 + (snippet.length - 1) * 15 : 0) + 18 + (body.length - 1) * 15 + 12 };
  });
  const svg = makeSvg(400, rows.reduce((sum, row) => sum + row.height + 12, 8));
  svg.setAttribute('class', 'diagramSvg costMapDiagram');
  let top = 8;
  for (const row of rows) {
    const group = document.createElementNS(SVGNS, 'g');
    group.setAttribute('class', `costCard tone-${row.node.tone || 'good'}`);
    const card = document.createElementNS(SVGNS, 'rect');
    card.setAttribute('x', 12); card.setAttribute('y', top); card.setAttribute('width', 376); card.setAttribute('height', row.height); card.setAttribute('rx', 10);
    card.setAttribute('class', 'costShape');
    const bar = document.createElementNS(SVGNS, 'rect');
    bar.setAttribute('x', 12); bar.setAttribute('y', top); bar.setAttribute('width', 6); bar.setAttribute('height', row.height); bar.setAttribute('rx', 3);
    bar.setAttribute('class', 'costBar');
    group.append(card, bar);
    svgText(group, (row.node.tag || '').toUpperCase(), 30, top + 20, 'costTag');
    let y = top + 22;
    row.title.forEach((line) => { y += 18; svgText(group, line, 30, y, 'costTitle'); });
    row.snippet.forEach((line, index) => { y += index ? 15 : 18; svgText(group, line, 30, y, 'costSnippet'); });
    row.body.forEach((line, index) => { y += index ? 15 : 18; svgText(group, line, 30, y, 'costBody'); });
    svg.appendChild(group);
    top += row.height + 12;
  }
  return svg;
}
function specialDiagram(type, graph, nodes) {
  if (!graph) return null;
  if (type === 'sequence') return sequenceDiagram(graph);
  if (type === 'dataFlow') return dataFlowDiagram(graph, nodes);
  if (type === 'testing' && nodes.some((node) => node.id.startsWith('junit:'))) {
    const svg = dataFlowDiagram(graph, nodes);
    if (svg) svg.setAttribute('class', 'diagramSvg dataFlowDiagram testingDiagram');
    return svg;
  }
  if (type === 'growth' && !graph.series?.length) return costMapDiagram(graph, nodes);
  if (['cartesian', 'growth'].includes(type) && graph.series?.length) {
    const series = graph.series.filter((line) => Array.isArray(line.points) && line.points.length);
    const all = series.flatMap((line) => line.points).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (!all.length) return null;
    const maxX = Math.max(1, ...all.map((point) => point.x)), maxY = Math.max(1, ...all.map((point) => point.y));
    const svg = makeSvg(400, 320); svg.setAttribute('class', 'diagramSvg cartesianDiagram');
    const px = (value) => 50 + value / maxX * 320, py = (value) => 250 - value / maxY * 210;
    for (let step = 0; step <= 4; step++) {
      const x = step * maxX / 4, y = step * maxY / 4;
      svgLine(svg, px(x), 40, px(x), 250, 'plotGrid'); svgLine(svg, 50, py(y), 370, py(y), 'plotGrid');
      svgText(svg, Math.round(x * 10) / 10, px(x) - 4, 266); svgText(svg, Math.round(y * 10) / 10, 8, py(y) + 4);
    }
    svgArrow(svg, 50, 250, 380, 250); svgArrow(svg, 50, 250, 50, 28);
    series.forEach((line, index) => {
      const points = line.points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
      const curve = document.createElementNS(SVGNS, 'path');
      curve.setAttribute('d', points.map((point, i) => `${i ? 'L' : 'M'} ${px(point.x)} ${py(point.y)}`).join(' '));
      curve.setAttribute('class', `plotSeries plotSeries-${index % 3}`); svg.appendChild(curve);

    });
    svgText(svg, graph.xLabel || 'Input size', 140, 294); svgText(svg, graph.yLabel || 'Illustrative operations', 52, 315);
    return svg;
  }
  if (type === 'decisions') {
    const branches = nodes.filter((node) => node.kind === 'branch');
    if (!branches.length) return null;
    const layouts = branches.map((branch) => {
      const leaves = (graph.edges || []).filter((edge) => edge.from === branch.id).slice(0, 2).map((edge) => ({ edge, node: nodes.find((node) => node.id === edge.to) })).filter((item) => item.node);
      const branchHeight = nodeMetrics(branch, 280).height;
      const leafHeight = Math.max(65, ...leaves.map(({ node }) => nodeMetrics(node, 155).height));
      return { branch, leaves, branchHeight, leafHeight, height: branchHeight + leafHeight + 85 };
    });
    const svg = makeSvg(400, layouts.reduce((sum, item) => sum + item.height, 15));
    svg.setAttribute('class', 'diagramSvg decisionsDiagram');
    let top = 12;
    for (const item of layouts) {
      const cy = top + item.branchHeight / 2;
      const leafY = top + item.branchHeight + 45 + item.leafHeight / 2;
      svg.appendChild(svgNode(item.branch, 200, cy, 280));
      item.leaves.forEach(({ edge, node }, index) => {
        const x = index ? 302 : 98;
        svgArrow(svg, 200, cy + item.branchHeight / 2, x, leafY - nodeMetrics(node, 155).height / 2 - 3);
        svgText(svg, edge.label || (index ? 'false' : 'true'), index ? 267 : 89, leafY - item.leafHeight / 2 - 10);
        svg.appendChild(svgNode(node, x, leafY, 155));
      });
      top += item.height;
    }
    return svg;
  }
  if (type === 'wireframe') {
    if (!nodes.length) return null;
    const shown = nodes.slice(0, 10);
    const positions = [];
    let top = 30;
    for (let index = 0; index < shown.length; index += 2) {
      const row = shown.slice(index, index + 2);
      const rowHeight = Math.max(...row.map((node) => nodeMetrics(node, 150).height));
      row.forEach((node, column) => positions.push({ node, x: column ? 285 : 105, y: top + rowHeight / 2 + (column ? 22 : 0) }));
      top += rowHeight + 65;
    }
    const height = Math.max(...positions.map((item) => item.y + nodeMetrics(item.node, 150).height / 2)) + 25;
    const svg = makeSvg(400, height); svg.setAttribute('class', 'diagramSvg wireframeDiagram');
    for (const edge of graph.edges || []) {
      const a = positions.find((item) => item.node.id === edge.from), b = positions.find((item) => item.node.id === edge.to);
      if (a && b) svgArrow(svg, a.x, a.y + 26, b.x, b.y - nodeMetrics(b.node, 150).height / 2 - 4);
    }
    for (const { node, x, y } of positions) {
      const height = nodeMetrics(node, 150).height;
      const cube = document.createElementNS(SVGNS, 'path');
      cube.setAttribute('d', `M ${x - 75} ${y - height / 2} l 12 -12 h 150 v ${height} l -12 12 M ${x + 75} ${y - height / 2} l 12 -12 M ${x - 63} ${y + height / 2 - 12} l -12 12`);
      cube.setAttribute('class', 'wireOutline'); svg.appendChild(cube); svg.appendChild(svgNode(node, x, y, 150));
    }
    return svg;
  }
  if (type === 'circuit') {
    if (!nodes.length) return null;
    const positions = [];
    let top = 25;
    nodes.forEach((node) => { const height = nodeMetrics(node, 280).height; positions.push({ node, x: 225, y: top + height / 2 }); top += height + 40; });
    const height = Math.max(...positions.map((item) => item.y + nodeMetrics(item.node, 280).height / 2)) + 25;
    const svg = makeSvg(400, height); svg.setAttribute('class', 'diagramSvg circuitDiagram');
    svgLine(svg, 35, 15, 35, height - 15); svgLine(svg, 385, 15, 385, height - 15);
    for (const edge of graph.edges || []) {
      const a = positions.find((item) => item.node.id === edge.from), b = positions.find((item) => item.node.id === edge.to);
      if (a && b) { svgLine(svg, 85, a.y, 35, a.y); svgLine(svg, 35, b.y, 85, b.y); }
    }
    positions.forEach(({ node, x, y }) => { svgLine(svg, x + 140, y, 385, y); svg.appendChild(svgNode(node, x, y, 280)); });
    return svg;
  }
  return null;
}
function requestCountingGuide() {
  const details = document.createElement('details');
  details.className = 'requestCountingGuide';
  const summary = document.createElement('summary');
  summary.textContent = 'How to count requests';
  details.appendChild(summary);
  let target = details;
  const paragraph = (text, heading = false) => {
    if (heading) { target = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = text; target.appendChild(summary); details.appendChild(target); return; }
    const node = document.createElement('p'); node.textContent = text; target.appendChild(node);
  };
  paragraph('Choose the measurement that matches the code. Browser HTTP requests, mocked fetch calls, Java service calls, and database queries are different counts. The growth curves do not measure any of them.');
  paragraph('Browser: DevTools Network', true);
  const steps = document.createElement('ol');
  for (const text of [
    'Open the running frontend in a browser, open Developer Tools → Network, choose Fetch/XHR, and filter to the endpoint you want to count.',
    'Clear the request list, perform one action, and count the new matching requests. Record the starting state and whether each request was served from cache.',
    'Clear the list again and repeat the same action from the same state. Compare initial load with expansion or a repeated click only when that distinction is part of your design.',
    'Separate polling, redirects, retries, and development-only behaviour before calling a request duplicate. Record counts; do not infer database queries or execution time from this list.',
  ]) { const item = document.createElement('li'); item.textContent = text; steps.appendChild(item); }
  target.appendChild(steps);
  paragraph('Vitest: instrument the request boundary', true);
  paragraph('This applies only to a frontend test that uses Vitest and actually sends requests through fetch or request handlers. It is a separate example, not a diagnosis of the selected code. A mock count is not a real network measurement and does not measure latency.');
  const testSteps = document.createElement('ol');
  for (const text of [
    'Start from a fresh test/component state. If fetch is the real request boundary, use vi.stubGlobal with a vi.fn() fetch stub, or extend the mock already used by your test. Record each URL and method in a requests array and keep returning the response fixture that the application expects.',
    'After initial setup settles, record the baseline count. Reset the recorder you will use: set requests.length = 0 for an array, or call mockClear() for mock.calls. Perform one click/expand action, wait for the expected UI update, then inspect requests.length or mock.calls.length on the recorder you reset. The result is the count caused during that action window.',
    'Repeat the click and record a separate count. If comparing independent scenarios, remount/reset the component and data to the same initial state. Keep polling, retry, cache, and development-mode effects separate so changes have a clear explanation.',
    'Compare toHaveBeenCalledTimes(expectedCount) with the required behaviour, not an arbitrary passing number. Restore replaced globals after the test using vi.unstubAllGlobals(). These counts show mock calls, not network latency or database queries.',
  ]) { const item = document.createElement('li'); item.textContent = text; testSteps.appendChild(item); }
  target.appendChild(testSteps);
  paragraph('If your test uses request handlers instead, increment a counter in the matching handler and reset the counter between actions. Keep the handler implementation in place. Choose the expected count from the required behaviour, then compare observations; do not choose it merely to make the test pass.');
  paragraph('Java/JUnit selection', true);
  paragraph('If your selection is a Java/JUnit integration test that calls a service directly, browser DevTools and Vitest instrumentation do not apply to those service calls. Use instrumentation appropriate to the Java test’s actual service, repository, or datasource boundary; only an HTTP client call can establish an HTTP request count.');
  return details;
}
function renderDiagram() {
  const host = $('diagram');
  if (!host || !diagrams) return;
  diagramOptions();
  const nodes = visibleNodes();
  host.replaceChildren();
  const special = specialDiagram(diagramType, diagrams[diagramType], nodes);
  if (special) {
    const caption = document.createElement('p'); caption.className = 'diagramCaption';
    caption.textContent = (diagrams[diagramType]?.caption || (diagramType === 'dataFlow' ? 'Excerpt sketch of visible data relationships; not a proven runtime trace.' : 'A learning sketch of the supplied code; not measured runtime evidence.')) + (diagramType === 'wireframe' && nodes.length > 10 ? ` Showing the first 10 of ${nodes.length} visible references.` : '');
    if (diagramType === 'sequence') {
      const viewport = document.createElement('div'); viewport.className = 'diagramCanvas';
      viewport.setAttribute('tabindex', '0'); viewport.setAttribute('role', 'region');
      viewport.setAttribute('aria-label', 'Sequence diagram; scroll horizontally to reach all participants');
      viewport.appendChild(special); host.append(caption, viewport);
      const scrollHint = document.createElement('p'); scrollHint.className = 'muted';
      scrollHint.textContent = 'Scroll sideways inside the diagram to see every participant. Select one test or method to inspect its calls; separate tests do not execute in file order.';
      host.appendChild(scrollHint);
    } else host.append(caption, special);
    if (diagramType === 'growth' && diagrams.growth?.series?.length) {
      const bridge = document.createElement('p'); bridge.className = 'muted';
      bridge.textContent = 'These curves are general examples, not a growth model or measured timing for this selection. The optional guide below uses request counting as a separate frontend example; it does not measure latency.';
      host.appendChild(bridge);
      host.appendChild(requestCountingGuide());
    }
    if (diagramType === 'cartesian' && /request count/i.test(diagrams[diagramType]?.yLabel || '')) host.appendChild(requestCountingGuide());
    if (['cartesian', 'growth'].includes(diagramType) && diagrams[diagramType]?.series?.length) {
      const legend = document.createElement('div'); legend.className = 'chartLegend';
      (diagrams[diagramType].series || []).forEach((line, index) => { const item = document.createElement('span'); item.className = `plotLegend-${index % 3}`; item.textContent = `● ${line.name}${line.description ? ` — ${line.description}` : ''}`; legend.appendChild(item); });
      host.appendChild(legend);
    }
    if (diagramType === 'decisions') { const legend = document.createElement('p'); legend.className = 'muted'; legend.textContent = 'Coverage: green = all branches hit; red = one or more missed; dashed = unknown. Load a coverage report to add evidence.'; host.appendChild(legend); }
    applyDiagramZoom(); return;
  }
  if (!nodes.length) { host.textContent = 'No useful graph in this view for the supplied excerpt.'; return; }
  const width = 400;
  const nodeWidth = 340;
  const positions = [];
  let cursor = 18;
  for (const node of nodes) {
    const height = nodeMetrics(node, nodeWidth).height;
    positions.push({ node, top: cursor, height, y: cursor + height / 2 });
    cursor += height + 30;
  }
  const svg = makeSvg(width, cursor - 12);
  const dependencies = ['architecture', 'dependencies', 'context', 'security'].includes(diagramType);
  if (dependencies) {
    for (const edge of diagrams[diagramType].edges || []) {
      const source = positions.find((position) => position.node.id === edge.from);
      const target = positions.find((position) => position.node.id === edge.to);
      if (!source || !target || source === target) continue;
      const connector = document.createElementNS(SVGNS, 'path');
      connector.setAttribute('d', `M 30 ${source.y} L 12 ${source.y} L 12 ${target.y} L 28 ${target.y}`);
      connector.setAttribute('class', 'edge');
      svg.appendChild(connector);
    }
  }
  positions.forEach((position, index) => {
    if (index) {
      if (!dependencies && position.node.kind !== 'import' && positions[index - 1].node.kind !== 'import') {
        const previous = positions[index - 1];
        svgArrow(svg, width / 2, previous.top + previous.height + 3, width / 2, position.top - 3);
      }
    }
    svg.appendChild(svgNode(position.node, width / 2, position.y, nodeWidth, dependencies || position.node.kind === 'import' ? undefined : index));
  });
  svg.querySelectorAll('.node').forEach((node, index) => { if (index === walkIndex) node.classList.add('walkActive'); });
  const caption = document.createElement('p');
  caption.className = 'diagramCaption';
  const captions = {
    dataFlow: 'Excerpt sketch of inputs, branches, calls and outputs. Arrows aid reading; they do not establish execution paths.',
    sequence: 'Source-order sketch of the supplied excerpt, not an executed trace.',
    dependencies: 'References visible in this excerpt. Internal implementation and runtime wiring remain unknown.',
    architecture: 'Visible endpoint and method relationships in the supplied excerpt.',
    testing: 'Suggested test structure: arrange inputs, call the code, and inspect the resulting behaviour.',
  };
  caption.textContent = diagrams[diagramType]?.caption || captions[diagramType] || captions.dataFlow;
  host.append(caption, svg);
  applyDiagramZoom();
}
on('zoomInBtn', 'click', () => {
  diagramZoom = Math.min(180, diagramZoom + 20);
  applyDiagramZoom();
});
on('zoomOutBtn', 'click', () => {
  diagramZoom = Math.max(80, diagramZoom - 20);
  applyDiagramZoom();
});
function resetDiagramQuestion() {
  diagramRequest = null;
  diagramHistory = [];
  $('diagramAskBtn').disabled = false;
  $('diagramAnswer').textContent = '';
}
on('diagramAskBtn', 'click', () => {
  const question = $('diagramQuestion').value.trim();
  if (!question || !diagrams || diagramRequest) return;
  const requestId = `diagram-${++diagramSequence}`;
  diagramRequest = { requestId, diagramType, question };
  $('diagramAskBtn').disabled = true;
  $('diagramAnswer').textContent = 'Thinking locally…';
  vscode.postMessage({ type: 'diagramQuestion', requestId, diagramType, question, goal: ($('diagramGoal')?.value || '').trim().slice(0, 600), history: diagramHistory.slice(-3) });
});
on('loadCoverageBtn', 'click', () => vscode.postMessage({ type: 'loadCoverage' }));
on('visualiseBtn', 'click', () => {
  $('diagram').textContent = 'Reading the selected code…';
  vscode.postMessage({ type: 'visualiseSelection', fresh: true });
});
on('expandDiagramBtn', 'click', () => vscode.postMessage({ type: 'expandDiagram' }));
document.querySelectorAll('.diagramTypeBtn').forEach((btn) =>
  btn.addEventListener('click', () => {
    resetDiagramQuestion();
    diagramType = btn.getAttribute('data-type');
    document.querySelectorAll('.diagramTypeBtn').forEach((b) => b.classList.toggle('isActive', b === btn));
    renderDiagram();
  }),
);
document.querySelectorAll('.diagramFamilySelect').forEach((select) => select.addEventListener('change', () => {
  if (!select.value) return;
  resetDiagramQuestion(); diagramType = select.value; renderDiagram();
}));
document.querySelectorAll('.layerToggle').forEach((box) => box.addEventListener('change', renderDiagram));

/* Host sends premium voice ids. The webview's own speechSynthesis list is the robotic compact set. */
const ELOQUENCE_ROBOT_RE = /\b(flo|eddy|reed|rocko|sandy|shelley|grandma|grandpa|fred|ralph|albert|kathy|junior|zarvox|trinoids|whisper|bells|boing|bubbles|cellos|organ|bad news|good news|bahh|wobble|jester|superstar|daniel)\b/i;
vscode.postMessage({ type: 'getVoices' });

function fillHostVoices(voices) {
  const select = $('voiceSelect');
  if (!select || !Array.isArray(voices) || !voices.length) return;
  const rows = voices
    .map((voice) => (typeof voice === 'string' ? { id: voice, label: voice } : voice))
    .filter((voice) => voice && voice.id && !ELOQUENCE_ROBOT_RE.test(`${voice.label || ''} ${voice.id}`));
  if (!rows.length) return;
  select.replaceChildren();
  for (const voice of rows) {
    const opt = document.createElement('option');
    opt.value = voice.id;
    opt.textContent = voice.label || voice.id;
    select.appendChild(opt);
  }
}

function renderLedger(notes) {
  const host = $('ledger');
  if (!host) return;
  host.replaceChildren();
  if (!notes.length) {
    const empty = document.createElement('span');
    empty.className = 'muted';
    empty.textContent = 'Nothing kept yet. Press Keep on an explanation to save it.';
    host.appendChild(empty);
    return;
  }
  for (const note of notes) {
    const row = document.createElement('div');
    row.className = 'ledgerRow';
    const title = document.createElement('strong');
    title.textContent = note.term;
    const meta = document.createElement('span');
    meta.className = 'muted';
    meta.textContent = ` ${note.layerLabel ? `${note.layerLabel} · ` : ''}${note.statusLabel || ''} · ${note.shortFile || note.file}:${note.line}`;
    const line = document.createElement('div');
    line.textContent = note.bottomLine;
    row.append(title, meta, line);
    host.appendChild(row);
  }
}
function showKeepNote(text) {
  const old = $('keepNote');
  if (old) old.remove();
  const note = document.createElement('div');
  note.id = 'keepNote';
  note.className = 'hint';
  note.textContent = text;
  $('result').prepend(note);
}
window.addEventListener('message', (event) => {
  if (event.data?.type === 'concepts') renderLedger(event.data.concepts || []);
});

let previousSummaryCard = null;
let currentSummaryCard = null;
function summaryQuestions(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item.term === 'string' && item.term.trim() &&
    typeof item.question === 'string' && item.question.trim()).slice(0, 20) : [];
}
function summaryQuestionCard(title, questions) {
  const valid = summaryQuestions(questions);
  if (!valid.length) return null;
  const card = document.createElement('details');
  card.className = 'card deepCard'; card.open = true;
  const summary = document.createElement('summary'); summary.textContent = title;
  card.appendChild(summary);
  for (const item of valid) {
    const question = document.createElement('section'); question.className = 'reviewQuestion';
    if (typeof item.conceptId === 'string') question.setAttribute('data-concept-id', item.conceptId);
    const term = document.createElement('strong'); term.textContent = item.term;
    const prompt = document.createElement('p'); prompt.textContent = item.question;
    question.append(term, prompt);
    if (typeof item.source === 'string' && item.source.trim()) {
      const source = document.createElement('div'); source.className = 'muted'; source.textContent = item.source;
      question.appendChild(source);
    }
    card.appendChild(question);
  }
  return card;
}
function renderSummaryCards() {
  const host = $('reviewCard');
  if (host) host.replaceChildren(...[previousSummaryCard, currentSummaryCard].filter(Boolean));
}

/* ---------- Messages ---------- */
window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'learningStarted') {
    visualisePinned = false;
    learningSessionId = msg.sessionId;
    closePopup();
    resetDeepSections();
    renderTestOutline(null);
    return;
  }
  if (msg.sessionId != null && learningSessionId != null && msg.sessionId !== learningSessionId) return;
  if (msg.type === 'context') {
    codeCtx = msg.context;
    // Loaded Q&amp;A context defaults to Answer mode so the first reply is direct.
    if (codeCtx && codeCtx.file === 'Solve chat') {
      setChatMode('answer');
      const status = $('cursorPasteStatus');
      if (status) {
        status.textContent =
          `Loaded: Solve chat · ${codeCtx.selection.length} chars — Learn, Ideate, and Visualise use this until you Select in the editor.`;
      }
    }
  } else if (msg.type === 'diagramAnswer') {
    if (!diagramRequest || msg.requestId !== diagramRequest.requestId || diagramRequest.diagramType !== diagramType) return;
    diagramHistory.push({ question: diagramRequest.question, answer: msg.text });
    diagramRequest = null;
    $('diagramAskBtn').disabled = false;
    $('diagramAnswer').textContent = msg.text;
  } else if (msg.type === 'visualiseError') {
    $('diagram').textContent = msg.text;
  } else if (msg.type === 'diagrams') {
    if (msg.sessionId != null && visualisePinned) return;
    if (msg.sourceLabel && $('diagramSelection')) $('diagramSelection').textContent = `Diagram source: ${msg.sourceLabel}. To update, select code and press Visualise selection.`;
    if (msg.openDiagram) { visualisePinned = true; resetDiagramQuestion(); }
    diagrams = msg.diagrams;
    if (msg.openDiagram && $('diagramBlock')) {
      $('diagramBlock').open = true;
      applyMode('visualise');
      diagramZoom = 100;
    }
    renderDiagram();
    if (Object.prototype.hasOwnProperty.call(msg, 'testOutline')) renderTestOutline(msg.testOutline);
  } else if (msg.type === 'improvements') {
    $('improveBtn').disabled = false;
    renderImprovements(msg.ideas || [], msg.file, msg.note);
  } else if (msg.type === 'pocIdeasResult') {
    $('pocIdeasBtn').disabled = false;
    renderPocIdeas(msg.pocs || [], msg.file, msg.note);
  } else if (msg.type === 'ideaHelpReply') {
    if (!ideaHelpState || msg.id !== ideaHelpState.id || msg.requestId !== ideaHelpState.requestId) return;
    $('ideaHelpAnswer').textContent = msg.text;
    $('ideaHelpAnswer').setAttribute('aria-busy', 'false');
    $('ideaHelpSubmit').disabled = false;
    ideaHelpState.pending = false;
  } else if (msg.type === 'ideationError') {
    const targets = { improve: ['improveResult', 'improveBtn'], pocIdeas: ['pocResult', 'pocIdeasBtn'], diverge: ['innovatorResult', 'divergeBtn'], scamper: ['innovatorResult'], pocBlueprint: ['pocBlueprintOut'] };
    const [output, button] = targets[msg.target] || [];
    if ($(output)) $(output).textContent = msg.text;
    if ($(button)) $(button).disabled = false;
  } else if (msg.type === 'pocBlueprintResult') {
    const host = $('pocBlueprintOut');
    if (host) {
      host.replaceChildren();
      const card = document.createElement('div');
      card.className = 'card';
      const title = document.createElement('strong');
      title.textContent = `Experiment plan — ${msg.title}`;
      const set = new Set((msg.keywords || []).map((k) => String(k).toLowerCase()));
      card.append(title, explanationBody(msg.explanation, set));
      host.appendChild(card);
    }
  } else if (msg.type === 'voices') {
    fillHostVoices(msg.voices || []);
  } else if (msg.type === 'streamPartial') {
    // First words as they are generated — don't wait for the full answer.
    const match = /BOTTOM_LINE:\s*(.+)/.exec(msg.text);
    const result = $('result');
    if (match && result) {
      result.replaceChildren();
      const bottom = document.createElement('div');
      bottom.className = 'bottomline';
      bottom.textContent = match[1];
      const note = document.createElement('div');
      note.className = 'muted';
      note.textContent = 'writing…';
      result.append(bottom, note);
    }
  } else if (msg.type === 'explanation') {
    renderExplanation(msg);
  } else if (msg.type === 'explanationReview') {
    renderReview(msg);
  } else if (msg.type === 'deepStatus') {
    const section = deepSection(msg.kind);
    const body = section?.querySelector('.deepBody');
    if (body && !section.dataset.loaded) {
      body.textContent = msg.text;
      body.classList.add('muted');
      body.setAttribute('aria-busy', String(msg.state === 'loading'));
      if (msg.state === 'error') delete section.dataset.requested;
    }
  } else if (msg.type === 'solverSelection') {
    if (msg.context) { solverSelection = msg.context; renderSolverSelection(); saveSolverState(); }
    else if (solverSelectionPending) $('solverSelectionInfo').textContent = 'No code selected in the editor. Select code first, then press Select.';
    solverSelectionPending = false;
  } else if (msg.type === 'solverCheckReply') {
    if (String(msg.id) !== String(solverCheckId)) return;
    $('solverCheckBtn').disabled = false;
    $('solverCheckResult').textContent = msg.text;
  } else if (msg.type === 'solverReply') {
    setSolverBusy(false);
    solverLastReply = msg;
    renderSolver(msg);
    saveSolverState();
  } else if (msg.type === 'solverError') {
    setSolverBusy(false);
    $('solverResult').textContent = msg.text || 'Unable to check this problem. Try again.';
  } else if (msg.type === 'solverDone') {
    solverLastReply = null; saveSolverState(); $('solverQuestionBox').hidden = true;
    $('solverResult').replaceChildren();
    const done = document.createElement('div');
    done.className = 'answer';
    done.textContent = `Fixed: ${msg.problem} — the checks that got you there are the learning. Keep the concept if it taught you something.`;
    $('solverResult').appendChild(done);
    $('solveNextBtn').style.display = 'none';
    $('solveFixedBtn').style.display = 'none';
  } else if (msg.type === 'marked') {
    showKeepNote(`Kept "${msg.term}" in Review (${msg.count} total). Open the Review tab to practise it or remove it.`);
  } else if (msg.type === 'markRefused') {
    showKeepNote(msg.text);
  } else if (msg.type === 'popupAnswer') {
    if (!$('wordPopup').classList.contains('hidden') && (!msg.word || msg.word === popupWord)) {
      const body = $('wordPopupBody');
      const set = popupScope === 'solver' ? solverKeywords : keywordSet;
      if (popupPending) {
        const row = document.createElement('p');
        row.appendChild(rich(msg.text, set, { scope: popupScope }));
        body.appendChild(row);
        popupHistory.push({ question: popupPending, answer: msg.text });
        popupPending = '';
      } else {
        popupFirst = msg.text;
        body.replaceChildren(rich(msg.text, set, { scope: popupScope }));
      }
      popupThreads.set(popupWord, { first: popupFirst, history: [...popupHistory], scope: popupScope });
      renderCrumbs();
      positionPopup();
    }
  } else if (msg.type === 'duckReply') {
    if (!duckPending || msg.id !== duckPending.id) return;
    const answer = duckPending.node;
    answer.className = 'answer';
    answer.textContent = `PIP: ${msg.text}`;
    if (msg.source) {
      const source = document.createElement('div');
      source.className = 'muted';
      source.textContent = msg.source;
      answer.appendChild(source);
    }
    duckPending = null;
    $('duckInput').disabled = false;
    $('duckSubmitBtn').disabled = false;
    $('duckLog').setAttribute('aria-busy', 'false');
    $('duckInput').focus();
  } else if (msg.type === 'answer') {
    // Rubber-duck replies land in the top duck log, as a conversation.
    const log = $('duckLog');
    const div = document.createElement('div');
    div.className = 'answer';
    div.appendChild(rich(msg.text, keywordSet));
    log.appendChild(div);
  } else if (msg.type === 'deepDive') {
    const set = new Set((msg.keywords || []).map((k) => String(k).toLowerCase()));
    const section = deepSection(msg.kind);
    const body = section?.querySelector('.deepBody');
    if (body) {
      body.replaceChildren(explanationBody(msg.explanation, set));
      body.classList.remove('muted');
      body.setAttribute('aria-busy', 'false');
      section.dataset.loaded = '1';
      delete section.dataset.requested;
    }
  } else if (msg.type === 'testSkeleton') {
    const out = $('verifyOut');
    if (out) out.textContent = msg.text;
  } else if (msg.type === 'verifyResult') {
    const out = $('verifyOut');
    if (out) out.textContent = msg.text;
  } else if (msg.type === 'approaches') {
    $('divergeBtn').disabled = false;
    approaches = msg.approaches || [];
    approachIdeaIds = msg.ideaIds || [];
    renderApproaches();
    if (!approaches.length) $('innovatorResult').textContent = msg.note || 'No alternatives were returned. Try a more focused code selection.';
  } else if (msg.type === 'convergeResult') {
    const div = document.createElement('div');
    div.className = 'answer';
    div.textContent = `${msg.approach}\n${msg.text}`;
    $('innovatorResult').appendChild(div);
  } else if (msg.type === 'scamperResult') {
    const div = document.createElement('div');
    div.className = 'answer';
    const strong = document.createElement('strong');
    strong.textContent = `${msg.lens}: `;
    div.append(strong, rich(msg.text, keywordSet));
    if (msg.ideaId) {
      const actions = document.createElement('div');
      actions.className = 'row';
      appendIdeaActions(actions, { id: msg.ideaId, title: msg.lens });
      div.appendChild(actions);
    }
    $('innovatorResult').appendChild(div);
  } else if (msg.type === 'today') {
    const body = $('todayBody');
    if (body) {
      body.textContent = msg.terms?.length
        ? `Kept today: ${msg.terms.join(', ')}`
        : 'Nothing kept yet today.';
    }
    const date = String(msg.review?.date || '');
    previousSummaryCard = summaryQuestionCard(/^\d{4}-\d{2}-\d{2}$/.test(date) ? `Previous summary (${date})` : 'Previous summary', msg.review?.questions);
    renderSummaryCards();
  } else if (msg.type === 'reviewCard') {
    currentSummaryCard = summaryQuestionCard("Today's summary", msg.questions);
    if (!currentSummaryCard) {
      currentSummaryCard = document.createElement('p'); currentSummaryCard.className = 'muted';
      currentSummaryCard.textContent = msg.text || 'Keep an idea in Review first, then make a summary.';
    }
    renderSummaryCards();
  } else if (msg.type === 'stat') {
    if ($('stats')) $('stats').textContent = msg.text;
    if (msg.tokensPerSecond != null || msg.latencyMs != null) {
      updateModelMetrics(msg);
      if (aiLabPending) refreshAiLabTelemetry(msg);
    }
  } else if (msg.type === 'availableModels') {
    fillModelSelector(msg.models || [], msg.selected);
  } else if (msg.type === 'aiLabTelemetry') {
    updateModelMetrics(msg);
    if (aiLabPending) refreshAiLabTelemetry(msg);
  } else if (msg.type === 'aiLabReply') {
    renderAiLabReply(msg);
  } else if (msg.type === 'aiLabError') {
    setAiLabLoading(false);
    const out = $('pipAiLabOutput');
    if (!out) return;
    out.hidden = false;
    out.replaceChildren();
    const err = document.createElement('p');
    err.className = 'pip-ai-lab-error';
    err.textContent = msg.text || 'AI Lab request failed.';
    out.appendChild(err);
  }
});

/* ---------- Solver ---------- */
function selectSolverResponseMode(mode) {
  solverResponseMode = mode === 'direct' ? 'direct' : 'together';
  for (const [id, value] of [['solveBtn', 'together'], ['solveDirectBtn', 'direct']]) {
    const button = $(id);
    if (!button) continue;
    const selected = value === solverResponseMode;
    button.classList.toggle('solverModeSelected', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
}
function solverConfidence(confidence) {
  const definitions = {
    likely: ['Likely', 'A qualitative suggestion, not a measured probability. Confirm it with the proposed check.'],
    possible: ['Possible', 'A plausible hypothesis; the available evidence does not confirm it.'],
    'long shot': ['Tentative', 'Weakly supported by the supplied information; treat this as a hypothesis to investigate.'],
  };
  return definitions[String(confidence || '').toLowerCase()] || ['Unverified', 'No confirming check has been established.'];
}
function usefulSolverDetail(value) {
  const text = String(value || '').trim();
  const generic = new Set([
    'The model did not supply a matching quote for this hypothesis; its cause is unverified.',
    'These supplied clues suggest the hypothesis; they do not verify the cause.',
    'The cause has not been verified against the implementation or a running check.',
    'The cause remains a hypothesis until the check confirms it.',
    'No supporting inference was returned; verify with the check above.',
  ]);
  return generic.has(text) ? '' : text;
}
function renderSolver(msg) {
  const host = $('solverResult');
  host.replaceChildren();
  const { reply, frame } = msg;
  selectSolverResponseMode(msg.mode || solverResponseMode);
  host.setAttribute('data-solver-mode', solverResponseMode);
  solverKeywords = new Set((msg.keywords || []).map((word) => String(word).toLowerCase()));
  const files = msg.files || [];
  const aliases = files.flatMap((file) => {
    const basename = file.label.split(/[\\/]/).pop();
    const matchingIds = new Set(files.filter((item) => item.label.split(/[\\/]/).pop() === basename).map((item) => item.id));
    return basename && basename !== file.label && matchingIds.size === 1 ? [{ ...file, label: basename }] : [];
  });
  const options = { scope: 'solver', files: [...files, ...aliases] };
  const add = (label, text, parent = host) => {
    if (!text) return null;
    const div = document.createElement('div');
    div.className = 'solverLine';
    const strong = document.createElement('button');
    strong.className = 'solverHeader'; strong.type = 'button'; strong.textContent = `${label}:`; strong.title = `Ask about ${label}`;
    strong.onclick = (event) => openPopup(`${label}: ${text}`, event.clientX || 8, event.clientY || 8, 'solver');
    div.append(strong, document.createTextNode(' '), rich(text, solverKeywords, options));
    parent.appendChild(div);
    return div;
  };
  if (msg.fromMock) add('Offline', 'Ollama is unavailable. This is fallback guidance.');
  add('Problem', reply.restate);
  const cause = add(solverResponseMode === 'direct' ? 'Answer' : 'Hypothesis', reply.cause);
  if (cause && !reply.observed) {
    const [label, description] = solverConfidence(reply.confidence);
    const confidence = document.createElement('span');
    confidence.className = 'solverConfidence'; confidence.textContent = label; confidence.title = description;
    confidence.setAttribute('aria-label', `${label}. ${description}`);
    confidence.setAttribute('tabindex', '0');
    cause.append(document.createTextNode(' '), confidence);
  }
  add('Fastest check', reply.check);
  add('Testing strategy', reply.strategy);
  add('First app frame', frame || '');
  add('Question', reply.question);
  const why = document.createElement('details');
  why.className = 'solverEvidence';
  const summary = document.createElement('summary');
  summary.textContent = 'Why this suggestion?';
  const body = document.createElement('div');
  body.className = 'detailsBody';
  add('Used', (msg.sources || []).join(' · '), body);
  for (const [index, evidence] of (reply.evidence || []).entries()) {
    add(msg.evidenceSources?.[index] ? `Clue (${msg.evidenceSources[index]})` : 'Clue', evidence, body);
  }
  add('Inference', usefulSolverDetail(reply.reason), body);
  add('Still unknown', usefulSolverDetail(reply.unknown), body);
  for (const file of files) add('Open file', file.label, body);
  if (body.children.length) { why.append(summary, body); host.appendChild(why); }
  $('solverQuestionBox').hidden = !(reply.question && solverResponseMode !== 'direct');
  $('solveNextBtn').style.display = 'inline-flex';
  $('solveFixedBtn').style.display = 'inline-flex';
}
function setSolverBusy(busy) {
  for (const id of ['solveBtn', 'solveDirectBtn', 'solveNextBtn', 'solveFixedBtn']) $(id).disabled = busy;
  $('solverResult').setAttribute('aria-busy', String(busy));
}
function submitSolver(mode) {
  selectSolverResponseMode(mode);
  saveSolverState();
  const problem = $('solverProblem').value.trim();
  const errorText = $('solverError').value;
  if (!problem && !errorText.trim() && !solverSelection) return;
  solverLastReply = null; solverCheckId += 1; $('solverCheckBtn').disabled = false; $('solverCheckResult').textContent = ''; saveSolverState();
  setSolverBusy(true);
  $('solverQuestionBox').hidden = true;
  $('solverResult').textContent = 'Thinking locally…';
  vscode.postMessage({ type: 'solve', mode, problem, errorText, selection: solverSelection });
}
on('solveBtn', 'click', () => submitSolver('together'));
on('solveDirectBtn', 'click', () => submitSolver('direct'));
on('clearSolverSelectionBtn', 'click', () => { solverSelectionPending = false; solverSelection = null; renderSolverSelection(); saveSolverState(); vscode.postMessage({ type: 'clearSolverSelection' }); });
on('solverCheckBtn', 'click', () => {
  const answer = $('solverAnswer').value.trim();
  if (!answer) return;
  const id = String(++solverCheckId);
  $('solverCheckBtn').disabled = true;
  $('solverCheckResult').textContent = 'Checking against the available evidence…';
  saveSolverState();
  vscode.postMessage({ type: 'solverCheck', id, answer });
});
for (const id of ['solverProblem', 'solverError', 'solverAnswer']) on(id, 'input', saveSolverState);
on('solverBlock', 'toggle', saveSolverState);
on('solveNextBtn', 'click', () => {
  setSolverBusy(true);
  $('solverResult').textContent = 'Next hypothesis…';
  vscode.postMessage({ type: 'solveNext', errorText: $('solverError').value });
});
on('solveFixedBtn', 'click', () => vscode.postMessage({ type: 'solveFixed' }));

/* ---------- A2UI: the drawer reshapes by intent (final stage) ---------- */
function applyMode(mode) {
  activeMode = mode;
  saveSolverState();
  document.querySelectorAll('[data-section]').forEach((el) => {
    el.style.display = el.getAttribute('data-section') === mode ? '' : 'none';
  });
  document.querySelectorAll('.a2uiBtn').forEach((b) => b.classList.toggle('isActive', b.getAttribute('data-mode') === mode));
}
document.querySelectorAll('.a2uiBtn').forEach((btn) =>
  btn.addEventListener('click', () => applyMode(btn.getAttribute('data-mode'))),
);
for (const [id, key] of [['solverProblem','problem'], ['solverError','errorText'], ['solverAnswer','answer']]) if ($(id)) $(id).value = initialSolverState[key] || '';
if ($('solverBlock')) $('solverBlock').open = !!initialSolverState.open;
renderSolverSelection();
selectSolverResponseMode(solverResponseMode);
applyMode(activeMode);
if (solverLastReply) renderSolver(solverLastReply);

/* ---------- Deep dives, innovator, today, collapse ---------- */
let approaches = [];
let approachIdeaIds = [];
let walkIndex = -1;
let walkTimer = null;

document.querySelectorAll('.styleChip').forEach((chip) =>
  chip.addEventListener('click', () => {
    document.querySelectorAll('.styleChip').forEach((c) => c.classList.toggle('isActive', c === chip));
    vscode.postMessage({ type: 'setStyle', style: chip.getAttribute('data-style') });
  }),
);
/* Opening a queued section prioritises it; the host deduplicates background work. */
document.querySelectorAll('.deepLazy[data-kind]').forEach((details) => {
  details.addEventListener('toggle', () => {
    const kind = details.getAttribute('data-kind');
    if (details.open && !details.dataset.loaded && !details.dataset.requested) {
      details.dataset.requested = '1';
      details.querySelector('.deepBody').textContent = 'Preparing this section…';
      vscode.postMessage({ type: 'deep', kind, sessionId: learningSessionId });
    }
  });
});
document.querySelectorAll('.tradeBtn').forEach((btn) =>
  btn.addEventListener('click', () =>
    vscode.postMessage({ type: 'deep', kind: `Trade-off: ${btn.getAttribute('data-trade')}` }),
  ),
);

function renderApproaches() {
  const host = $('innovatorResult');
  host.replaceChildren();
  for (const [index, approach] of approaches.entries()) {
    const card = document.createElement('div');
    card.className = 'card';
    card.textContent = approach;
    const row = document.createElement('div');
    row.className = 'row';
    const pick = document.createElement('button');
    pick.textContent = 'Converge on this';
    pick.onclick = () => vscode.postMessage({ type: 'converge', approach });
    row.appendChild(pick);
    appendIdeaActions(row, { id: approachIdeaIds[index], title: approach });
    card.appendChild(row);
    host.appendChild(card);
  }
}
let currentImproveLens = 'All';
document.querySelectorAll('.improveLensBtn').forEach((btn) =>
  btn.addEventListener('click', () => {
    currentImproveLens = btn.getAttribute('data-lens') || 'All';
    document.querySelectorAll('.improveLensBtn').forEach((b) => b.classList.toggle('isActive', b === btn));
  }),
);
on('improveBtn', 'click', () => {
  $('improveBtn').disabled = true;
  if ($('improveResult')) $('improveResult').textContent = 'Investigating and challenging possible improvements…';
  vscode.postMessage({ type: 'improve', lens: currentImproveLens });
});
on('pocIdeasBtn', 'click', () => {
  $('pocIdeasBtn').disabled = true;
  if ($('pocResult')) $('pocResult').textContent = 'Designing and challenging small experiments…';
  vscode.postMessage({ type: 'pocIdeas', seed: $('pocSeedInput')?.value || '' });
});

let ideaHelpState = null;
let ideaHelpSequence = 0;
function closeIdeaHelp() {
  if (!ideaHelpState) return;
  const opener = ideaHelpState.opener;
  ideaHelpState = null;
  $('ideaHelpDialog').classList.add('hidden');
  opener?.focus();
}
function requestIdeaHelp(mode, question = '') {
  if (!ideaHelpState || ideaHelpState.pending) return;
  const requestId = `idea-${++ideaHelpSequence}`;
  Object.assign(ideaHelpState, { requestId, pending: true });
  $('ideaHelpAnswer').textContent = mode === 'learn' ? 'Connecting the clues to a reusable way to brainstorm…' : 'Checking your question against this idea and its source…';
  $('ideaHelpAnswer').setAttribute('aria-busy', 'true');
  $('ideaHelpSubmit').disabled = true;
  vscode.postMessage({ type: 'ideaHelp', id: ideaHelpState.id, mode, question, requestId });
}
function openIdeaHelp(idea, mode, opener) {
  ideaHelpState = { id: idea.id, opener, pending: false };
  $('ideaHelpTitle').textContent = idea.title;
  $('ideaHelpQuestion').value = '';
  $('ideaHelpAnswer').textContent = 'Ask about this idea, its evidence, or another approach.';
  $('ideaHelpAnswer').setAttribute('aria-busy', 'false');
  $('ideaHelpSubmit').disabled = false;
  $('ideaHelpDialog').classList.remove('hidden');
  $('ideaHelpQuestion').focus();
  if (mode === 'learn') requestIdeaHelp(mode);
}
function appendIdeaActions(row, idea) {
  for (const [label, mode] of [['Ask', 'ask'], ['How to spot this', 'learn']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.disabled = !idea.id;
    button.onclick = () => openIdeaHelp(idea, mode, button);
    row.appendChild(button);
  }
}
function appendVerification(card, verification) {
  const status = document.createElement('div');
  status.className = 'ideaVerification muted';
  status.textContent = verification?.level === 'Refuted' ? 'Not recommended — refuted' : verification?.level || 'Speculation';
  card.appendChild(status);
  if (!verification) return;
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'Evidence and challenge';
  details.appendChild(summary);
  for (const [label, value] of [['Clue', verification.evidence], ['Challenge', verification.challenge], ['Check', verification.check]]) {
    if (!value) continue;
    const line = document.createElement('div');
    line.textContent = `${label}: ${value}`;
    details.appendChild(line);
  }
  card.appendChild(details);
}
on('ideaHelpClose', 'click', closeIdeaHelp);
on('ideaHelpSubmit', 'click', () => {
  const question = $('ideaHelpQuestion').value.trim();
  if (question) requestIdeaHelp('ask', question);
});
on('ideaHelpQuestion', 'keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    const question = event.target.value.trim();
    if (question) requestIdeaHelp('ask', question);
  }
});
on('ideaHelpDialog', 'keydown', (event) => {
  if (event.key !== 'Tab') return;
  const focusable = [...$('ideaHelpDialog').querySelectorAll('button:not(:disabled), textarea')];
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});

function sourceLine(host, file) {
  if (!file) return;
  const about = document.createElement('p');
  about.className = 'muted';
  about.textContent = `About ${file}`;
  host.appendChild(about);
}
function renderImprovements(ideas, file, note) {
  const host = $('improveResult');
  if (!host) return;
  host.replaceChildren();
  sourceLine(host, file);
  if (!ideas.length) {
    const message = document.createElement('p');
    message.textContent = note || 'No grounded improvements were returned. Try a smaller selection or another lens.';
    host.appendChild(message);
  }
  for (const idea of ideas) {
    const card = document.createElement('div');
    card.className = 'card';
    const metaRow = document.createElement('div');
    metaRow.className = 'ideaMetaRow';
    const cat = document.createElement('span');
    cat.className = 'ideaBadge';
    cat.textContent = idea.category;
    const eff = document.createElement('span');
    eff.className = 'muted';
    eff.textContent = idea.effort;
    metaRow.append(cat, eff);

    const title = document.createElement('strong');
    title.textContent = idea.title;
    const why = document.createElement('div');
    why.className = 'muted';
    why.textContent = `Why: ${idea.why}`;
    const change = document.createElement('div');
    change.textContent = `Change: ${idea.change}`;

    const row = document.createElement('div');
    row.className = 'row';
    const bp = document.createElement('button');
    bp.textContent = 'Plan experiment';
    bp.disabled = idea.verification?.level === 'Refuted';
    bp.onclick = () => {
      if ($('pocBlueprintOut')) $('pocBlueprintOut').textContent = 'Planning a small experiment…';
      vscode.postMessage({ type: 'pocBlueprint', ideaId: idea.id, title: idea.title, detail: idea.change });
    };
    const mark = document.createElement('button');
    mark.textContent = 'Keep';
    mark.disabled = idea.verification?.level === 'Refuted';
    mark.onclick = () => vscode.postMessage({ type: 'mark', ideaId: idea.id, term: idea.title, bottomLine: `Hypothesis to check: ${idea.why} — ${idea.change}` });
    row.append(bp, mark);
    appendIdeaActions(row, idea);

    card.append(metaRow, title, why, change);
    appendVerification(card, idea.verification);
    card.appendChild(row);
    host.appendChild(card);
  }
}

function renderPocIdeas(pocs, file, note) {
  const host = $('pocResult');
  if (!host) return;
  host.replaceChildren();
  sourceLine(host, file);
  if (!pocs.length) {
    const message = document.createElement('p');
    message.textContent = note || 'No testable experiments were returned. Describe one uncertainty you want to resolve.';
    host.appendChild(message);
  }
  for (const poc of pocs) {
    const card = document.createElement('div');
    card.className = 'card';
    const metaRow = document.createElement('div');
    metaRow.className = 'ideaMetaRow';
    const badge = document.createElement('span');
    badge.className = 'ideaBadge';
    badge.textContent = 'Experiment';
    const slice = document.createElement('span');
    slice.className = 'muted';
    slice.textContent = `Smallest trial: ${poc.slice}`;
    metaRow.append(badge, slice);

    const title = document.createElement('strong');
    title.textContent = poc.title;
    const hook = document.createElement('div');
    hook.textContent = poc.hook;
    const hyp = document.createElement('div');
    hyp.className = 'muted';
    hyp.textContent = `Test: ${poc.hypothesis} · Success measure: ${poc.demo}`;

    const row = document.createElement('div');
    row.className = 'row';
    const bp = document.createElement('button');
    bp.textContent = 'Plan experiment';
    bp.disabled = poc.verification?.level === 'Refuted';
    bp.onclick = () => {
      if ($('pocBlueprintOut')) $('pocBlueprintOut').textContent = 'Planning a small experiment…';
      vscode.postMessage({ type: 'pocBlueprint', ideaId: poc.id, title: poc.title, detail: `${poc.hook} — ${poc.slice}` });
    };
    row.appendChild(bp);
    appendIdeaActions(row, poc);

    card.append(metaRow, title, hook, hyp);
    appendVerification(card, poc.verification);
    card.appendChild(row);
    host.appendChild(card);
  }
}

on('divergeBtn', 'click', () => {
  $('divergeBtn').disabled = true;
  $('innovatorResult').textContent = 'Exploring alternatives…';
  vscode.postMessage({ type: 'diverge' });
});
document.querySelectorAll('.scamperBtn').forEach((btn) =>
  btn.addEventListener('click', () => vscode.postMessage({ type: 'scamper', lens: btn.getAttribute('data-lens') })),
);
on('summariseDayBtn', 'click', () => vscode.postMessage({ type: 'summariseDay' }));
vscode.postMessage({ type: 'getToday' });
on('collapseAllBtn', 'click', () => {
  document.querySelectorAll('details').forEach((d) => {
    d.open = false;
  });
  $('moreDrawer').classList.add('hidden');
  $('voiceModeBtn').setAttribute('aria-expanded', 'false');
});
on('voiceModeBtn', 'click', () => {
  const drawer = $('moreDrawer');
  const expanded = drawer.classList.contains('hidden');
  drawer.classList.toggle('hidden', !expanded);
  $('voiceModeBtn').setAttribute('aria-expanded', String(expanded));
  if (expanded) $('voiceSelect').focus();
});

/* Walk the diagram: step through nodes with captions */
function setWalk(index) {
  const nodes = visibleNodes();
  if (!nodes.length) return;
  walkIndex = Math.max(0, Math.min(index, nodes.length - 1));
  renderDiagram();
  const node = nodes[walkIndex];
  if ($('walkCaption')) {
    $('walkCaption').textContent = `Step ${walkIndex + 1}/${nodes.length}: ${node.detail}`;
  }
}
on('walkNextBtn', 'click', () => setWalk(walkIndex + 1));
on('walkPrevBtn', 'click', () => setWalk(walkIndex - 1));
on('walkPlayBtn', 'click', (e) => {
  if (walkTimer) {
    clearInterval(walkTimer);
    walkTimer = null;
    e.target.textContent = '▶ Walk';
    return;
  }
  e.target.textContent = '⏸ Walking…';
  setWalk(0);
  walkTimer = setInterval(() => {
    if (walkIndex >= visibleNodes().length - 1) {
      clearInterval(walkTimer);
      walkTimer = null;
      const btn = $('walkPlayBtn');
      if (btn) btn.textContent = '▶ Walk';
      return;
    }
    setWalk(walkIndex + 1);
  }, 1400);
});

/* ---------- Controls ---------- */
on('explainBtn', 'click', () => {
  if (activeMode === 'solve') {
    // Select feeds both: the chat gets the selection, and Learn updates in the background.
    solverSelectionPending = true;
    vscode.postMessage({ type: 'captureSolverSelection' });
    $('result').textContent = 'Thinking locally…';
    vscode.postMessage({ type: 'explainSelection' });
    return;
  }
  applyMode('learn');
  $('result').textContent = 'Thinking locally…';
  vscode.postMessage({ type: 'explainSelection' });
});
on('reexplainBtn', 'click', () => vscode.postMessage({ type: 'explain' }));
on('helpBtn', 'click', () => vscode.postMessage({ type: 'help' }));
on('markBtn', 'click', () => vscode.postMessage({ type: 'mark', term: current.term, bottomLine: current.bottomLine }));
function setReadAloudState(active) {
  speaking = active;
  const btn = $('pipReadBtn');
  if (!btn) return;
  btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  btn.textContent = active ? '\u23F9' : '\uD83D\uDD0A';
  const label = active ? 'Stop reading aloud' : 'Read aloud (TTS)';
  btn.title = label;
  btn.setAttribute('aria-label', label);
}
on('pipReadBtn', 'click', () => {
  if (speaking) {
    vscode.postMessage({ type: 'stopSpeak' });
    setReadAloudState(false);
    return;
  }
  if (current.bottomLine) {
    vscode.postMessage({ type: 'speak', text: current.bottomLine, voice: $('voiceSelect')?.value || '' });
    setReadAloudState(true);
    setTimeout(() => setReadAloudState(false), 30000);
  }
});

function fillModelSelector(models, selected) {
  const select = $('pipModelSelector');
  if (!select || !Array.isArray(models) || !models.length) return;
  const prior = selected || select.value;
  select.replaceChildren();
  for (const name of models) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  }
  if (prior && [...select.options].some((o) => o.value === prior)) select.value = prior;
}
function updateModelMetrics(metrics = {}) {
  const bar = $('pipModelMetrics');
  if (!bar) return;
  const { tokensPerSecond, latencyMs } = metrics;
  if (tokensPerSecond == null && latencyMs == null) return;
  bar.hidden = false;
  if ($('pipMetricTps') && tokensPerSecond != null) $('pipMetricTps').textContent = `${Number(tokensPerSecond).toFixed(1)} tok/s`;
  if ($('pipMetricLatency') && latencyMs != null) $('pipMetricLatency').textContent = `${Math.round(latencyMs)} ms`;
}
function formatAiLabTelemetry(metrics = {}) {
  const bits = [];
  if (metrics.model) bits.push(metrics.model);
  if (metrics.tokensPerSecond != null) bits.push(`${Number(metrics.tokensPerSecond).toFixed(1)} tok/s`);
  if (metrics.latencyMs != null) bits.push(`${Math.round(metrics.latencyMs)} ms round-trip`);
  if (metrics.evalCount != null) bits.push(`${metrics.evalCount} eval tokens`);
  return bits.length ? bits.join(' \u00b7 ') : '';
}
function refreshAiLabTelemetry(metrics = {}) {
  const row = $('pipAiLabTelemetry');
  const line = formatAiLabTelemetry(metrics);
  if (!row || !line) return;
  row.hidden = false;
  row.textContent = line;
}
function aiLabPartRows(msg) {
  if (Array.isArray(msg.parts) && msg.parts.length) {
    return msg.parts.slice(0, 3).map((part, index) => ({
      title: part.title || `Part ${index + 1}`,
      body: part.body || '',
    }));
  }
  if (msg.explanation?.chunks?.length) {
    return msg.explanation.chunks.slice(0, 3).map((chunk, index) => ({
      title: chunk.title || `Part ${index + 1}`,
      body: chunk.body || '',
    }));
  }
  if (msg.card) {
    const rows = [
      { title: 'Core idea', body: msg.card.core },
      { title: 'Mechanism', body: msg.card.mechanism },
      { title: '15m experiment', body: msg.card.experiment },
    ];
    return rows.filter((row) => row.body);
  }
  return [];
}
function renderAiLabReply(msg) {
  setAiLabLoading(false);
  const out = $('pipAiLabOutput');
  if (!out) return;
  out.hidden = false;
  out.classList.remove('is-pulsing');
  out.removeAttribute('aria-busy');
  out.replaceChildren();
  const telemetry = { ...msg.telemetry, ...msg };
  if (telemetry.tokensPerSecond != null || telemetry.latencyMs != null) updateModelMetrics(telemetry);
  const headline = msg.headline || msg.explanation?.bottomLine || msg.bottomLine || '';
  const parts = aiLabPartRows(msg);
  if (!headline && !parts.length && msg.text) {
    out.textContent = msg.text;
    refreshAiLabTelemetry(telemetry);
    return;
  }
  const card = document.createElement('article');
  card.className = 'pip-ai-lab-card';
  if (headline) {
    const head = document.createElement('div');
    head.className = 'pip-ai-lab-card-head';
    head.appendChild(rich(headline, new Set()));
    card.appendChild(head);
  }
  const body = document.createElement('div');
  body.className = 'pip-ai-lab-card-parts';
  for (const part of parts) {
    const section = document.createElement('section');
    section.className = 'pip-ai-lab-part';
    const title = document.createElement('h4');
    title.className = 'pip-ai-lab-part-title';
    title.textContent = part.title;
    const copy = document.createElement('div');
    copy.className = 'pip-ai-lab-part-body';
    copy.appendChild(rich(part.body, new Set()));
    section.append(title, copy);
    body.appendChild(section);
  }
  card.appendChild(body);
  out.appendChild(card);
  const telem = document.createElement('div');
  telem.id = 'pipAiLabTelemetry';
  telem.className = 'pip-ai-lab-telemetry';
  telem.hidden = !formatAiLabTelemetry(telemetry);
  telem.textContent = formatAiLabTelemetry(telemetry);
  out.appendChild(telem);
}
function setAiLabLoading(active) {
  aiLabPending = active;
  const out = $('pipAiLabOutput');
  const submit = $('pipAiLabSubmit');
  if (submit) submit.disabled = active;
  document.querySelectorAll('.pip-chip').forEach((chip) => { chip.disabled = active; });
  if (!out) return;
  if (!active) {
    out.classList.remove('is-pulsing');
    out.removeAttribute('aria-busy');
    return;
  }
  out.hidden = false;
  out.classList.add('is-pulsing');
  out.setAttribute('aria-busy', 'true');
  out.replaceChildren();
  const pending = document.createElement('p');
  pending.className = 'pip-ai-lab-pending';
  pending.textContent = 'Exploring with your local model\u2026';
  const inline = document.createElement('div');
  inline.id = 'pipAiLabTelemetry';
  inline.className = 'pip-ai-lab-telemetry';
  inline.hidden = true;
  out.append(pending, inline);
  $('pipModelMetrics')?.removeAttribute('hidden');
}
function submitAiLabQuery(raw) {
  const query = String(raw || '').trim();
  if (!query || aiLabPending) return;
  setAiLabLoading(true);
  vscode.postMessage({
    type: 'askAiLab',
    query,
    model: $('pipModelSelector')?.value || '',
  });
}
on('pipAiLabSubmit', 'click', () => submitAiLabQuery($('pipAiLabInput')?.value));
on('pipAiLabInput', 'keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    submitAiLabQuery(e.target.value);
  }
});
document.querySelectorAll('.pip-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    const query = chip.getAttribute('data-query') || '';
    const input = $('pipAiLabInput');
    if (input) input.value = query;
    submitAiLabQuery(query);
  });
});
on('pipModelSelector', 'change', () => {
  vscode.postMessage({ type: 'setActiveModel', model: $('pipModelSelector')?.value || '' });
});
vscode.postMessage({ type: 'getAvailableModels' });
function submitDuck() {
  const input = $('duckInput');
  const statement = input.value.trim();
  if (!statement || duckPending) return;
  const log = $('duckLog');
  const mine = document.createElement('div');
  mine.className = 'muted';
  mine.textContent = `You: ${statement}`;
  const pending = document.createElement('div');
  pending.className = 'answer muted';
  pending.textContent = 'Checking your understanding locally…';
  log.append(mine, pending);
  log.setAttribute('aria-busy', 'true');
  const id = `duck-${++duckSequence}`;
  duckPending = { id, node: pending };
  input.value = '';
  input.disabled = true;
  $('duckSubmitBtn').disabled = true;
  vscode.postMessage({
    type: 'duck', id, statement,
    problem: $('solverProblem').value.trim(),
    errorText: $('solverError').value.trim(),
  });
}
on('duckSubmitBtn', 'click', submitDuck);
on('duckInput', 'keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) {
    e.preventDefault();
    submitDuck();
  }
});

/* Session-only timebox, with a finite completion cue and a remembered sound preference. */
let timerSoundEnabled = (vscode.getState?.() || {}).timerSoundEnabled !== false;
let timerAudio = null;
let timerPulse = null;
function refreshTimerSound() {
  const button = $('timerSoundBtn');
  if (!button) return;
  const label = timerSoundEnabled ? 'Mute timebox completion sound' : 'Enable timebox completion sound';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', String(!timerSoundEnabled));
  button.textContent = '♫';
  button.classList.toggle('soundMuted', !timerSoundEnabled);
}
function prepareTimerAudio() {
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!timerSoundEnabled || !Audio) return;
  try {
    timerAudio ||= new Audio();
    const resumed = timerAudio.resume?.();
    resumed?.catch?.(() => {});
  } catch { timerAudio = null; }
}
function finishTimebox() {
  const output = $('timerOut');
  output.textContent = 'Timebox complete';
  output.classList.add('timeboxComplete');
  clearTimeout(timerPulse);
  timerPulse = setTimeout(() => output.classList.remove('timeboxComplete'), 2600);
  if (!timerSoundEnabled || !timerAudio) return;
  try {
    const oscillator = timerAudio.createOscillator();
    const gain = timerAudio.createGain();
    const now = timerAudio.currentTime;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(660, now);
    oscillator.frequency.setValueAtTime(880, now + 0.16);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);
    oscillator.connect(gain); gain.connect(timerAudio.destination);
    oscillator.start(now); oscillator.stop(now + 0.38);
  } catch { /* The visible completion cue still works when audio is unavailable. */ }
}
on('timerSoundBtn', 'click', () => {
  timerSoundEnabled = !timerSoundEnabled;
  vscode.setState?.({ ...(vscode.getState?.() || {}), timerSoundEnabled });
  refreshTimerSound();
  if (timerSoundEnabled) prepareTimerAudio();
});
refreshTimerSound();
on('timerBtn', 'click', () => {
  if (timer) {
    clearInterval(timer); timer = null;
    $('timerBtn').textContent = 'Start';
    $('timerBtn').title = 'Start a new timebox for this session.';
    return;
  }
  clearTimeout(timerPulse);
  $('timerOut').classList.remove('timeboxComplete');
  prepareTimerAudio();
  remaining = Math.min(120, Math.max(1, Number($('timerMin').value) || 10)) * 60;
  $('timerBtn').textContent = 'Stop';
  $('timerBtn').title = 'Stop the current timebox.';
  $('timerOut').textContent = `${Math.ceil(remaining / 60)}:00 left`;
  timer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(timer); timer = null;
      $('timerBtn').textContent = 'Start';
      $('timerBtn').title = 'Start a new timebox for this session.';
      finishTimebox();
      return;
    }
    const minutes = Math.floor(remaining / 60), seconds = String(remaining % 60).padStart(2, '0');
    $('timerOut').textContent = `${minutes}:${seconds} left`;
  }, 1000);
});

describeControls();
if (typeof MutationObserver !== 'undefined' && document.body) {
  new MutationObserver(() => describeControls()).observe(document.body, { childList: true, subtree: true });
}


/* ---------- Solve chat: pair / vibe, repository-grounded replies, learn from any selection ---------- */
const chat = { mode: 'pair', turns: [], pending: null, seq: 0, picked: '' };
const CHAT_HINTS = {
  pair: 'Pair: PIP searches the repo, shows what it found, then asks you the next question instead of handing over the answer.',
  answer: 'Answer: replies to your latest question — use this for "how do I check that?" after Pair suggestions. Stays on the same anchored excerpt.',
};
function inlineMd(parent, text) {
  for (const part of text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/)) {
    if (!part) continue;
    if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
      const bold = document.createElement('strong');
      bold.textContent = part.slice(2, -2);
      parent.appendChild(bold);
    } else if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
      const code = document.createElement('code');
      code.textContent = part.slice(1, -1);
      parent.appendChild(code);
    } else {
      parent.appendChild(document.createTextNode(part));
    }
  }
}
/* Replies are markdown: code fences, bullet lists, **bold** and `code`. Built from DOM nodes, never innerHTML. */
function fillChat(node, text) {
  node.replaceChildren();
  String(text).split(/```[^\n]*\n?/).forEach((part, index) => {
    if (index % 2) {
      if (!part.trim()) return;
      const pre = document.createElement('pre');
      pre.textContent = part.replace(/\n$/, '');
      node.appendChild(pre);
      return;
    }
    let list = null;
    for (const raw of part.split('\n')) {
      const line = raw.trim();
      if (!line) { list = null; continue; }
      const bullet = /^[-*•]\s+(.*)$/.exec(line);
      if (bullet) {
        if (!list) { list = document.createElement('ul'); node.appendChild(list); }
        const item = document.createElement('li');
        inlineMd(item, bullet[1]);
        list.appendChild(item);
        continue;
      }
      list = null;
      const paragraph = document.createElement('p');
      inlineMd(paragraph, line);
      node.appendChild(paragraph);
    }
  });
}
function chatAppend(role, text) {
  const log = $('chatLog');
  if (!log) return null;
  const empty = log.querySelector('.cnvs-empty-state');
  if (empty) empty.remove();
  const node = document.createElement('div');
  node.className = `chatMsg chat-${role}`;
  if (role === 'user') {
    // Your message shrinks to a short bubble so the reply gets the space; click it to read it all.
    node.textContent = text;
    node.classList.add('chatClamp');
    node.onclick = () => node.classList.toggle('chatOpen');
  } else {
    fillChat(node, text);
  }
  log.appendChild(node);
  log.scrollTop = log.scrollHeight;
  return node;
}
let pendingPasteAsk = null;

function pinnedExcerpt() {
  return codeCtx && codeCtx.file === 'Solve chat' ? codeCtx.selection : '';
}

function dispatchChat(text) {
  const input = $('chatInput');
  if (!text || chat.pending) return;
  const history = chat.turns.slice(-6);
  chatAppend('user', text);
  chat.turns.push({ role: 'user', text });
  if (input) input.value = '';
  const id = `chat-${++chat.seq}`;
  const node = chatAppend('assistant', 'Searching the repository…');
  node.classList.add('muted');
  chat.pending = { id, node };
  $('chatSendBtn').disabled = true;
  vscode.postMessage({ type: 'chat', id, text, mode: chat.mode, history });
}

function sendChat() {
  const input = $('chatInput');
  const text = input ? input.value.trim() : '';
  const excerpt = $('cursorPasteExcerpt') ? $('cursorPasteExcerpt').value.trim() : '';
  const status = $('cursorPasteStatus');
  if (!text && !excerpt) return;
  if (excerpt && !text) {
    if (status) status.textContent = 'Type your question in the box above, then press send (↑). Context is optional below.';
    return;
  }
  if (chat.pending) return;
  const pinned = pinnedExcerpt();
  const needsLoad = excerpt && excerpt.slice(0, 3000) !== pinned;
  if (needsLoad) {
    if (pinned) {
      chat.turns = [];
      chat.pending = null;
      if ($('chatLog')) $('chatLog').replaceChildren();
      if ($('chatSendBtn')) $('chatSendBtn').disabled = false;
    }
    pendingPasteAsk = { text };
    if (status) status.textContent = 'Loading excerpt…';
    vscode.postMessage({ type: 'pasteFromCursor', excerpt, question: text });
    return;
  }
  dispatchChat(text);
}
on('chatSendBtn', 'click', sendChat);
on('chatInput', 'keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendChat(); }
});
on('chatClearBtn', 'click', () => {
  chat.turns = [];
  chat.pending = null;
  pendingPasteAsk = null;
  if ($('chatLog')) $('chatLog').replaceChildren();
  if ($('chatSendBtn')) $('chatSendBtn').disabled = false;
  vscode.postMessage({ type: 'chatClear' });
});
on('cursorPasteExcerpt', 'input', () => {
  vscode.setState?.({ ...(vscode.getState?.() || {}), cursorPaste: { excerpt: $('cursorPasteExcerpt')?.value || '' } });
});
const initialPaste = vscode.getState?.()?.cursorPaste || {};
if ($('cursorPasteExcerpt') && initialPaste.excerpt) $('cursorPasteExcerpt').value = initialPaste.excerpt;
function setChatMode(mode) {
  chat.mode = mode === 'answer' ? 'answer' : 'pair';
  if ($('chatModeSwitch')) $('chatModeSwitch').setAttribute('aria-checked', String(chat.mode === 'answer'));
  if ($('chatModePair')) $('chatModePair').classList.toggle('isActive', chat.mode === 'pair');
  if ($('chatModeVibe')) $('chatModeVibe').classList.toggle('isActive', chat.mode === 'answer');
  const hint = $('chatModeHint');
  if (hint) hint.textContent = CHAT_HINTS[chat.mode] || '';
}
on('chatModeSwitch', 'click', () => {
  setChatMode(chat.mode === 'answer' ? 'pair' : 'answer');
});
/* Select text in a reply, then press Learn under the chat to explain it in the panel beside the editor. */
on('chatLog', 'mouseup', () => {
  const picked = String(window.getSelection?.()?.toString() || '').trim();
  if (picked.length >= 3) chat.picked = picked.slice(0, 1500);
});
/* The same problem, seen another way. */
/* Whatever you selected, typed or last asked travels with you to the other tabs. */
function chatProblem() {
  if (chat.picked) return chat.picked;
  const typed = $('chatInput') ? $('chatInput').value.trim() : '';
  if (typed) return typed;
  const last = [...chat.turns].reverse().find((turn) => turn.role === 'user');
  return last ? last.text : '';
}
on('chatVisualiseBtn', 'click', () => {
  const text = chatProblem();
  if (text) vscode.postMessage({ type: 'chatContext', text });
  $('diagram').textContent = 'Reading the code from your chat…';
  applyMode('visualise');
  vscode.postMessage({ type: 'visualiseSelection' });
});
on('chatIdeateBtn', 'click', () => {
  const text = chatProblem();
  const box = $('ideaOwn');
  if (text) {
    vscode.postMessage({ type: 'chatContext', text });
    if ($('ideaContext')) $('ideaContext').textContent = `Working on: ${text.replace(/\s+/g, ' ').slice(0, 160)}`;
    if (box && !box.value) box.placeholder = 'Your own idea for this problem…';
  }
  applyMode('create');
});
on('chatReviewBtn', 'click', () => {
  const text = chatProblem();
  const last = [...chat.turns].reverse().find((turn) => turn.role === 'assistant');
  if (text) {
    const plain = (value) => value.replace(/```[\s\S]*?```/g, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
    // The coach's questions and hypotheses are prompts, not a takeaway worth drilling: keep the problem itself instead.
    const coached = last && /^(Think about|Hypotheses to test)/.test(plain(last.text));
    const takeaway = last && !coached ? plain(last.text) : text.replace(/\s+/g, ' ').trim();
    const title = text.replace(/^[\s"'`]+/, '').replace(/\s+/g, ' ').slice(0, 60);
    vscode.postMessage({ type: 'chatContext', text });
    vscode.postMessage({ type: 'mark', term: title, bottomLine: takeaway.slice(0, 240) });
  }
  applyMode('review');
});
on('chatHandoffBtn', 'click', () => {
  const first = chat.turns.find((turn) => turn.role === 'user');
  if (!first) { chatAppend('assistant', 'Describe the problem first. The hand-off includes what you have worked out here.'); return; }
  vscode.postMessage({ type: 'handoff', problem: first.text, turns: chat.turns.slice(-8) });
});
on('chatOpenLearnBtn', 'click', () => {
  const text = chatProblem();
  if (text) {
    $('result').textContent = 'Thinking locally…';
    vscode.postMessage({ type: 'chatToLearn', text });
    chat.picked = '';
  }
  applyMode('learn');
});

/* ---------- Ideate: the engineer's idea first; PIP only questions it ---------- */
let ideaChallengeSeq = 0;
on('ideaChallengeBtn', 'click', () => {
  const idea = $('ideaOwn') ? $('ideaOwn').value.trim() : '';
  if (!idea) return;
  $('ideaChallengeOut').textContent = 'Questioning your idea locally…';
  vscode.postMessage({ type: 'challengeIdea', id: `idea-${++ideaChallengeSeq}`, idea });
});
function renderChallenge(msg) {
  const host = $('ideaChallengeOut');
  if (!host) return;
  host.replaceChildren();
  if (msg.fromMock || (!msg.questions.length && !msg.assumption)) {
    host.textContent = 'The local model is unavailable or gave no usable challenge. Try again.';
    return;
  }
  const line = (label, text) => {
    const row = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = `${label} `;
    row.append(strong, document.createTextNode(text));
    host.appendChild(row);
  };
  if (msg.assumption) line('Your idea assumes:', msg.assumption);
  if (msg.known && msg.known.length) {
    const heading = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = 'The repository already shows:';
    heading.appendChild(strong);
    host.appendChild(heading);
    const facts = document.createElement('ul');
    for (const fact of msg.known) { const item = document.createElement('li'); item.textContent = fact; facts.appendChild(item); }
    host.appendChild(facts);
  }
  const list = document.createElement('ol');
  for (const question of msg.questions) {
    const item = document.createElement('li');
    item.textContent = question;
    list.appendChild(item);
  }
  host.appendChild(list);
  if (msg.counter) line('It could fail if:', msg.counter);
  const checked = document.createElement('div');
  checked.className = 'chatSources muted';
  if (msg.searched && msg.searched.length) checked.append(`Searched the repository for: ${msg.searched.join(', ')}. `);
  for (const source of msg.sources || []) {
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'chatSource';
    open.textContent = `${String(source.file).split('/').pop()}:${source.line}`;
    open.onclick = () => vscode.postMessage({ type: 'openChatSource', file: source.file, line: source.line });
    checked.appendChild(open);
  }
  if (checked.childNodes.length) host.appendChild(checked);
  const next = document.createElement('p');
  next.className = 'muted';
  next.textContent = 'Answer these in your own words, refine the idea above, then challenge it again.';
  host.appendChild(next);
}

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg) return;
  if (msg.type === 'chatStatus' && chat.pending && chat.pending.id === msg.id) {
    chat.pending.node.textContent = msg.text;
  } else if (msg.type === 'chatReply' && chat.pending && chat.pending.id === msg.id) {
    const node = chat.pending.node;
    node.classList.remove('muted');
    fillChat(node, msg.text);
    chat.turns.push({ role: 'assistant', text: msg.text });
    const foot = document.createElement('div');
    foot.className = 'chatSources muted';
    if (msg.anchor) foot.append(`About ${msg.anchor}. `);
    if (msg.engagement) {
      const engage = document.createElement('div');
      engage.className = 'chatEngagement muted';
      engage.textContent = `Try it yourself: ${msg.engagement}`;
      node.appendChild(engage);
    }
    if (msg.searched && msg.searched.length) foot.append(`Searched for: ${msg.searched.join(', ')}. `);
    const found = document.createElement('div');
    found.className = 'chatSources muted';
    for (const fact of msg.facts || []) {
      const row = document.createElement('div');
      row.textContent = fact.files.length ? `${fact.term}: ${fact.lines} line(s) in ${fact.files.length} file(s)` : `${fact.term}: not found in the searched files`;
      found.appendChild(row);
    }
    if (found.childNodes.length) node.appendChild(found);
    for (const source of msg.sources || []) {
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'chatSource';
      open.textContent = `${String(source.file).split('/').pop()}:${source.line}`;
      open.setAttribute('aria-label', `Open ${source.file} line ${source.line}`);
      open.onclick = () => vscode.postMessage({ type: 'openChatSource', file: source.file, line: source.line });
      foot.appendChild(open);
    }
    for (const edit of msg.proposals || []) {
      const box = document.createElement('div');
      box.className = 'editProposal';
      const head = document.createElement('strong');
      head.textContent = edit.file;
      const diff = document.createElement('pre');
      diff.className = 'editDiff';
      const removed = edit.find.split('\n').map((line) => `- ${line}`).join('\n');
      const added = edit.replace ? edit.replace.split('\n').map((line) => `+ ${line}`).join('\n') : '';
      diff.textContent = added ? `${removed}\n${added}` : removed;
      const status = document.createElement('div');
      status.className = 'muted';
      status.textContent = edit.ok ? 'Nothing is written until you click Apply.' : `Cannot apply: ${edit.reason}`;
      const row = document.createElement('div');
      row.className = 'row';
      const apply = document.createElement('button');
      apply.type = 'button';
      apply.textContent = 'Apply';
      apply.disabled = !edit.ok;
      apply.onclick = () => {
        apply.disabled = true;
        status.textContent = 'Applying…';
        chat.edits = chat.edits || {};
        chat.edits[edit.id] = status;
        vscode.postMessage({ type: 'applyEdit', id: edit.id });
      };
      const reject = document.createElement('button');
      reject.type = 'button';
      reject.textContent = 'Reject';
      reject.onclick = () => { vscode.postMessage({ type: 'rejectEdit', id: edit.id }); box.remove(); };
      row.append(apply, reject);
      box.append(head, diff, status, row);
      node.appendChild(box);
    }
    node.appendChild(foot);
    chat.pending = null;
    $('chatSendBtn').disabled = false;
  } else if (msg.type === 'handoffResult') {
    chatAppend('assistant', msg.text);
  } else if (msg.type === 'pasteResult') {
    const status = $('cursorPasteStatus');
    if (status) {
      status.textContent = msg.ok
        ? `Loaded: ${msg.label || 'Solve chat'} · ${msg.chars} chars`
        : String(msg.text || 'Could not load excerpt.');
    }
    if (msg.ok && pendingPasteAsk) {
      const ask = pendingPasteAsk.text;
      pendingPasteAsk = null;
      dispatchChat(ask);
    }
  } else if (msg.type === 'editResult') {
    const status = chat.edits && chat.edits[msg.id];
    if (status) status.textContent = msg.text;
  } else if (msg.type === 'semanticStatus') {
    if ($('semanticStatus')) $('semanticStatus').textContent = msg.text;
  } else if (msg.type === 'challengeStatus') {
    if ($('ideaChallengeOut')) $('ideaChallengeOut').textContent = msg.text;
  } else if (msg.type === 'challengeReply') {
    renderChallenge(msg);
  } else if ((msg.type === 'marked' || msg.type === 'markRefused') && activeMode === 'solve' && $('chatLog')) {
    chatAppend('assistant', msg.type === 'marked' ? `Kept "${msg.term}" in Review.` : msg.text);
  }
});
