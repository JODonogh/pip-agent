/* Flashcards + Drill subsection. Posting goes through window.pipPost (set by learn.js). */
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
    activeDrill = msg.id;
    drillEl.replaceChildren();
    const q = document.createElement('div');
    q.className = 'card';
    q.textContent = `Drill — ${msg.term}: ${msg.text}`;
    const row = document.createElement('div');
    row.className = 'row';
    const got = document.createElement('button');
    got.textContent = 'Got it';
    got.onclick = () => {
      pipPost({ type: 'grade', id: activeDrill, gotIt: true });
      drillEl.replaceChildren();
    };
    const missed = document.createElement('button');
    missed.textContent = 'Missed it';
    missed.onclick = () => {
      pipPost({ type: 'grade', id: activeDrill, gotIt: false });
      drillEl.replaceChildren();
    };
    row.append(got, missed);
    drillEl.append(q, row);
  }
});
