# Agent PIP — Workday Canvas Kit Layout & Constructivist Proun Graphic

> ✅ Simple-Medium — single-pass UI/graphic/diagram upgrade, zero external network changes, no git commands.

## Goals

1. **Constructivist / Proun Hero Graphic (`BANNER_SVG` & `media/icon.svg`)**
   - Replace the simplistic SVG with a high-precision, large-scale grayscale Constructivist / El Lissitzky *Proun* composition inspired by the two reference artworks:
     - Sweeping architectural C-arc + inner crescent
     - Three vertical colonnade pillars with lintel/base bars and extended counterweight
     - 3D axonometric Proun prism blocks with 3-tone shading (top/side/shadow planes)
     - 62° diagonal cantilever spine with trapezoid head, negative-space rule, rhythmic slatted wing-blocks, and outer drafting guide lines
     - Floating geometric counter-accents and datum lines
2. **Workday Canvas Kit Token System & Layout Architecture (`media/canvas-tokens.css` + `media/panel.css`)**
   - Import/define authentic Workday Canvas Kit v14 tokens (`--cnvs-sys-gap-*`, `--cnvs-sys-padding-*`, `--cnvs-sys-shape-*`, `--cnvs-sys-depth-*`, `--cnvs-sys-font-*`, `--cnvs-sys-color-*`) mapped cleanly to VS Code dark/light themes.
   - Replace the wall of 9 separate bordered `<details>` boxes with **Canvas Kit Card + Flush Disclosure (Accordion)** containers:
     - Single elevated Card surface per group, flush 1px dividers between expandable rows, rotating SVG chevron indicators, pill-shaped (`--cnvs-sys-shape-round`) Primary/Secondary buttons, and a Canvas Kit Segmented Control for `Learn · Solve · Create · Review`.
   - Integrate Plain breakdown, Analogy, Foundations, Roots, Pseudocode, and Trade-offs directly as flush expandable rows inside the Explanation Card (no separate mode selector chips).
   - Keep all expandables collapsed at the start, with a clean icon-only collapse-all button (`⌃`) in the bottom bar.
3. **Richer Multi-Lane Architectural Diagrams (`media/learn.js`)**
   - Upgrade Data Flow from a single vertical stack to a 3-lane flow graph (Entry → Core/Branch → Calls/Output) with curved Bézier connectors and step badges.
   - Upgrade Architecture and Testing Flow with distinct visual geometry and interactive walk highlighting.

## Implementation Steps

- [x] **Step 1 — Add Workday Canvas Kit token stylesheet (`media/canvas-tokens.css`) and update `panel.css`**
  - Define Canvas Kit v14 system tokens (`--cnvs-sys-gap-xs/sm/md/lg/xl`, `--cnvs-sys-padding-xs/sm/md/lg/xl`, `--cnvs-sys-shape-sm/md/x2/x4/round`, `--cnvs-sys-depth-1/2/4`, typography tokens) with automatic theme adaptation.
  - Style Canvas Kit Cards, Segmented Control, Pill Buttons, and Flush Disclosures.
  - Validation: CSS syntax check and visual structure verification.
- [x] **Step 2 — Rebuild Constructivist/Proun Hero Graphic & Canvas Kit HTML Layout (`src/banner.ts`, `src/sidebar.ts`, `src/panel.ts`, `media/icon.svg`)**
  - Create the new large-scale grayscale Constructivist/Proun SVG mark and activity bar icon.
  - Restructure `LEARN_BODY` into clean Canvas Kit Cards and flush Disclosure lists with integrated expandable perspectives.
  - Validation: `npm run compile` passes cleanly with zero TypeScript errors.
- [x] **Step 3 — Upgrade Interactive Diagrams & Progressive Disclosure in `media/learn.js` and `media/sidebar.js`**
  - Implement 3-lane Bézier Data Flow diagram, radial Architecture map, and branch-fan Testing diagram.
  - Ensure all expandables start collapsed, lazy-load perspectives on open, and collapse-all button resets all disclosures.
  - Validation: `npm test` (Vitest suite) passes 100% and webview JS parses cleanly.
- [x] **Step 4 — Package & Install Locally in Cursor and VS Code (No Git Commands)**
  - Bump version to `0.8.0`, package `.vsix`, install in both Cursor and VS Code.
  - Validation: `cursor --list-extensions --show-versions` and `code --list-extensions --show-versions` confirm `0.8.0`.
