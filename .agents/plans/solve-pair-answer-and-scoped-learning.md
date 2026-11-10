# Solve as Pair & Answer + Scoped Learning — Plan

🔴 Complex — spans Solve chat, Learn scoping, Cursor import/export, and Review layering. Break into sub-plans if needed; single pass is risky.

## Goal
Make Solve a short-answer sidecar to Cursor (pair + direct answer with follow-ups), fix single-line Select explaining the whole query, keep overview anchored while exploring parts, make Cursor↔PIP transfer explicit both ways, and turn sessions into permanent short reminders across UI / Backend / Data layers.

## Context from request
- Solve should give direct short answers + follow-ups, kept simple, with explicit routes to Visualise / Learn / Ideate / Review.
- Solve explores Cursor conversation excerpts, not replace Cursor coding tools.
- Bug: selecting one SQL line (`OR LOWER(p.partner_name) LIKE ...`) explains the entire query; Learn gives 401/exception-type chunks instead of LIKE / WHERE / AND / OR / LOWER / CAST / ESCAPE.
- Need Cursor→PIP and PIP→Cursor transfer, engagement advice (debug/Bruno/DBeaver), anchored context when drilling into one piece, permanent reminders, interview/standup readiness, three layers (UI/Human interface, Backend/Communication & business logic, Data/persistence).

## Steps
- [x] 1. Scope-exact Select + keyword-level Learn for long selections
  - Ensure `explainSelection`/`captureContext` uses exact selection (no surrounding expansion for prompts); show `N selected characters` source label.
  - For selections > ~700 chars, require one chunk per major part + glossary coverage of operators/keywords present (LIKE, WHERE, AND/OR, LOWER, CAST, ESCAPE, EXISTS, NULL handling).
  - Add evaluator check: chunks must name actual parts of THIS selection; repair note if generic.
  - Validation: integration test selecting single LIKE line from the reported partner query explains LIKE/LOWER/ESCAPE, not 401/exception; test full query covers WHERE/EXISTS/NULL branches.
- [x] 2. Solve Pair & Answer mode (keep simple)
  - Keep single chat box; add explicit `Pair` (questions only) vs `Answer` (direct short answer + 1 check) toggle; default Answer for pasted Cursor excerpts.
  - Answers stay short (2–4 sentences or 3 bullets max), cite pasted code/error only, end with 1 follow-up question and 3 route chips: Visualise / Learn / Ideate / Review.
  - Follow-ups stay anchored to same excerpt unless user pastes new text; show `About <file>:<line> · N chars` header.
  - Validation: test direct mode returns short answer + follow-up + routes; test follow-up does not silently switch context.
- [x] 3. Overview + anchored explorations (no lost context)
  - Learn overview stays pinned at top; each chunk/keyword opens disposable popup with one-line answer + one-line follow-up, never replacing overview.
  - Add “Back to overview” affordance and breadcrumb (`Overview > LIKE > ESCAPE`) in popup/thread.
  - Validation: UI test that opening 2 popups leaves overview intact; test breadcrumb returns to original chunk.
- [x] 4. Cursor ↔ PIP transfer both ways
  - Add explicit `Paste from Cursor` box in Solve (excerpt + optional question) creating a Solve session without needing editor selection; keep existing `Hand off to Cursor` (already present) and `Send to Learn` / `Visualise` routes.
  - Paste path sets `chatFocus` so Learn/Ideate/Review reuse it until next Select.
  - Validation: test pasting Cursor excerpt creates session labeled `Solve chat`; test handoff copies prompt / opens Cursor link.
- [x] 5. Per-answer engagement (debug / Bruno / DBeaver)
  - Each Solve/Learn answer appends one concrete engagement line: breakpoint + what to inspect, Bruno request (localhost only), or DBeaver/SQL check with exact query fragment.
  - Reuse existing Verify block; do not run anything automatically.
  - Validation: test SQL excerpt suggests DBeaver check with LIKE fragment; test endpoint excerpt suggests Bruno localhost request.
- [x] 6. Permanent short reminders + three layers
  - Keep flow: explanation → Keep → Review card with layer tag (UI / Backend / Data); Today summary resurfaces next day.
  - Ensure `setLearningLayer` (data/frontend/backend) maps visibly to UI / Backend-communication / Data-persistence labels in Review.
  - Validation: test kept LIKE note persists with layer tag and appears in Today summary; test layer filter shows correct cards.
- [x] 7. Interview/standup readiness (lightweight)
  - Add “Explain it in 30s” on kept cards (no new storage): 1-sentence what + 1-sentence why it matters. (User-facing label only — no “standup pitch” naming in code or UI.)
  - Validation: UI test that 30s version renders from existing bottomLine without extra model call or with tiny local prompt.
- [x] 8. Test map for long JUnit classes (read less, jump more)
  - Static `junitReadOutline` on Select/Visualise; Learn **Test map** with jump-to-line and assertion skim; explain prompt one chunk per `@Test` when multiple tests in selection.
  - Validation: `junit-outline.test.ts`; integration test `testOutline` on explain for Java test class.

## Out of scope
- Replacing Cursor/agent coding tools; running backend/DB automatically; remote models (localhost Ollama only).
- No Workday/GPP edits; standalone extension only.
- No git commands.