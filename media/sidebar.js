/* Review & drill: the ideas the engineer chose to keep, with a practice mode for each.
   Wrapped in a function so its helper names cannot clash with learn.js on the same page. */
(() => {
  const pipPost = (msg) => window.pipPost(msg);
  const cardsEl = document.getElementById('cards');
  let drillEl = document.getElementById('drill');
  const drillHosts = new Map();
  const useDrill = (id) => { drillEl = drillHosts.get(id) || document.getElementById('drill'); };
  const undoEl = document.getElementById('undoBar');
  let activeDrill = null;
  let undoTimer = null;
  let selectedLayer = 'all';
  const layers = {
    data: 'Data & persistence',
    frontend: 'UI & human interface',
    backend: 'Backend & communication',
    ai: 'AI & Inference',
  };
  let keptConcepts = [];

  // This interactive list replaces the read-only copy that the beside-editor panel shows.
  const readOnlyList = document.getElementById('ledgerBlock');
  if (readOnlyList) readOnlyList.style.display = 'none';

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    if (tag === 'button' && text) node.title = text;
    return node;
  }
  const bare = (word) => word.replace(/^[.@]+/, '').replace(/\(\)$/, '').trim().toLowerCase();

  function option(label, description, onClick) {
    const row = el('div', 'drillOption');
    const button = el('button', '', label);
    button.title = description;
    button.onclick = onClick;
    row.append(button, el('span', 'muted', description));
    return row;
  }

  function card(concept) {
    // Collapsed: title, progress chip and an always-visible remove button. Open: what it is and how to practise it.
    const item = el('details', 'card flashcard');
    const summary = el('summary', 'cardSummary');
    const remove = el('button', 'iconBtn removeBtn', '✕');
    remove.title = 'Remove this card';
    remove.setAttribute('aria-label', `Remove ${concept.term}`);
    remove.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      pipPost({ type: 'delete', id: concept.id });
    };
    summary.append(el('span', 'cardTitle', concept.term), el('span', `chip chip-${concept.status}`, concept.statusLabel), remove);

    const source = el('div', 'muted', `Kept from ${concept.shortFile || concept.file}:${concept.line}`);
    source.title = `${concept.file}:${concept.line}`;
    const layerRow = el('label', 'drillLayer', concept.layer ? `${concept.layerLabel}` : 'Practice layer: ');
    const layerSelect = el('select');
    layerSelect.title = 'Choose which engineering layer this idea helps you practise';
    layerSelect.setAttribute('aria-label', `Practice layer for ${concept.term}`);
    if (!concept.layer) { const unset = el('option', '', 'Choose a layer'); unset.value = ''; layerSelect.append(unset); }
    Object.entries(layers).forEach(([value, label]) => { const opt = el('option', '', label); opt.value = value; layerSelect.append(opt); });
    layerSelect.value = concept.layer || '';
    layerSelect.onchange = () => { if (layerSelect.value) pipPost({ type: 'setLearningLayer', id: concept.id, layer: layerSelect.value }); };
    if (!concept.layer) layerRow.append(layerSelect);
    summary.title = 'Open this saved idea to see its takeaway and practice options';
    const options = el('div', 'drillOptions');
    options.append(
      option('Ask me a question', 'A question about this idea. Answer in your own words; it is checked locally.', () => { useDrill(concept.id); pipPost({ type: 'drill', id: concept.id }); }),
      option('Quiz', 'One multiple-choice question with plausible wrong answers.', () => { useDrill(concept.id); pipPost({ type: 'mcq', id: concept.id }); }),
    );
    if (concept.cloze) {
      options.append(option('Fill the blank', 'The takeaway with one key word hidden. Type it back.', () => { useDrill(concept.id); showCloze(concept); }));
    }
    if (concept.guessable) {
      options.append(option('Guess it', 'Hints appear one at a time. Name the idea.', () => { useDrill(concept.id); showMystery(concept); }));
    }
    const briefBox = el('div', 'briefIn30s hidden');
    const briefBtn = el('button', '', 'Explain in 30s');
    briefBtn.title = 'One-sentence what and why — from your kept takeaway, no new model call';
    briefBtn.onclick = () => {
      briefBox.classList.toggle('hidden');
      if (!briefBox.classList.contains('hidden')) {
        briefBox.replaceChildren();
        const brief = concept.explainIn30s;
        briefBox.append(
          el('p', '', brief?.what || concept.bottomLine),
          el('p', 'muted', brief?.why || ''),
        );
      }
    };
    const practice = el('div', 'cardPractice');
    drillHosts.set(concept.id, practice);
    item.append(
      summary,
      el('div', 'cardTakeaway', /\bLIKE\b/.test(concept.bottomLine) && /prevent.*SQL injection/i.test(concept.bottomLine) ? 'LIKE wildcard escaping controls pattern matching. SQL injection protection depends on parameter binding; check the query implementation.' : concept.bottomLine),
      source,
      layerRow,
      el('div', 'muted', `${concept.statusHint} ${concept.nextLesson}`),
      briefBtn,
      briefBox,
      options,
      practice,
    );
    return item;
  }

  function gradeAndTell(id, ok, text) {
    pipPost({ type: 'grade', id, gotIt: ok });
    drillEl.appendChild(el('div', ok ? 'verdict verdict-correct' : 'verdict verdict-wrong', text));
  }

  /** Fill the blank: the host hides one key word of the takeaway; the answer must match it. */
  function showCloze(concept) {
    drillEl.replaceChildren();
    const box = el('div', 'card');
    const input = el('input');
    input.type = 'text';
    input.placeholder = 'The missing word…';
    const check = el('button', '', 'Check');
    check.onclick = () => {
      const ok = input.value.trim().toLowerCase() === concept.cloze.answer.toLowerCase();
      gradeAndTell(concept.id, ok, ok ? 'Correct.' : `Not quite — it was "${concept.cloze.answer}". It will come up sooner.`);
    };
    box.append(el('div', '', `Fill the blank: ${concept.cloze.text}`), input, check);
    drillEl.appendChild(box);
    input.focus();
  }

  /** Mystery box: hints reveal in stages; name the idea. Offered only for single-name titles. */
  function showMystery(concept) {
    drillEl.replaceChildren();
    const hints = [
      `It comes from ${concept.shortFile || concept.file}, line ${concept.line}`,
      `It starts with "${concept.term.charAt(0)}" and has ${concept.term.length} characters`,
      `Half the story: ${concept.bottomLine.slice(0, Math.floor(concept.bottomLine.length / 2))}…`,
      `The answer relates to: ${concept.bottomLine}`,
    ];
    let stage = 0;
    const box = el('div', 'card');
    const hintBox = el('div');
    const input = el('input');
    input.type = 'text';
    input.placeholder = 'Your guess…';
    const row = el('div', 'row');
    const reveal = el('button', '', 'Reveal a hint');
    reveal.onclick = () => {
      if (stage < hints.length) {
        hintBox.appendChild(el('div', '', `Hint ${stage + 1}: ${hints[stage]}`));
        stage += 1;
      }
    };
    const guess = el('button', '', 'Guess');
    guess.onclick = () => {
      const ok = bare(input.value) === bare(concept.term);
      gradeAndTell(concept.id, ok, ok ? `Correct in ${stage} hint(s) — nicely recalled.` : `It was "${concept.term}". It will come up sooner.`);
    };
    row.append(reveal, guess);
    box.append(el('strong', '', 'Guess it — name the idea'), hintBox, input, row);
    drillEl.appendChild(box);
  }

  function showDrill(msg) {
    useDrill(msg.id);
    activeDrill = msg.id;
    drillEl.replaceChildren();
    const box = el('div', 'card');
    const answer = el('textarea');
    answer.id = 'drillAnswer';
    answer.rows = 3;
    answer.placeholder = 'Your answer, in your own words…';
    const verdict = el('div');
    verdict.id = 'drillVerdict';
    const row = el('div', 'row');
    const check = el('button', '', 'Check my answer');
    check.onclick = () => {
      verdict.textContent = 'Checking locally…';
      pipPost({ type: 'drillAnswer', id: activeDrill, answer: answer.value });
    };
    const got = el('button', '', 'Got it (self-grade)');
    got.onclick = () => pipPost({ type: 'grade', id: activeDrill, gotIt: true });
    const missed = el('button', '', 'Missed it (self-grade)');
    missed.onclick = () => pipPost({ type: 'grade', id: activeDrill, gotIt: false });
    row.append(check, got, missed);
    box.append(el('div', '', `Question on ${msg.term}: ${msg.text}`), answer, row, verdict);
    drillEl.appendChild(box);
    answer.focus();
  }

  function hideUndo() {
    clearTimeout(undoTimer);
    undoEl.classList.add('hidden');
    undoEl.replaceChildren();
  }

  /** Removal is immediate and reversible: the host keeps what it removed until the next removal. */
  function showUndo(msg) {
    clearTimeout(undoTimer);
    undoEl.replaceChildren();
    const undo = el('button', '', 'Undo');
    undo.onclick = () => {
      pipPost({ type: 'undoDelete' });
      hideUndo();
    };
    undoEl.append(el('span', '', msg.count > 1 ? `Removed ${msg.count} cards. ` : `Removed "${msg.term}". `), undo);
    undoEl.classList.remove('hidden');
    undoTimer = setTimeout(hideUndo, 10000);
  }

  function renderCards(concepts) {
    keptConcepts = concepts;
    cardsEl.replaceChildren();
    const filters = el('div', 'row');
    Object.entries({ all: 'All layers', ...layers }).forEach(([value, label]) => {
      const button = el('button', selectedLayer === value ? 'isActive' : '', label);
      button.title = value === 'all' ? 'Show all saved ideas' : `Practise saved ideas in ${label}`;
      button.setAttribute('aria-pressed', String(selectedLayer === value));
      button.onclick = () => { selectedLayer = value; renderCards(keptConcepts); };
      filters.append(button);
    });
    cardsEl.append(filters);
    const shown = concepts.filter((concept) => selectedLayer === 'all' || concept.layer === selectedLayer);
    if (concepts.length === 0) {
      cardsEl.appendChild(el('p', 'muted', 'Nothing kept yet. Select code, press Select, and when an explanation is worth remembering press Keep.'));
      return;
    }
    if (!shown.length) cardsEl.append(el('p', 'muted', 'No kept ideas in this layer yet. Keep a relevant explanation, or assign a saved idea using its Practice layer selector.'));
    shown.forEach((concept) => cardsEl.appendChild(card(concept)));
    if (concepts.length > 1) {
      const all = el('button', '', 'Remove all');
      all.onclick = () => pipPost({ type: 'deleteAll' });
      const row = el('div', 'row');
      row.append(all);
      cardsEl.appendChild(row);
    }
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'concepts') {
      renderCards(msg.concepts || []);
    } else if (msg.type === 'removed') {
      showUndo(msg);
    } else if (msg.type === 'drillQuestion') {
      showDrill(msg);
    } else if (msg.type === 'mcqQuestion') {
      useDrill(msg.id);
      drillEl.replaceChildren();
      const box = el('div', 'card');
      if (!msg.mcq) {
        box.textContent = 'The local model broke the quiz format — try again.';
      } else {
        box.appendChild(el('div', '', `Quiz on ${msg.term}: ${msg.mcq.question}`));
        msg.mcq.options.forEach((option, i) => {
          const btn = el('button', '', `${'ABCD'[i]}: ${option}`);
          btn.style.display = 'block';
          btn.style.margin = '6px 0';
          btn.onclick = () => {
            const ok = i === msg.mcq.answerIndex;
            gradeAndTell(msg.id, ok, ok ? 'Correct.' : `Not that one — the answer was ${'ABCD'[msg.mcq.answerIndex]}. This moves up your list.`);
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
          msg.verdict === 'UNAVAILABLE' ? msg.gap : msg.verdict === 'CORRECT'
            ? `Correct. ${msg.gap}`
            : `${msg.verdict === 'WRONG' ? 'Not yet' : 'Partly there'}. ${msg.gap} (it moves up your list)`;
      }
    }
  });
})();
