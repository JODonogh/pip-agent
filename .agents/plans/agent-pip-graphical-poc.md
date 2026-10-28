# Agent PIP — Learn fixes v1.1 + Systematic/Graphical (Slice 2)

> ⚠️ Medium — several small, separable fixes plus one new graphical module. Single-pass feasible.
> Learn is *functionally* done (verified live in your screenshot); this finishes its UX, then
> adds Graphical. Innovator / A2UI remain later, gated.

## What MondriCode (JODonogh/coding-agent) taught us

Sidebar-first ("Teach Code" + one TEACH button), minimal monochrome look, local Ollama.
We steal the *shape*, not the code (it used LangChain/D3/Mermaid — too heavy for this POC).

## Learn fixes (from your screenshot + notes)

- [x] **Step 1 — Sidebar becomes home**
  - PIP sidebar = Learn at top (logo, Explain-selection button — no shortcut to remember),
    Diagram, then Flashcards and **Drill as its own subsection**. Beside-panel stays as an option.
  - "Shortcuts" button → QuickPick listing every command (`Cmd+Shift+L` etc.), clickable.
  - Validation: sidebar test/manual — explain from sidebar with no keyboard shortcut used.
- [x] **Step 2 — Keywords only + emphasis**
  - Only key terms are clickable: backticked code, identifiers, `@annotations`, technical terms
    (host-side `extractKeywords`, unit-tested) — not every word.
  - Render `**bold**`, *italic*, and `code` (coloured, monospace) instead of flat text.
  - Validation: unit tests — stopwords/common verbs yield no keywords; code tokens do.
- [x] **Step 3 — Mark Concept bug**
  - Deterministic concept id (term+file+line), empty-term fallback, visible
    "Marked ✓ (N flashcards)" confirmation, tested `PipStore` with a fake Memento.
  - Validation: store test — mark → list contains it → re-mark same spot does not duplicate.
- [x] **Step 4 — Voice, speed, timer, look**
  - Read-aloud picks the most natural local voice (Natural/Neural/Google/Samantha ranking) +
    voice picker. Timer stays in the sidebar (retained webview) so it survives code-hopping.
  - Speed (staying in Mistral family): `keep_alive 30m` (model stays loaded), per-intent
    `num_predict` caps (quick-fire 60, duck/drill 90, explain 380), smaller `num_ctx`, shorter
    surrounding context. Benchmark warm-call latency before/after.
  - Monochrome Lissitzky/Malevich-inspired triangular mark (original, black/white, theme-aware)
    as activity icon + banner above Explain. Drop emoji buttons; plain text labels.
  - Validation: warm explain measurably faster than the 8.3s cold baseline; tests green.

## Systematic / Graphical (Slice 2)

- [x] **Step 5 — Deterministic diagram analyser**
  - Pure `analyzeCode(selection)`: endpoint/annotation → method → calls → return (Java/Spring),
    component → hooks/state/props (TS/React), imports as dependency satellites. No LLM, instant.
  - Validation: unit tests on a Spring `@GetMapping` sample (your screenshot) and a React sample.
- [x] **Step 6 — Interactive SVG diagram in PIP**
  - Vertical flow boxes + arrows, rendered under the explanation; **layer toggles**
    (calls / imports / params / hooks) to turn parts of the system on and off and see the effect;
    click a node → explain that node in place.
  - Validation: analyser tests + manual check on the `getAll` endpoint from your screenshot.
- [ ] **Step 7 — Rebuild, retest, reinstall, publish**
  - Full test suite, `tsc` clean, repackage VSIX, reinstall in Cursor + VS Code.
  - Git: initialised + committed locally (83759d9). Push BLOCKED: your `gh` token for github.com is
    invalid — run `gh auth login -h github.com -u JODonogh -w` once, then ask agent to push.
  - **STOP GATE:** you review Graphical before Innovator is planned.
