# Agent PIP — Final: A2UI + declutter (Slice 5, last)

> ⚠️ Medium — UI restructure + model re-route. Single-pass to final.
> Stages: Learn ✅ Graphical ✅ Solver ✅ Innovator ✅ → **A2UI (this)**.

- [ ] **Step 1 — Mark, bigger, like the new references**
  - Grayscale composition after your arc/bars/slatted-block references: big arc, vertical
    bars, tilted slatted block, diagonal. Larger and centred; same for the activity icon.
- [ ] **Step 2 — Faster models (benchmarked locally)**
  - Explain/deep: `codegemma` (~3s warm, keeps chunk format). Fast tasks (popup, duck,
    solver, drills, games, converge): `gemma:2b-instruct` (sub-second warm). Mistral remains
    selectable in Settings. Evaluator also strips stray `##` before BOTTOM_LINE.
  - Validation: warm timings re-measured; format tests green.
- [ ] **Step 3 — Styles live inside expandables, not as selectors**
  - Plain/Analogy/Foundations chips and the mode select leave the top. Under each explanation
    sit lazy expandables — *With an analogy · Foundations · Roots & history · Pseudocode ·
    Trade-offs* — content loads only when first opened. Visual/Auditory switch moves to More.
- [ ] **Step 4 — A2UI: the drawer reshapes by intent**
  - Segmented control: **Learn · Solve · Create · Review**. Only that group's sections show;
    everything else hides. This is the anti-chat UI thesis of the whole project: the interface
    adapts to what you are doing instead of one long scroll of everything.
  - Validation: on open, only banner + Explain/Mark/Read + Timebox + Learn/Solve/Create/Review
    + the Learn group are visible.
- [ ] **Step 5 — Voices: natural only**
  - Voice picker lists only natural-class voices (Premium/Enhanced/Natural/Flo/Eddy/Reed);
    robotic compact voices are filtered out entirely, with a download hint if none exist.
- [ ] **Step 6 — v0.7.0 final build**
  - Tests, reinstall both editors, README brought up to date, commit.
  - Push to `JODonogh/agent-pip` the moment GitHub auth completes on your side.
