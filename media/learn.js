/* Learn UI. Word click = small popup (one-line answers). Nothing replaces
   the original explanation. Diagrams have per-type layouts. */
const vscode = acquireVsCodeApi();
window.pipPost = (msg) => vscode.postMessage(msg);

let codeCtx = null;
let current = { term: '', bottomLine: '' };
let keywordSet = new Set();
let diagrams = null;
let diagramType = 'dataFlow';
let popupWord = '';
let speaking = false;
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

/* ---------- Word popup: disposable, one-line, follow-ups one-line ---------- */
function openPopup(word, x, y) {
  popupWord = word;
  const popup = $('wordPopup');
  $('wordPopupTitle').textContent = word;
  $('wordPopupBody').textContent = 'Thinking locally…';
  popup.classList.remove('hidden');
  const width = 320;
  popup.style.left = `${Math.max(4, Math.min(x, window.innerWidth - width - 8))}px`;
  popup.style.top = `${Math.max(4, y + 8)}px`;
  vscode.postMessage({ type: 'popupExplain', word });
  $('wordPopupInput').focus();
}
function closePopup() {
  $('wordPopup').classList.add('hidden');
}
on('wordPopupClose', 'click', closePopup);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePopup();
});
document.addEventListener('click', (e) => {
  const popup = $('wordPopup');
  if (!popup.classList.contains('hidden') && !popup.contains(e.target) && !e.target.classList?.contains('word')) {
    closePopup();
  }
});
on('wordPopupInput', 'keydown', (e) => {
  if (e.key === 'Enter' && e.target.value.trim()) {
    $('wordPopupBody').textContent = 'Thinking locally…';
    vscode.postMessage({ type: 'popupAsk', word: popupWord, question: e.target.value.trim() });
    e.target.value = '';
  }
});

/* ---------- Rich text: **bold**, *italic*, `code`; keywords only ---------- */
function wordNode(word, set) {
  const clean = norm(word);
  if (clean && set.has(clean)) {
    const span = document.createElement('span');
    span.className = 'word';
    span.textContent = word;
    span.title = 'One-line popup explanation';
    span.onclick = (e) => openPopup(clean, e.clientX, e.clientY);
    return span;
  }
  return document.createTextNode(word);
}
function rich(text, set) {
  const frag = document.createDocumentFragment();
  for (const part of String(text).split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*)/g)) {
    if (!part) continue;
    if (part.startsWith('`') && part.endsWith('`')) {
      const span = document.createElement('span');
      span.className = 'code word';
      span.textContent = part.slice(1, -1);
      span.title = 'One-line popup explanation';
      span.onclick = (e) => openPopup(norm(part), e.clientX, e.clientY);
      frag.appendChild(span);
    } else if (part.startsWith('**')) {
      const strong = document.createElement('strong');
      strong.className = 'hl';
      strong.textContent = part.slice(2, -2);
      frag.appendChild(strong);
    } else if (part.startsWith('*')) {
      const em = document.createElement('em');
      em.textContent = part.slice(1, -1);
      frag.appendChild(em);
    } else {
      for (const piece of part.split(/(\s+)/)) {
        frag.appendChild(/^\s+$/.test(piece) ? document.createTextNode(piece) : wordNode(piece, set));
      }
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
    term: msg.focus || (codeCtx ? codeCtx.selection.split('\n')[0].trim().slice(0, 60) : 'concept'),
    bottomLine: msg.explanation.bottomLine,
  };
  if ($('hint')) {
    $('hint').classList.toggle('hidden', !msg.hint);
    if (msg.hint) {
      $('hint').textContent = `You marked something like this before: "${msg.hint.term}" — ${msg.hint.bottomLine} (${msg.hint.file}:${msg.hint.line})`;
    }
  }
  const result = $('result');
  result.replaceChildren();
  result.appendChild(explanationBody(msg.explanation, set));
  if (msg.explanation.repaired) {
    const note = document.createElement('div');
    note.className = 'muted';
    note.textContent = 'Evaluator trimmed the model output to keep it chunk-sized.';
    result.appendChild(note);
  }
  if (msg.diagrams) {
    diagrams = msg.diagrams;
    renderDiagram();
  }
}

/* ---------- Diagrams: a different layout per kind ---------- */
const KIND_RANK = { endpoint: 0, method: 1, param: 2, hook: 3, state: 3, branch: 4, call: 5, import: 6, return: 7, assert: 7 };
const LAYER_OF = { endpoint: 'core', method: 'core', return: 'core', branch: 'core', assert: 'core', call: 'calls', import: 'imports', param: 'params', hook: 'hooks', state: 'hooks' };
const SVGNS = 'http://www.w3.org/2000/svg';

