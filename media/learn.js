/* Shared Learn UI for the beside panel and the PIP sidebar. Plain text styling,
   black-on-white / white-on-black, no decoration for its own sake. */
const vscode = acquireVsCodeApi();
window.pipPost = (msg) => vscode.postMessage(msg);

let codeCtx = null;
let current = { term: '', bottomLine: '', depth: 0 };
let trail = [];
let keywordSet = new Set();
let diagram = null;
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

function wordNode(word) {
  const clean = norm(word);
  if (clean && keywordSet.has(clean)) {
    const span = document.createElement('span');
    span.className = 'word';
    span.textContent = word;
    span.title = 'Explain this term';
    span.onclick = () => {
      if (current.depth < 3) {
        vscode.postMessage({ type: 'explainWord', word: clean, depth: current.depth + 1 });
      }
    };
    return span;
  }
  return document.createTextNode(word);
}

/** Renders **bold**, *italic* and `code`; only keywords are clickable. */
function rich(text) {
  const frag = document.createDocumentFragment();
  const parts = String(text).split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*)/g);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('`') && part.endsWith('`')) {
      const span = document.createElement('span');
      span.className = 'code word';
      span.textContent = part.slice(1, -1);
      span.title = 'Explain this term';
      span.onclick = () => {
        if (current.depth < 3) {
          vscode.postMessage({ type: 'explainWord', word: norm(part), depth: current.depth + 1 });
        }
      };
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
        frag.appendChild(/^\s+$/.test(piece) ? document.createTextNode(piece) : wordNode(piece));
      }
    }
  }
  return frag;
}

function renderExplanation(msg) {
  current = {
    term: msg.focus || (codeCtx ? codeCtx.selection.split('\n')[0].trim().slice(0, 60) : 'concept'),
    bottomLine: msg.explanation.bottomLine,
    depth: msg.depth || 0,
  };
  keywordSet = new Set((msg.keywords || []).map((k) => String(k).toLowerCase()));
  trail = msg.depth === 0 ? [current.term] : [...trail, current.term];
  if ($('trail')) {
    $('trail').textContent = trail.length > 1 ? `Digging: ${trail.join(' → ')} (depth ${current.depth}/3)` : '';
  }
  if ($('hint')) {
    $('hint').classList.toggle('hidden', !msg.hint);
    if (msg.hint) {
      $('hint').textContent = `You marked something like this before: "${msg.hint.term}" — ${msg.hint.bottomLine} (${msg.hint.file}:${msg.hint.line})`;
    }
  }
  const result = $('result');
  result.replaceChildren();
  const bottom = document.createElement('div');
  bottom.className = 'bottomline';
  bottom.appendChild(rich(msg.explanation.bottomLine));
  result.appendChild(bottom);
  if (msg.explanation.repaired) {
    const note = document.createElement('div');
    note.className = 'muted';
    note.textContent = 'Evaluator trimmed the model output to keep it chunk-sized.';
    result.appendChild(note);
  }
  for (const chunk of msg.explanation.chunks) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = chunk.title;
    const body = document.createElement('div');
    body.appendChild(rich(chunk.body));
    details.append(summary, body);
    result.appendChild(details);
  }
  if ($('status')) $('status').textContent = '';
  if (msg.diagram) {
    diagram = msg.diagram;
    renderDiagram();
  }
}

/* ---- Systematic diagram: layer toggles turn parts of the system on/off ---- */
const KIND_RANK = { endpoint: 0, method: 1, param: 2, hook: 3, state: 3, call: 4, import: 5, return: 6 };
const LAYER_OF = { endpoint: 'core', method: 'core', return: 'core', call: 'calls', import: 'imports', param: 'params', hook: 'hooks', state: 'hooks' };

