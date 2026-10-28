# Agent PIP — UX v3 (from your 23:24 screenshots)

> ✅ Simple-Medium — UI restructure + popup interaction change. Single-pass.

- [x] **Step 1 — Top decluttered**
  - Remove the `file:line — Explain when ready` line and status chatter entirely.
  - Commands & shortcuts details moved to the **bottom** of the drawer.
  - Timebox returns to the **top** (under the 3 primary buttons).
  - Banner mark becomes a **vertical** composition.
  - Validation: screenshot — top is banner, 3 buttons, timebox, duck box. Nothing else.
- [x] **Step 2 — Rubber-duck chat at the top; quick-fire button deleted**
  - Chat box under the primary buttons: type, Enter, duck replies in a small log.
  - The old Quick-fire/Rubber-duck button row and ask box are removed; quick one-liners now
    only happen through the word popup (Step 3).
  - Validation: duck reply renders in the top log; no quick-fire button exists.
- [x] **Step 3 — Word click = small popup, not a panel takeover**
  - Clicking an underlined term (or a diagram box) opens a **small disposable popup** at the
    click point: one-line rapid answer, a follow-up box whose answers are also one line,
    close/Esc/click-away dismisses. Original explanation never moves.
  - Fast route + cache, so repeat terms are instant.
  - Validation: click `MagicLinkVerificationException` → popup, original chunks untouched.
- [x] **Step 4 — Read aloud never layers**
  - Host kills any running `say` (SIGKILL + `pkill say`) before starting; button toggles stop.
  - Validation: click Read 3× → only the last utterance is heard.
- [x] **Step 5 — No formulaic chunks**
  - Explainer prompt bans generic titles (What it is / How it flows / Worth learning /
    Watch out); chunk titles must name the actual parts of *this* code.
  - Validation: prompt test asserts the ban; live answer uses code-specific titles.
- [x] **Step 6 — Diagrams: collapsible, three real layouts**
  - Data flow = vertical flow · Architecture = hub-and-spoke (method centre, dependencies
    around it) · Testing = horizontal Arrange → Act → branches → Assert. Whole Diagrams
    section is a collapsible `<details>`.
  - Validation: analyser tests stay green; architecture no longer a vertical chain.
- [x] **Step 7 — Drill + Flashcards merged, drills answerable**
  - One collapsible **Flashcards & Drill** section. Drill shows a question **and an answer
    box**: Check → local model verdict (CORRECT / PARTLY / WRONG + one-line gap), auto-graded
    (miss = weak spot, two correct = mastered), manual override kept.
  - Validation: drill test for the verdict parser; UI flow by hand.
- [x] **Step 8 — v0.4.0 rebuild, reinstall both, commit** (push pending device auth)
  - Push after you enter the GitHub device code and say so.
