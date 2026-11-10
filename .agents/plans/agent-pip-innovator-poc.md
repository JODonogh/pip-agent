# Agent PIP — Learn depth restored + Innovator (Slice 4)

> ⚠️ Medium — many small workers on the existing seam, plus UI polish. Single-pass, staged below.
> MondriCode lessons applied: learning-mode tabs, Code/Pseudocode/Diagram views, SCAMPER,
> Mystery Box revelation, theoretical foundations. Order: …Solver ✅ → **Innovator (this)** → A2UI.

## Polish (your notes)

- [x] **Step 1 — Grayscale mark, top grid, collapse-all**
  - Icon/banner: grayscale only, shape variety (circles, triangles, squares, bars, diagonals).
  - Top grid: `Explain | Mark | Read` in one aligned row; Timebox below it (`Timebox [10] Start`,
    no "min" label).
  - All expandables start **collapsed**; a small icon button (collapse-all) sits at the bottom.
  - Validation: screenshot — grey shapes, grid row, everything shut on open.

## Learn depth (the missed responses)

- [x] **Step 2 — Explanation style + mode switch (MondriCode learning modes)**
  - Style chips before Explain: **Plain** · **Analogy** (inventive/entertaining, sometimes
    absurd-but-accurate) · **Foundations** (structured/theory). Mode switch **Visual/Auditory**:
    Auditory auto-reads the bottom line and keeps chunks shut (tired-eyes mode).
  - Validation: same selection under Plain vs Analogy gives visibly different text live.
- [x] **Step 3 — Deep-dive buttons under every explanation**
  - **Foundations** (data structure/algorithm, Big O time+space, the maths — algebra/pre-calc
    roots with a tiny worked example), **Roots** (history: early computing, mathematicians,
    where this pattern came from), **Trade-offs** (Performance / Readability / Security chips,
    one card each). Cards append below, collapsible, never replacing the explanation.
  - Also **Pseudocode** view (MondriCode's Code/Pseudocode/Diagram switch).
  - Validation: worker prompt tests; live run produces a Big O + a history card.
- [x] **Step 4 — Interactive diagrams you can walk**
  - Play/Step controls walk the flow node-by-node with a caption for each step; clicking a
    node also selects its upstream/downstream path. Diagram stops being wallpaper.
  - Validation: stepping highlights nodes in order with captions from the analyser.
- [x] **Step 5 — Day summary, games & puzzles**
  - "Today" strip: concepts marked today; **Summarise my day** → 3 hints saved as a review
    card that resurfaces at the top on the next day.
  - Games from marked concepts: **Cloze** (blank the term, type it back), **Mystery Box**
    (progressive hints, guess the concept — MondriCode revelation stages), **Multiple choice**
    (model-generated, parsed, instant grading). All feed weak-spot/mastery grading.
  - Validation: cloze grading test (deterministic), MCQ parser test, mystery hints test.
- [x] **Step 6 — Verify in one place (test / Bruno / DB)**
  - Under an explanation for an endpoint: **Bruno-style** request card (method+path, localhost
    base URL, Send → real status + body snippet; localhost enforced).
  - **Test**: generates a unit-test skeleton card (copy button) — tests as learning.
  - **DB**: read-only derived query hint (e.g. `findAll` → `SELECT * FROM …`), never executed.
  - Validation: localhost guard test; Bruno send against local Ollama port proves the path.

## Innovator (Slice 4)

- [x] **Step 7 — Diverge / Converge / SCAMPER**
  - **Diverge**: 4 alternative approaches to the selection as cards. **Randomise** shuffles
    order + randomises a SCAMPER lens. **Converge**: pick one → one-line verdict per lens
    (performance/readability/security). SCAMPER buttons from MondriCode: Metaphor Mixer,
    Subtraction Dare, Reverse It — each generates a short creative challenge about your code.
  - Validation: approach parser test; shuffle is client-side and instant.
- [x] **Step 8 — v0.6.0 rebuild, reinstall both, commit. STOP GATE before A2UI.** (push pending GitHub auth)
