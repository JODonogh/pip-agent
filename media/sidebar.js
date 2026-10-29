/* Flashcards & Drill (one combined collapsible section in the sidebar). */
const pipPost = (msg) => window.pipPost(msg);
const cardsEl = document.getElementById('cards');
const drillEl = document.getElementById('drill');
let activeDrill = null;

function card(concept) {
  // Collapsed by default: one term in a box. Click expands the details.
  const el = document.createElement('details');
  el.className = 'card flashcard';
  const summary = document.createElement('summary');
  const badge = concept.mastered ? ' · mastered' : concept.misses > 0 ? ` · weak x${concept.misses}` : '';
  summary.textContent = `${concept.term}${badge}`;
  const meta = document.createElement('div');
  meta.className = 'muted';
  meta.textContent = `${concept.file}:${concept.line}`;
  const line = document.createElement('div');
  line.textContent = concept.bottomLine;
  const row = document.createElement('div');
  row.className = 'row';
  const drill = document.createElement('button');
  drill.textContent = 'Drill me';
  drill.onclick = () => pipPost({ type: 'drill', id: concept.id });
  const cloze = document.createElement('button');
  cloze.textContent = 'Cloze game';
  cloze.onclick = () => showCloze(concept);
  const mystery = document.createElement('button');
  mystery.textContent = 'Mystery box';
  mystery.onclick = () => showMystery(concept);
  const mcq = document.createElement('button');
  mcq.textContent = 'Quiz (MCQ)';
  mcq.onclick = () => pipPost({ type: 'mcq', id: concept.id });
  const del = document.createElement('button');
  del.textContent = 'Forget';
  del.onclick = () => pipPost({ type: 'delete', id: concept.id });
  row.append(drill, cloze, mystery, mcq, del);
  el.append(summary, meta, line, row);
  return el;
}

function gradeAndTell(id, ok, text) {
  pipPost({ type: 'grade', id, gotIt: ok });
  const note = document.createElement('div');
  note.className = ok ? 'verdict verdict-correct' : 'verdict verdict-wrong';
  note.textContent = text;
  drillEl.appendChild(note);
}

/** Cloze game: the term is blanked out of its own explanation. Deterministic. */
function showCloze(concept) {
  drillEl.replaceChildren();
  const box = document.createElement('div');
  box.className = 'card';
  const prompt = document.createElement('div');
  const escaped = concept.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  prompt.textContent = `Fill the blank: ${concept.bottomLine.replace(new RegExp(escaped, 'i'), '______')}`;
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'The missing term…';
  const check = document.createElement('button');
  check.textContent = 'Check';
  check.onclick = () => {
    const ok = input.value.trim().toLowerCase() === concept.term.toLowerCase();
    gradeAndTell(concept.id, ok, ok ? 'Correct — that is the term.' : `Not quite — it was "${concept.term}". It will resurface.`);
  };
  box.append(prompt, input, check);
  drillEl.appendChild(box);
  input.focus();
}

/** Mystery Box (MondriCode): hints reveal in stages; guess the concept. */
function showMystery(concept) {
  drillEl.replaceChildren();
  const hints = [
    `It lives at ${concept.file}:${concept.line}`,
    `It starts with "${concept.term.charAt(0)}" and has ${concept.term.length} characters`,
    `Half the story: ${concept.bottomLine.slice(0, Math.floor(concept.bottomLine.length / 2))}…`,
    `The answer relates to: ${concept.bottomLine}`,
  ];
  let stage = 0;
  const box = document.createElement('div');
  box.className = 'card';
  const title = document.createElement('strong');
  title.textContent = 'Mystery box — guess the concept';
  const hintBox = document.createElement('div');
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Your guess…';
  const row = document.createElement('div');
  row.className = 'row';
  const reveal = document.createElement('button');
  reveal.textContent = 'Reveal a hint';
  reveal.onclick = () => {
    if (stage < hints.length) {
      const p = document.createElement('div');
      p.textContent = `Hint ${stage + 1}: ${hints[stage]}`;
      hintBox.appendChild(p);
      stage += 1;
    }
  };
  const guess = document.createElement('button');
  guess.textContent = 'Guess';
  guess.onclick = () => {
    const ok = input.value.trim().toLowerCase() === concept.term.toLowerCase();
    gradeAndTell(concept.id, ok, ok ? `Correct in ${stage} hint(s) — nicely recalled.` : `It was "${concept.term}". The hints will be kinder next time; the concept will resurface.`);
  };
  row.append(reveal, guess);
  box.append(title, hintBox, input, row);
  drillEl.appendChild(box);
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
  } else if (msg.type === 'mcqQuestion') {
    drillEl.replaceChildren();
    const box = document.createElement('div');
    box.className = 'card';
    if (!msg.mcq) {
      box.textContent = 'The local model broke the quiz format — try again.';
    } else {
      const q = document.createElement('div');
      q.textContent = `Quiz — ${msg.term}: ${msg.mcq.question}`;
      box.appendChild(q);
      msg.mcq.options.forEach((option, i) => {
        const btn = document.createElement('button');
        btn.textContent = `${'ABCD'[i]}: ${option}`;
        btn.style.display = 'block';
        btn.style.margin = '6px 0';
        btn.onclick = () => {
          const ok = i === msg.mcq.answerIndex;
          gradeAndTell(msg.id, ok, ok ? 'Correct.' : `Not that one — the answer was ${'ABCD'[msg.mcq.answerIndex]}. This becomes a weak spot.`);
        };
        box.appendChild(btn);
      });
    }
    drillEl.appendChild(box);
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
