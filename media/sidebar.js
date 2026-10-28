/* Flashcards & Drill (one combined collapsible section in the sidebar). */
const pipPost = (msg) => window.pipPost(msg);
const cardsEl = document.getElementById('cards');
const drillEl = document.getElementById('drill');
let activeDrill = null;

function card(concept) {
  const el = document.createElement('div');
  el.className = 'card';
  const title = document.createElement('strong');
  title.textContent = concept.term;
  const meta = document.createElement('div');
  meta.className = 'muted';
  const badge = concept.mastered ? 'mastered' : concept.misses > 0 ? `weak spot x${concept.misses}` : 'new';
  meta.textContent = `${badge} · ${concept.file}:${concept.line}`;
  const line = document.createElement('div');
  line.textContent = concept.bottomLine;
  const row = document.createElement('div');
  row.className = 'row';
  const drill = document.createElement('button');
  drill.textContent = 'Drill me';
  drill.onclick = () => pipPost({ type: 'drill', id: concept.id });
  const del = document.createElement('button');
  del.textContent = 'Forget';
  del.onclick = () => pipPost({ type: 'delete', id: concept.id });
  row.append(drill, del);
  el.append(title, meta, line, row);
  return el;
}

function showDrill(msg) {
  activeDrill = msg.id;
  drillEl.replaceChildren();
  const box = document.createElement('div');
  box.className = 'card';
  const q = document.createElement('div');
  q.textContent = `Drill — ${msg.term}: ${msg.text}`;
  const answer = document.createElement('textarea');
  answer.id = 'drillAnswer';
  answer.rows = 3;
  answer.placeholder = 'Your answer, in your own words…';
  const verdict = document.createElement('div');
  verdict.id = 'drillVerdict';
  const row = document.createElement('div');
  row.className = 'row';
  const check = document.createElement('button');
  check.textContent = 'Check my answer';
  check.onclick = () => {
    verdict.textContent = 'Checking locally…';
    pipPost({ type: 'drillAnswer', id: activeDrill, answer: answer.value });
  };
  const got = document.createElement('button');
  got.textContent = 'Got it (self-grade)';
  got.onclick = () => pipPost({ type: 'grade', id: activeDrill, gotIt: true });
  const missed = document.createElement('button');
  missed.textContent = 'Missed it (self-grade)';
  missed.onclick = () => pipPost({ type: 'grade', id: activeDrill, gotIt: false });
  row.append(check, got, missed);
  box.append(q, answer, row, verdict);
  drillEl.appendChild(box);
  answer.focus();
}

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'concepts') {
    cardsEl.replaceChildren();
    if (msg.concepts.length === 0) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'No flashcards yet. Select code, Explain, then Mark concept.';
      cardsEl.appendChild(p);
    }
    msg.concepts.forEach((c) => cardsEl.appendChild(card(c)));
  } else if (msg.type === 'drillQuestion') {
    showDrill(msg);
  } else if (msg.type === 'drillVerdict') {
    const verdict = document.getElementById('drillVerdict');
    if (verdict) {
      verdict.className = `verdict verdict-${msg.verdict.toLowerCase()}`;
      verdict.textContent =
        msg.verdict === 'CORRECT'
          ? `Correct. ${msg.gap}`
          : `${msg.verdict === 'WRONG' ? 'Not yet' : 'Partly there'}. ${msg.gap} (marked as a weak spot — it will resurface)`;
    }
  }
});
