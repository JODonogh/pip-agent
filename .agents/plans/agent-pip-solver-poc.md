# Agent PIP — fixes v4 + Solver (Slice 3)

> ⚠️ Medium — several fixes plus the Solver worker. Single-pass.
> Order check: Learn ✅ → Graphical ✅ (improved here) → **Solver (this plan)** → Innovator → A2UI.

## Fixes first

- [x] **Step 1 — Mark like your references**
  - Diagonal crossing bars (primary colour bars + black diagonals, original arrangement
    inspired by your Suprematist references) for both activity icon and sidebar graphic.
  - Sidebar graphic bigger (~180px) and **centred**; "Agent PIP" heading bigger and centred.
  - Timebox row becomes just `Timebox [ 10 ] Start` — small square number box.
  - Validation: screenshot matches the diagonal-bars look, centred, larger.
- [x] **Step 2 — Read aloud fixed**
  - Bug: async `pkill say` from the *previous* click killed the *new* utterance, and webview
    voice names don't match `say` names. Fix: await the kill before speaking; voice list now
    comes from the host's real `say -v '?'` list (canonical names).
  - Validation: `say -v "Eddy (English (UK))"` renders audio locally (verified); Read speaks.
- [x] **Step 3 — Speed: streaming explanations**
  - Ollama streaming: bottom line renders as tokens arrive (first words in ~1s) instead of
    waiting for the full 5-7s generation; final chunked view replaces it. Tighter output cap.
  - Validation: timed live run — first text visible well before completion.
- [x] **Step 4 — Diagrams that aren't just boxes**
  - Shape language: endpoint = pill, method = rectangle, branch = **diamond**, call =
    parallelogram, param/state = dashed chip, import = document, return/assert = terminator.
  - Testing layout becomes a true horizontal Arrange → Act → fan-out branches → Assert.
  - Validation: screenshot — three layouts visibly different, shapes differ by kind.
- [x] **Step 5 — Flashcards wrap + collapse**
  - Cards show **one term in a box**; click expands details/drill. Global word wrapping so
    long terms like `ExceptionHandler({RegisterIdpException...` never overflow.
  - Validation: long-term card renders wrapped inside the sidebar width, collapsed by default.

## Solver (Slice 3, from your /solver skill)

- [x] **Step 6 — Solver section + worker**
  - In PIP: describe the problem (+ optional pasted error/stack trace) → Solver returns,
    in your skill's format: one-sentence restatement, most likely cause + confidence,
    the fastest check (log/breakpoint/command/file), at most one question.
  - Iterate: **Fixed it** (closes, records what worked in session) / **Didn't work — next**
    (next hypothesis, history-aware, no repeats) / paste an error and it extracts the
    first application frame from the stack trace deterministically.
  - Evaluator parses/enforces the 4-part structure; no unrequested code edits, ever.
  - Validation: parser tests (incl. stack-frame extraction); live run on a sample bug.
- [x] **Step 7 — v0.5.0 rebuild, reinstall, commit** (push pending GitHub auth)
  - Push pending your GitHub device auth (still showing failed — see chat instructions).
  - **STOP GATE** before Innovator.
