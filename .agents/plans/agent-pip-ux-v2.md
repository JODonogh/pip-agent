# Agent PIP — UX v2 fixes + multi-diagram Graphical

> ✅ Simple-Medium — mostly UI restructure + one analyser extension. Single-pass.
> Driven by your screenshots (28 Oct evening). No new phase until this is reviewed.

## Fixes

- [ ] **Step 1 — Icon actually changes**
  - Bump version (same-version reinstall was serving the cached `?` icon), bolder filled
    triangular icon at full canvas size.
  - Validation: reinstall, icon in activity bar is the triangle/circle/bars mark, not `?`.
- [ ] **Step 2 — De-crowd + bigger overlapping banner**
  - Banner becomes a wide overlapping composition (wedge over circle, bars crossing a solid
    square — Lissitzky/Malevich structure, monochrome), not a row of small shapes.
  - Top row ONLY: Explain selection · Mark concept · Read aloud.
  - Everything else (Re-explain, Open beside, Shortcuts, voice, timer) moves to a bottom
    "More" drawer; secondary controls become icon buttons with tooltip rollovers.
  - Diagram moves up, directly under the explanation.
  - Validation: manual screenshot comparison — top of sidebar is banner + 3 buttons only.
- [ ] **Step 3 — Nested explain keeps context + is faster**
  - Clicking a word appends an inline "Digging deeper" card; the original explanation and its
    expandables are untouched (current behaviour replaces them — the bug you saw).
  - Instant placeholder card, host-side cache (same term+file = instant), fast model route with
    a 180-token cap for nested explains.
  - Validation: click word → original chunks remain expanded as left; repeat click is cached.
- [ ] **Step 4 — Voice via macOS `say`**
  - No Enhanced/Premium voices are downloaded on this Mac (checked: 0), which is why it sounds
    robotic. Rank the newer Flo/Eddy/Reed (UK) voices above Samantha, speak through the
    extension host (`say`), picker lists real system voices.
  - Optional your-side upgrade: Settings → Accessibility → Spoken Content → Manage Voices →
    download a Premium voice; PIP will then rank it first automatically.
  - Validation: voice list in UI matches `say -v '?'`; Read speaks with the picked voice.
- [ ] **Step 5 — Three diagrams, not one**
  - Selector: **Data flow** (endpoint→method→calls→return) · **Architecture** (method +
    dependency/import satellites) · **Testing flow** (Arrange→Act→branches→Assert, branches
    detected from if/try/assert in the selection). Layer toggles retained. Click node → nested
    explain (Step 3), diagram moves up under the explanation.
  - Validation: analyser tests for all three on the Spring sample + a branching sample.
- [ ] **Step 6 — Rebuild, reinstall both editors, commit**
  - Tests + `tsc` green, VSIX bumped/reinstalled in Cursor + VS Code, git commit.
  - Push still blocked on your one-time auth: `gh auth login -h github.com -w`
    (no `-u` flag on this gh version — my earlier instruction was wrong), then say "push it".
