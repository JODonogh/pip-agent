# Agent PIP — Learn POC (Slice 1 of 5)

> ⚠️ Medium vision · ✅ Simple slice — single-pass executable, low risk
> Order: **Learn → Graphical → Solver → Innovator → A2UI**. Only Learn here. Each later phase is a
> separate plan gated on your approval of the previous working slice.

## Approved decisions (2026-10-28)

- **Form factor:** VS Code extension — runs in both VS Code and Cursor (Cursor is a VS Code fork).
  Sits beside code: disposable **webview panel in the beside column**, opened from a selection.
- **Location:** `/Users/jonathan.odonoghue/agent-pip-poc/` — standalone, outside Global Partner
  Portal. No Workday code altered, nothing committed/pushed anywhere.
- **Models: local only.** Ollama at `http://127.0.0.1:11434`, default model `mistral:latest`
  (also available locally: `llama3:8b`, `codegemma`). Provider **enforces a localhost URL** and
  rejects anything else — model traffic never leaves this machine. Deterministic Mock provider
  is the offline fallback when Ollama is down. No Claude/Codex/Gemini/Cursor cloud models.
- **Engineer-led:** you set level/mode, self-grade drills. No auto-curriculum, no surveillance.

## Architecture (orchestrator-workers + deterministic evaluator, cut to need)

- **Extension host = Orchestrator**: intent router (Explain / Quick-fire / Rubber-duck / Drill),
  builds prompts from selection + `file:line` + surrounding lines, routes models
  (`explain → mistral`, `duck/drill → mistral`, all local so routing is effort, not cost),
  enforces constraints, records observability.
- **Workers**: one prompt template each — Explainer (chunked), Socratic (your `/discuss` moves),
  Drillmaster. All behind a `ModelProvider` seam (Ollama / Mock).
- **Evaluator (deterministic, no LLM)**: quick-fire = exactly 1 sentence; rubber-duck = exactly
  1 question; explainer output parsed into bottom-line + ≤5 chunks, chunk word cap, recursion
  depth ≤ 3 for click-a-word-in-the-answer.
- **Context store**: VS Code `globalState` — flashcards, weak spots, mastered, history.
  Retrieval score = recency (eligibility trace) × overlap, strongest cue wins (overshadowing),
  mastered suppressed (blocking). Simplified, documented as such.
- **Session state**: panel + timer live in the webview only; timer is **never persisted**.
- **Observability**: per-turn worker/model/latency/est. tokens/cost ($0.00 local) in panel footer.

## Steps

- [x] **Step 1 — Scaffold + plan**
  - Extension skeleton (TS strict), `pip.explainSelection` command, F5-runnable in both editors.
  - Validation: compiles; Extension Host launches; command appears in palette.
- [x] **Step 2 — Provider seam (Ollama local-only + Mock)**
  - `OllamaProvider` (localhost-enforced, model from settings), `MockProvider` fallback.
  - Validation: unit tests — non-localhost URL rejected; stubbed-fetch Ollama response parsed;
    Ollama-down path returns Mock result flagged as such.
- [x] **Step 3 — Context store + memory scoring**
  - Pure scoring module + `globalState` adapter: flashcards / weak / mastered / history + hints.
  - Validation: unit tests — recent strong cue wins, old cue decays, mastered gives no hint.
- [x] **Step 4 — Beside panel + chunked explainer**
  - Disposable panel beside editor; bottom line first, expandable chunks, click a word in the
    answer → explain it in-panel (depth ≤ 3); cite `file:line`; Esc/close disposes.
  - Validation: unit tests for parser/evaluator; manual F5 happy path on a real selection.
- [x] **Step 5 — Quick-fire + rubber-duck**
  - One-sentence answers; duck = 1-line reaction, 1 Socratic move, exactly 1 question.
  - Validation: evaluator tests on good/bad outputs (sentence & question counts).
- [x] **Step 6 — Flashcards, drills, weak spots (sidebar view)**
  - Mark concept in panel → flashcard in sidebar; drill from cards; self-grade Got it / Missed;
    miss → weak spot resurfaces first; 2× got it → mastered.
  - Validation: store tests for the full mark → miss → resurface → mastered loop.
- [x] **Step 7 — Timer, auditory, observability**
  - Session-only timebox; Read-aloud via webview speech; per-turn observability footer.
  - Validation: test asserts no timer key in persisted state; footer renders after a turn.
- [x] **Step 8 — Live verification + stress**
  - Real Ollama happy path in Extension Host (VS Code *and* Cursor); stress: 5k-word selection,
    Ollama stopped mid-session, rapid panel open/close, empty selection.
  - Validation: all unit tests green, `tsc` clean, demo script below works end-to-end.
  - **STOP GATE:** you review before any Graphical plan is written.

## Demo (when done)

1. Open this project in Cursor (or VS Code), press F5 → Extension Host window.
2. Open any file, select code, `Cmd+Shift+L` (or right-click → *PIP: Explain selection*).
3. Read the one-line bottom line; expand only the chunks you want; click a word to go deeper.
4. Mark a concept → find its flashcard in the PIP sidebar → drill yourself.