function svgNode(node, cx, cy, w) {
  const g = document.createElementNS(SVGNS, 'g');
  g.setAttribute('class', `node kind-${node.kind}`);
  g.style.cursor = 'pointer';
  const rect = document.createElementNS(SVGNS, 'rect');
  rect.setAttribute('x', cx - w / 2); rect.setAttribute('y', cy - 19);
  rect.setAttribute('width', w); rect.setAttribute('height', 38); rect.setAttribute('rx', 6);
  const kind = document.createElementNS(SVGNS, 'text');
  kind.setAttribute('x', cx); kind.setAttribute('y', cy - 3);
  kind.setAttribute('text-anchor', 'middle'); kind.setAttribute('class', 'nodeKind');
  kind.textContent = node.kind.toUpperCase();
  const text = document.createElementNS(SVGNS, 'text');
  text.setAttribute('x', cx); text.setAttribute('y', cy + 12);
  text.setAttribute('text-anchor', 'middle'); text.setAttribute('class', 'nodeLabel');
  const max = Math.floor(w / 7);
  text.textContent = node.label.length > max ? `${node.label.slice(0, max - 1)}…` : node.label;
  g.append(rect, kind, text);
  g.onclick = (e) => openPopup(node.detail, e.clientX, e.clientY);
  return g;
}
function svgArrow(svg, x1, y1, x2, y2) {
  const line = document.createElementNS(SVGNS, 'line');
  line.setAttribute('x1', x1); line.setAttribute('y1', y1);
  line.setAttribute('x2', x2); line.setAttribute('y2', y2);
  line.setAttribute('class', 'edge');
  const head = document.createElementNS(SVGNS, 'path');
  head.setAttribute('d', `M ${x2 - 4} ${y2 - 5} L ${x2} ${y2} L ${x2 + 4} ${y2 - 5}`);
  head.setAttribute('class', 'edge');
  svg.append(line, head);
}
function makeSvg(w, h) {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('class', 'diagramSvg');
  return svg;
}

function visibleNodes() {
  const diagram = diagrams?.[diagramType];
  if (!diagram) return [];
  const enabled = new Set([...document.querySelectorAll('.layerToggle:checked')].map((b) => b.getAttribute('data-layer')));
  enabled.add('core');
  return diagram.nodes
    .filter((n) => enabled.has(LAYER_OF[n.kind] || 'core'))
    .sort((a, b) => (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9));
}

function renderDiagram() {
  const host = $('diagram');
  if (!host || !diagrams) return;
  const nodes = visibleNodes();
  host.replaceChildren();
  if (!nodes.length) {
    host.textContent = 'Nothing in this view for this selection — try Data flow.';
    return;
  }
  let svg;
  if (diagramType === 'architecture' && nodes.length > 1) {
    // Hub-and-spoke: the method in the centre, dependencies around it.
    const centre = nodes.find((n) => n.kind === 'method' || n.kind === 'endpoint') || nodes[0];
    const spokes = nodes.filter((n) => n !== centre).slice(0, 6);
    const W = 340;
    const H = Math.max(210, spokes.length * 8 + 190);
    svg = makeSvg(W, H);
    const cx = W / 2;
    const cy = H / 2;
    spokes.forEach((node, i) => {
      const angle = (i / Math.max(1, spokes.length)) * Math.PI * 2 - Math.PI / 2;
      const x = cx + Math.cos(angle) * 108;
      const y = cy + Math.sin(angle) * (H / 2 - 34);
      svgArrow(svg, cx, cy, x, y);
      svg.appendChild(svgNode(node, x, y, 118));
    });
    svg.appendChild(svgNode(centre, cx, cy, 150));
  } else if (diagramType === 'testing') {
    // Horizontal: Arrange -> Act -> branches fan out -> Assert
    const W = 340;
    const rows = Math.max(1, nodes.length);
    svg = makeSvg(W, rows * 54 + 16);
    nodes.forEach((node, i) => {
      const y = 27 + i * 54;
      if (i > 0) svgArrow(svg, 60, y - 34, 60, y - 19);
      svg.appendChild(svgNode(node, 170, y, 260));
    });
  } else {
    // Data flow: vertical flow
    const W = 340;
    svg = makeSvg(W, nodes.length * 56 + 12);
    nodes.forEach((node, i) => {
      const y = 27 + i * 56;
      if (i > 0) svgArrow(svg, W / 2, y - 27, W / 2, y - 19);
      svg.appendChild(svgNode(node, W / 2, y, 280));
    });
  }
  host.appendChild(svg);
}
document.querySelectorAll('.diagramTypeBtn').forEach((btn) =>
  btn.addEventListener('click', () => {
    diagramType = btn.getAttribute('data-type');
    document.querySelectorAll('.diagramTypeBtn').forEach((b) => b.classList.toggle('isActive', b === btn));
    renderDiagram();
  }),
);
document.querySelectorAll('.layerToggle').forEach((box) => box.addEventListener('change', renderDiagram));