function renderDiagram() {
  const host = $('diagram');
  if (!host || !diagram) return;
  const enabled = new Set(
    [...document.querySelectorAll('.layerToggle:checked')].map((b) => b.getAttribute('data-layer')),
  );
  enabled.add('core');
  const nodes = diagram.nodes
    .filter((n) => enabled.has(LAYER_OF[n.kind] || 'core'))
    .sort((a, b) => (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9));
  host.replaceChildren();
  if (nodes.length === 0) return;
  const W = 340;
  const H = nodes.length * 56 + 12;
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'diagramSvg');
  nodes.forEach((node, i) => {
    const y = 8 + i * 56;
    if (i > 0) {
      const line = document.createElementNS(svgNS, 'line');
      line.setAttribute('x1', W / 2);
      line.setAttribute('y1', y - 18);
      line.setAttribute('x2', W / 2);
      line.setAttribute('y2', y);
      line.setAttribute('class', 'edge');
      svg.appendChild(line);
      const head = document.createElementNS(svgNS, 'path');
      head.setAttribute('d', `M ${W / 2 - 4} ${y - 5} L ${W / 2} ${y} L ${W / 2 + 4} ${y - 5}`);
      head.setAttribute('class', 'edge');
      svg.appendChild(head);
    }
    const g = document.createElementNS(svgNS, 'g');
    g.setAttribute('class', `node kind-${node.kind}`);
    g.style.cursor = 'pointer';
    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('x', 30);
    rect.setAttribute('y', y);
    rect.setAttribute('width', W - 60);
    rect.setAttribute('height', 38);
    rect.setAttribute('rx', 6);
    const label = document.createElementNS(svgNS, 'text');
    label.setAttribute('x', W / 2);
    label.setAttribute('y', y + 16);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('class', 'nodeKind');
    label.textContent = node.kind.toUpperCase();
    const text = document.createElementNS(svgNS, 'text');
    text.setAttribute('x', W / 2);
    text.setAttribute('y', y + 31);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('class', 'nodeLabel');
    text.textContent = node.label.length > 36 ? `${node.label.slice(0, 35)}…` : node.label;
    g.append(rect, label, text);
    g.onclick = () => {
      if (current.depth < 3) {
        vscode.postMessage({ type: 'explainWord', word: node.detail, depth: current.depth + 1 });
      }
    };
    svg.appendChild(g);
  });
  host.appendChild(svg);
}

/* ---- Voice: pick the least robotic local voice available ---- */
function bestVoice(voices) {
  const rank = (v) => {
    const n = `${v.name} ${v.lang}`.toLowerCase();
    let s = 0;
    if (n.includes('natural')) s += 6;
    if (n.includes('neural') || n.includes('premium') || n.includes('enhanced')) s += 5;
    if (n.includes('google uk english female')) s += 5;
    if (n.includes('samantha') || n.includes('serena') || n.includes('kate')) s += 4;
    if (n.includes('en-gb')) s += 2;
    if (n.includes('en')) s += 1;
    if (n.includes('compact') || n.includes('eloquence')) s -= 3;
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

/* ---- Messages from the extension host ---- */
window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'context') {
    codeCtx = msg.context;
    trail = [];
    if ($('where')) {
      $('where').textContent = `${codeCtx.file}:${codeCtx.line} · ${codeCtx.language} — Explain when ready.`;
    }
  } else if (msg.type === 'diagram') {
    diagram = msg.diagram;
    renderDiagram();
  } else if (msg.type === 'explanation') {
    renderExplanation(msg);
  } else if (msg.type === 'status') {
    if ($('status')) $('status').textContent = msg.text;
  } else if (msg.type === 'marked') {
    if ($('status')) {
      $('status').textContent = `Marked "${msg.term}" — ${msg.count} flashcard(s) in the Flashcards section below.`;
    }
  } else if (msg.type === 'answer') {
    const host = $('askResult');
    host.replaceChildren();
    const div = document.createElement('div');
    div.className = 'answer';
    const label = document.createElement('strong');
    label.textContent = `${msg.kind}: `;
    div.append(label, rich(msg.text));
    host.appendChild(div);
  } else if (msg.type === 'stat') {
    if ($('stats')) $('stats').textContent = msg.text;
  }
});

/* ---- Controls ---- */
on('explainBtn', 'click', () => vscode.postMessage({ type: 'explainSelection' }));
on('openBesideBtn', 'click', () => vscode.postMessage({ type: 'openBeside' }));
on('reexplainBtn', 'click', () => vscode.postMessage({ type: 'explain' }));
on('helpBtn', 'click', () => vscode.postMessage({ type: 'help' }));
on('markBtn', 'click', () =>
  vscode.postMessage({ type: 'mark', term: current.term, bottomLine: current.bottomLine }),
);
on('speakBtn', 'click', () => {
  if (current.bottomLine && window.speechSynthesis) {
    speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(current.bottomLine);
    const voices = speechSynthesis.getVoices();
    const picked =
      voices.find((v) => $('voiceSelect') && v.name === $('voiceSelect').value) || bestVoice(voices);
    if (picked) utter.voice = picked;
    utter.rate = 1.02;
    utter.pitch = 1.0;
    speechSynthesis.speak(utter);
  }
});
on('quickBtn', 'click', () =>
  vscode.postMessage({ type: 'quick', question: $('askInput').value || 'What does this code do?' }),
);
on('duckBtn', 'click', () =>
  vscode.postMessage({
    type: 'duck',
    statement: $('askInput').value || 'I think this code is where the behaviour changes.',
  }),
);
document.querySelectorAll('.layerToggle').forEach((box) => box.addEventListener('change', renderDiagram));

/* Session-only timebox: this page's memory only, never posted, never saved.
   In the sidebar the webview is retained, so it survives hopping between files. */
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
