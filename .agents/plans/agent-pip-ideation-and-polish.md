# Agent PIP — Minimal Emblem, Large Diagrams, Natural Voice & Codebase/POC Ideation Studio

> ✅ Simple-Medium — single-pass execution, local-only, no git commands.

## Implementation Steps

- [x] **Step 1 — Clean Minimal Constructivist Emblem (`media/icon.svg`, `src/banner.ts`)**
  - Replace the busy multi-layered graphic with a clean, gallery-grade 3-element Constructivist mark (bold C-arc, 3 clean vertical bars, 1 crisp diagonal T-beam with negative-space knockout gap — zero visual clutter).
  - Simplify `media/icon.svg` to 3 bold shapes so it reads clearly at 24x24px in the activity bar.
  - Validation: SVG markup is clean and renders with generous breathing room.
- [x] **Step 2 — Natural Human Voices Only (`src/extension.ts`, `media/learn.js`)**
  - Blocklist all macOS Eloquence / novelty formant-synthesizer voices (`Flo`, `Eddy`, `Reed`, `Rocko`, `Sandy`, `Shelley`, `Grandma`, `Grandpa`, `Fred`, `Ralph`, etc.) that caused the robotic sound.
  - Keep only human-sampled Vocalizer/Siri/Enhanced voices (`Daniel`, `Moira`, `Karen`, `Tessa`, `Tara`, `Aman`, `Samantha`, plus any `Premium`/`Enhanced` voices), strip markdown syntax before `say`, and speak at a natural cadence (`-r 168`).
  - Validation: unit test for voice filtering & speech text sanitization.
- [x] **Step 3 — Codebase Improvement & POC Ideation Workers + Evaluators (`src/workers.ts`, `src/evaluator.ts`, `src/provider.ts`, `src/extension.ts`)**
  - Add `improveCodebasePrompt(ctx, focusLens)`, `pocIdeasPrompt(ctx, seed)`, and `pocBlueprintPrompt(ctx, pocTitle)` workers.
  - Add deterministic parsers `parseImprovements(raw)` and `parsePocIdeas(raw)` with Effort/Impact tags (JIRA-explosion guard) and 1-day POC blueprints.
  - Validation: Vitest unit tests for `parseImprovements`, `parsePocIdeas`, and Mock fallbacks.
- [x] **Step 4 — Large, Legible Interactive Diagrams + Zoom/Expand & Ideation UI (`src/banner.ts`, `media/learn.js`, `media/panel.css`)**
  - Make the inline diagram full-width with large nodes (`height: 48px`, `13px` labels), zoom controls (`−`, `100%`, `+`), and an `⤢ Expand beside` button that pops the diagram into the wide beside-editor panel.
  - Upgrade the `Create` tab to house **Codebase Improvements** (with lens chips & effort/impact tags), **POC Ideation Studio** (with 1-click **1-Day POC Blueprint** expansion), and **Lateral Thinking (SCAMPER / Diverge)**.
  - Validation: `npm run compile` + `npm test` + webview JS syntax check all pass.
- [x] **Step 5 — Package & Install `v0.9.0` Locally in Cursor and VS Code (No Git Commands)**
  - Bump version to `0.9.0`, package `.vsix`, install in Cursor and VS Code.
  - Validation: `cursor --list-extensions --show-versions` and `code --list-extensions --show-versions` confirm `0.9.0`.