/* ---------- Voice ranking ---------- */
function bestVoice(voices) {
  const rank = (v) => {
    const n = `${v.name} ${v.lang}`.toLowerCase();
    let s = 0;
    if (n.includes('premium')) s += 9;
    if (n.includes('natural') || n.includes('neural') || n.includes('enhanced')) s += 8;
    if (/\b(flo|eddy|reed)\b/.test(n)) s += 7;
    if (n.includes('serena') || n.includes('kate')) s += 4;
    if (n.includes('en-gb') || n.includes('united kingdom')) s += 2;
    if (n.includes('samantha')) s -= 2;
    return s;
  };
  return [...voices].sort((a, b) => rank(b) - rank(a))[0];
}
function fillVoices() {
  const select = $('voiceSelect');
  if (!select || !window.speechSynthesis) return;
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return;
  const chosen = bestVoice(voices);
  select.replaceChildren();
  for (const v of voices.filter((x) => x.lang.startsWith('en'))) {
    const opt = document.createElement('option');
    opt.value = v.name;
    opt.textContent = v.name;
    if (chosen && v.name === chosen.name) opt.selected = true;
    select.appendChild(opt);
  }
}
if (window.speechSynthesis) {
  speechSynthesis.onvoiceschanged = fillVoices;
  fillVoices();
}

/* ---------- Messages ---------- */
window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'context') {
    codeCtx = msg.context;
  } else if (msg.type === 'diagrams') {
    diagrams = msg.diagrams;
    renderDiagram();
  } else if (msg.type === 'explanation') {
    renderExplanation(msg);
  } else if (msg.type === 'marked') {
    const note = document.createElement('div');
    note.className = 'hint';
    note.textContent = `Marked "${msg.term}" — see Flashcards & Drill below (${msg.count} total).`;
    $('result').prepend(note);
  } else if (msg.type === 'popupAnswer') {
    if (!$('wordPopup').classList.contains('hidden')) {
      const body = $('wordPopupBody');
      body.replaceChildren(rich(msg.text, keywordSet));
    }
  } else if (msg.type === 'answer') {
    // Rubber-duck replies land in the top duck log, as a conversation.
    const log = $('duckLog');
    const div = document.createElement('div');
    div.className = 'answer';
    div.appendChild(rich(msg.text, keywordSet));
    log.appendChild(div);
  } else if (msg.type === 'stat') {
    if ($('stats')) $('stats').textContent = msg.text;
  }
});

/* ---------- Controls ---------- */
on('explainBtn', 'click', () => {
  $('result').textContent = 'Thinking locally…';
  vscode.postMessage({ type: 'explainSelection' });
});
on('openBesideBtn', 'click', () => vscode.postMessage({ type: 'openBeside' }));
on('reexplainBtn', 'click', () => vscode.postMessage({ type: 'explain' }));
on('helpBtn', 'click', () => vscode.postMessage({ type: 'help' }));
on('markBtn', 'click', () => vscode.postMessage({ type: 'mark', term: current.term, bottomLine: current.bottomLine }));
on('speakBtn', 'click', (e) => {
  if (speaking) {
    vscode.postMessage({ type: 'stopSpeak' });
    speaking = false;
    e.target.textContent = 'Read aloud';
    return;
  }
  if (current.bottomLine) {
    vscode.postMessage({ type: 'speak', text: current.bottomLine, voice: $('voiceSelect')?.value || '' });
    speaking = true;
    e.target.textContent = 'Stop reading';
    setTimeout(() => {
      speaking = false;
      const btn = $('speakBtn');
      if (btn) btn.textContent = 'Read aloud';
    }, 30000);
  }
});
on('duckInput', 'keydown', (e) => {
  if (e.key === 'Enter' && e.target.value.trim()) {
    const mine = document.createElement('div');
    mine.className = 'muted';
    mine.textContent = `You: ${e.target.value.trim()}`;
    $('duckLog').appendChild(mine);
    vscode.postMessage({ type: 'duck', statement: e.target.value.trim() });
    e.target.value = '';
  }
});

/* Session-only timebox — at the top again, never saved */
on('timerBtn', 'click', () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
    $('timerBtn').textContent = 'Start';
    return;
  }
  remaining = Math.max(1, Number($('timerMin').value) || 10) * 60;
  $('timerBtn').textContent = 'Stop';
  timer = setInterval(() => {
    remaining -= 1;
    const m = Math.floor(Math.max(0, remaining) / 60);
    const s = String(Math.max(0, remaining) % 60).padStart(2, '0');
    $('timerOut').textContent = remaining >= 0 ? `${m}:${s} left` : 'Timebox over — wrap up, or consciously extend.';
    if (remaining < 0) {
      clearInterval(timer);
      timer = null;
      $('timerBtn').textContent = 'Start';
    }
  }, 1000);
});
