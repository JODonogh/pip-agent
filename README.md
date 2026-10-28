# Agent PIP — Learn POC

Engineer-led learning that sits **beside your code** in VS Code **and** Cursor.
Local Ollama models only: model traffic is enforced to `localhost` in code and never leaves this machine.

## Try it (2 minutes)

1. In Cursor or VS Code: reload the window (`Cmd+Shift+P` → *Developer: Reload Window*) so the
   freshly installed extension activates.
2. Open any file, select a few lines of code.
3. `Cmd+Shift+L` (or right-click → **PIP: Explain selection**).
4. A disposable panel opens beside the editor:
   - **Bottom line first**, then expandable chunks — open only the ones you want.
   - Click any word in the answer to explain *that* (max depth 3, trail shown).
   - **⚡ Quick-fire** = one sentence. **🦆 Rubber-duck** = Socratic: one move, one question.
   - **★ Mark concept** → flashcard in the **Agent PIP** sidebar (activity bar).
   - **Drill me** in the sidebar → answer in your head, grade yourself: miss = weak spot
     (resurfaces first), two clean hits = mastered (stops cueing you).
   - Timebox is session-only and never saved. 🔊 reads the bottom line aloud.
5. Close the panel and it's gone. Only flashcards/weak-spots/stats persist (in the editor's
   own `globalState`, never in your repos).

## Settings

- `pip.ollamaUrl` — default `http://127.0.0.1:11434`. Non-localhost values are rejected in code.
- `pip.model` — default `mistral:latest` (explanations).
- `pip.fastModel` — default `mistral:latest` (quick-fire / duck / drills).
  You also have `llama3:8b` and `codegemma` locally — try `codegemma` for `pip.model`.

If Ollama is stopped, the panel falls back to a clearly-labelled deterministic Mock so the
learning loop still works offline at $0.

## Develop

```bash
npm install
npm run compile   # tsc, strict
npm test          # vitest — evaluator, memory scoring, localhost enforcement, providers
```

Press `F5` in this folder (VS Code or Cursor) for an Extension Development Host.
Repackage + reinstall after changes:

```bash
npm run package:vsix
cursor --install-extension agent-pip-0.1.0.vsix
code --install-extension agent-pip-0.1.0.vsix
```

## What's deliberately not here yet

Graphical (data-flow / coverage diagrams) → Solver → Innovator → A2UI are separate later
slices, each gated on your review of the previous one. See `.agents/plans/agent-pip-learn-poc.md`.
