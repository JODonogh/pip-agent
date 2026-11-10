import { describe, expect, it, vi } from 'vitest';
import {
  cleanSpeechText,
  evaluateDuck,
  evaluateExplanation,
  evaluateQuickFire,
  filterNaturalVoices,
  firstAppFrame,
  looksLikeHistory,
  preferredSpeakVoices,
  rootsForSelection,
  parseDrillVerdict,
  codeAnchors,
  groundedInCode,
  localImprovements,
  parseAiLabCard,
  parseImprovements,
  parsePocIdeas,
  parseSolver,
  stripModelThinking,
} from '../shared/evaluator';
import { explainPrompt, improveCodebasePrompt, pocIdeasPrompt } from '../agents/prompts';
import { pickNextDailyBite, CURRICULUM_BITES } from '../learning/ai-curriculum';
import { aiLabPrompt } from '../learning/prompts';
import { normalizeCurriculumFacet } from '../shared/evaluator';
import { assertLocalhost } from '../shared/types';
import { MockProvider, OllamaProvider } from '../platform/provider';
import {
  bestHint,
  grade,
  hintScore,
  learningBrief,
  recordLearning,
  referenceBottomLine,
  rungOf,
  sortForReview,
} from '../learning/memory';
import type { Concept } from '../shared/types';

describe('localhost enforcement', () => {
  it('accepts localhost and 127.0.0.1', () => {
    expect(assertLocalhost('http://127.0.0.1:11434').hostname).toBe('127.0.0.1');
    expect(assertLocalhost('http://localhost:11434').hostname).toBe('localhost');
  });
  it('rejects any remote model host', () => {
    expect(() => assertLocalhost('https://api.openai.com')).toThrow(/local-only/);
    expect(() => assertLocalhost('http://192.168.1.10:11434')).toThrow(/local-only/);
  });
});

describe('OllamaProvider', () => {
  it('parses a chat response via stubbed fetch (no network)', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        message: { content: 'BOTTOM_LINE: hi' },
        eval_count: 40,
        eval_duration: 2e9,
      }),
    })) as unknown as typeof fetch;
    const provider = new OllamaProvider('http://127.0.0.1:11434', fetchFn);
    const result = await provider.chat([{ role: 'user', content: 'x' }], 'mistral:latest');
    expect(result.text).toBe('BOTTOM_LINE: hi');
    expect(result.fromMock).toBe(false);
    expect(result.evalCount).toBe(40);
    expect(result.evalDuration).toBe(2e9);
    expect(result.tokensPerSecond).toBe(20);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
  it('lists installed models from /api/tags', async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : new URL(input.url).pathname;
      if (path.endsWith('/api/tags')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            models: [{ name: 'qwen2.5-coder:14b' }, { name: 'deepseek-r1:8b' }],
          }),
        };
      }
      throw new Error(`unexpected fetch: ${path}`);
    }) as unknown as typeof fetch;
    const provider = new OllamaProvider('http://127.0.0.1:11434', fetchFn);
    await expect(provider.getInstalledModels()).resolves.toEqual([
      'qwen2.5-coder:14b',
      'deepseek-r1:8b',
    ]);
  });
  it('falls back to mock when /api/tags is unreachable', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const provider = new OllamaProvider('http://127.0.0.1:11434', fetchFn);
    await expect(provider.getInstalledModels()).resolves.toEqual(['mock']);
  });
  it('uses a larger context only when explicitly requested for source comparison', async () => {
    const bodies: any[] = [];
    const fetchFn = (async (_url: unknown, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return { ok: true, status: 200, json: async () => ({ message: { content: 'ok' } }) };
    }) as unknown as typeof fetch;
    const provider = new OllamaProvider('http://127.0.0.1:11434', fetchFn);
    await provider.chat([{ role: 'user', content: 'small' }], 'local');
    await provider.chat([{ role: 'user', content: 'comparison' }], 'local', 380, undefined, 8192);
    expect(bodies.map(body => body.options.num_ctx)).toEqual([4096, 8192]);
  });
  it('throws on a dead server so the orchestrator can fall back', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const provider = new OllamaProvider('http://127.0.0.1:11434', fetchFn);
    await expect(provider.chat([{ role: 'user', content: 'x' }], 'mistral')).rejects.toThrow();
  });
});

describe('evaluator', () => {
  it('keeps bottom line first and caps chunk words', () => {
    const raw = `BOTTOM_LINE: One line. Extra sentence.\n### Big\n${'word '.repeat(80)}`;
    const out = evaluateExplanation(raw);
    expect(out.bottomLine).toBe('One line.');
    expect(out.chunks[0]?.body).not.toContain('[cut by evaluator]');
    expect(out.chunks[0]?.body.split(/\s+/).length).toBeLessThanOrEqual(60);
    expect(out.repaired).toBe(true);
  });
  it('tolerates a markdown ## before BOTTOM_LINE (codegemma/qwen habit)', () => {
    expect(evaluateExplanation('## BOTTOM_LINE: Clean line.\n### Part\nBody text.').bottomLine).toBe('Clean line.');
  });
  it('quick-fire always returns exactly one sentence', () => {
    expect(evaluateQuickFire('First. Second! Third?').text).toBe('First.');
  });
  it('duck ends with exactly one question', () => {
    const out = evaluateDuck('Holds, because of X? Also Y?');
    expect(out.text.endsWith('?')).toBe(true);
    expect((out.text.match(/\?/g) ?? []).length).toBe(1);
  });
  it('parseAiLabCard extracts legacy three markdown sections', () => {
    const raw = [
      '### 1. The AI Concept (60 Seconds)',
      'Attention distributes weight across tokens.',
      '### 2. How PIP Demonstrates or Violates This',
      'src/platform/provider.ts records eval_count.',
      '### 3. 15-Minute Code Experiment',
      'Log tokensPerSecond after one explain call.',
    ].join('\n');
    const card = parseAiLabCard(raw);
    expect(card.concept).toContain('Attention');
    expect(card.wherePip).toContain('provider.ts');
    expect(card.experiment).toContain('tokensPerSecond');
  });
  it('parseAiLabCard extracts four-part Brilliant micro-card sections', () => {
    const raw = [
      '### 💡 The Big Idea (30s Read)',
      'Temperature spreads probability mass.',
      '### 🔍 Everyday Analogy',
      'Like turning up randomness on a playlist shuffle.',
      '### 🎯 Quick Knowledge Check',
      '**Question:** What happens at T=0?\nA) Greedy\nB) Uniform\nC) Noise',
      '<details><summary>Reveal</summary>**Answer:** A — always pick the top token.</details>',
      '### 🛠️ PIP Connection or Hack',
      'Tweak temperature in src/platform/provider.ts.',
    ].join('\n');
    const card = parseAiLabCard(raw);
    expect(card.concept).toContain('Temperature');
    expect(card.analogy).toContain('playlist');
    expect(card.knowledgeCheck).toContain('Question');
    expect(card.wherePip).toContain('provider.ts');
  });
  it('strips deepseek-style thinking blocks before parsing AI Lab cards', () => {
    const raw = `<think>hidden chain</think>\n### 1. The AI Concept (60 Seconds)\nTokens.\n### 2. How PIP Demonstrates or Violates This\nprovider.ts\n### 3. 15-Minute Code Experiment\nAdd a log line.`;
    expect(stripModelThinking(raw)).not.toContain('hidden chain');
    const card = parseAiLabCard(raw);
    expect(card.concept).toBe('Tokens.');
    expect(card.wherePip).toContain('provider.ts');
    expect(card.experiment).toContain('log line');
  });
  it('ships at least 30 curriculum concepts across five tracks', () => {
    expect(CURRICULUM_BITES.length).toBeGreaterThanOrEqual(30);
    const tracks = new Set(CURRICULUM_BITES.map((bite) => bite.facet));
    expect(tracks.size).toBe(5);
  });
  it('picks unread daily bites then cycles the facet track', () => {
    const first = pickNextDailyBite({ readIds: [], trackIndex: 0 }, 'alignment');
    expect(first.bite.facet).toBe('alignment');
    const second = pickNextDailyBite({ readIds: [first.bite.id], trackIndex: first.progress.trackIndex }, 'alignment');
    expect(second.bite.id).not.toBe(first.bite.id);
    const pool = CURRICULUM_BITES.filter((bite) => bite.facet === 'alignment').map((bite) => bite.id);
    const readAll = { readIds: pool, trackIndex: 0 };
    const again = pickNextDailyBite(readAll, 'alignment');
    expect(again.cycled).toBe(true);
    expect(normalizeCurriculumFacet('inference')).toBe('inference');
    expect(normalizeCurriculumFacet('nope')).toBe('all');
  });
  it('aiLabPrompt includes facet, model, question, and optional selection', () => {
    const msgs = aiLabPrompt('What is temperature?', 'inference', 'qwen2.5-coder:14b', {
      file: 'provider.ts', line: 1, language: 'typescript', selection: 'const x = 1;', surrounding: '',
    });
    expect(msgs).toHaveLength(2);
    expect(msgs.every((message) => message.role === 'system' || message.role === 'user')).toBe(true);
    expect(msgs[0]?.content).toContain('### 🎯 Quick Knowledge Check');
    expect(msgs[1]?.content).toContain('Domain Track: inference');
    expect(msgs[1]?.content).toContain('Model: qwen2.5-coder:14b');
    expect(msgs[1]?.content).toContain('const x = 1;');
    expect(aiLabPrompt('solo question', 'all', 'mock')[1]?.content).not.toContain('Open editor context');
  });
  it('mock provider explains deterministically', async () => {
    const mock = new MockProvider();
    const res = await mock.chat(
      [{ role: 'user', content: '[INTENT:explain]\n```ts\nconst x = 1;\n```' }],
      'mock',
    );
    expect(res.fromMock).toBe(true);
    expect(evaluateExplanation(res.text).bottomLine).toContain('const x = 1;');
  });
});

describe('no formulaic chunks + drill verdicts', () => {
  it('explainer prompt bans the generic chunk titles', () => {
    const prompt = explainPrompt({
      file: 'A.java',
      line: 1,
      language: 'java',
      selection: 'class A {}',
      surrounding: '',
    });
    const text = prompt.map((m) => m.content).join('\n');
    expect(text).toContain('Example format and tone');
    expect(text).toContain('BOTTOM_LINE: Early return on blank input');
  });
  it('keeps a single-line SQL fragment scoped to LIKE/LOWER/ESCAPE, not the whole query', () => {
    const likeLine = `OR LOWER(p.partner_name) LIKE '%' || LOWER(CAST(:search AS TEXT)) || '%' ESCAPE '\\'`;
    const prompt = explainPrompt({
      file: 'PartnerRepo.sql',
      line: 12,
      language: 'sql',
      selection: likeLine,
      surrounding: 'SELECT p.* FROM gpp.partner p WHERE (p.deleted_at IS NOT NULL) = :offboarded',
    });
    const text = prompt.map((m) => m.content).join('\n');
    expect(text).toContain('ONLY explain this');
    expect(text).toContain('fragment of a larger statement');
    expect(text).toContain('LIKE');
    expect(text).toContain('LOWER()');
    expect(text).toContain('ESCAPE');
    expect(text).toContain('Reference only, DO NOT explain');
  });
  it('parses drill verdicts, defaulting unclear to PARTLY', () => {
    expect(parseDrillVerdict('CORRECT\nYou nailed the capture part.').verdict).toBe('CORRECT');
    expect(parseDrillVerdict('WRONG\nNot quite.').verdict).toBe('WRONG');
    expect(parseDrillVerdict('some rambling').verdict).toBe('PARTLY');
  });
});

describe('solver', () => {
  it('parses the 4-part solver reply', () => {
    const reply = parseSolver(
      'RESTATE: The endpoint 500s on empty carts.\nCAUSE: total is null (confidence: likely)\nCHECK: Log cart.total before the reduce.\nQUESTION: Does it fail for every cart?',
    );
    expect(reply.restate).toContain('500s');
    expect(reply.cause).toBe('total is null');
    expect(reply.confidence).toBe('likely');
    expect(reply.check).toContain('Log');
  });
  it('extracts the first application frame, skipping JDK frames', () => {
    const trace = [
      'java.lang.NullPointerException: boom',
      '\tat java.base/java.util.Objects.requireNonNull(Objects.java:209)',
      '\tat com.workday.portal.CartService.total(CartService.java:42)',
    ].join('\n');
    expect(firstAppFrame(trace)).toContain('CartService.java:42');
  });
});

describe('natural voices & ideation parsers', () => {
  it('excludes Eloquence robotic voices (Flo, Eddy, Reed) and keeps natural voices (Daniel, Moira)', () => {
    const lines = [
      'Flo (English (UK))  en_GB    # Hello! My name is Flo.',
      'Eddy (English (US)) en_US    # Hello! My name is Eddy.',
      'Reed (English (UK)) en_GB    # Hello! My name is Reed.',
      'Daniel              en_GB    # Hello! My name is Daniel.',
      'Moira               en_IE    # Hello! My name is Moira.',
      'Bad News            en_US    # Hello! My name is Bad News.',
    ];
    const voices = filterNaturalVoices(lines);
    expect(voices).toEqual(['Daniel', 'Moira']);
    expect(cleanSpeechText('Calls `getAll()` **fast** -> done')).toBe('Calls getAll() fast to done');
  });
  it('speaks with premium voices and leaves compact Daniel out', () => {
    const voices = preferredSpeakVoices([
      { id: 'com.apple.voice.compact.en-GB.Daniel', name: 'Daniel' },
      { id: 'com.apple.eloquence.en-GB.Flo', name: 'Flo (English (UK))' },
      { id: 'com.apple.voice.Aman.premium', name: 'Aman (English (India))' },
      { id: 'com.apple.voice.Tara.premium', name: 'Tara (English (India))' },
    ]);
    expect(voices.map((voice) => voice.id)).toEqual([
      'com.apple.voice.Tara.premium',
      'com.apple.voice.Aman.premium',
    ]);
    expect(voices[0]?.label).toBe('Tara · premium');
  });
  it('treats a feature summary as not history, and useState as the 2018 hooks proposal', () => {
    const summary =
      'This code snippet introduces a dynamic error banner that adjusts its content based on the number of errors, providing users with a clear and actionable interface for viewing all errors or hiding them.';
    expect(looksLikeHistory(summary)).toBe(false);
    const story = rootsForSelection('const [open, setOpen] = useState(false);\nreturn null;');
    expect(story.bottomLine).toMatch(/2018/);
    expect(story.bottomLine).toMatch(/Alpert/);
    expect(story.bottomLine.toLowerCase()).not.toContain('error banner');
  });
  it('parses codebase improvement cards and POC ideation cards', () => {
    const imp = parseImprovements(
      'IMPROVE: Architecture | Extract policy | Decouples controller | Move check into PolicyService | XS · 20m',
    );
    expect(imp).toHaveLength(1);
    expect(imp[0]?.category).toBe('Architecture');
    expect(imp[0]?.effort).toContain('XS');

    const pocs = parsePocIdeas(
      'POC: Contract Runner | Run API specs beside code | Proves 3x faster debugging | 1 localhost command | Live latency diff',
    );
    expect(pocs).toHaveLength(1);
    expect(pocs[0]?.title).toBe('Contract Runner');
    expect(pocs[0]?.slice).toContain('localhost');
  });
  it('drops ideas that are not about the file being examined', () => {
    const ctx = {
      file: 'src/ErrorBanner.tsx',
      line: 12,
      language: 'typescriptreact',
      selection: 'const [expanded, setExpanded] = useState(false);\nif (!errorResponse) return null;',
      surrounding: '',
    };
    const anchors = codeAnchors(ctx);
    expect(anchors).toContain('ErrorBanner');
    expect(anchors).toContain('useState');
    expect(groundedInCode('Add pagination to the partner API', anchors)).toBe(false);
    const ideas = localImprovements(ctx);
    expect(ideas.length).toBeGreaterThan(0);
    for (const idea of ideas) {
      expect(groundedInCode(`${idea.title} ${idea.why} ${idea.change}`, anchors)).toBe(true);
      expect(`${idea.why} ${idea.change}`).toContain('ErrorBanner.tsx');
    }
    const improve = improveCodebasePrompt(ctx).map((message) => message.content).join('\n');
    expect(improve).toContain('src/ErrorBanner.tsx');
    expect(improve).toContain('useState');
    expect(improve).not.toContain('inspired by this code');
    const poc = pocIdeasPrompt(ctx, 'a billing platform').map((message) => message.content).join('\n');
    expect(poc).toContain('src/ErrorBanner.tsx');
    expect(poc).toContain('do not ignore the pain point');
  });
});

const concept = (over: Partial<Concept>): Concept => ({
  id: '1',
  term: 'closure',
  bottomLine: 'A closure captures variables from its scope',
  file: 'a.ts',
  line: 1,
  createdAt: 0,
  lastSeenAt: 0,
  hits: 0,
  misses: 0,
  mastered: false,
  ...over,
});

describe('memory scoring (simplified conditioning)', () => {
  const now = 1_700_000_000_000;
  it('recent strong cue beats an old one (eligibility trace)', () => {
    const recent = concept({ id: 'r', lastSeenAt: now });
    const old = concept({ id: 'o', lastSeenAt: now - 30 * 86_400_000 });
    expect(hintScore(recent, 'how does a closure capture scope', now)).toBeGreaterThan(
      hintScore(old, 'how does a closure capture scope', now),
    );
  });
  it('mastered concepts are blocked from hinting', () => {
    const mastered = concept({ mastered: true, lastSeenAt: now });
    expect(bestHint([mastered], 'closure capture scope', now)).toBeNull();
  });
  it('overshadowing: only the strongest cue is offered', () => {
    const strong = concept({ id: 's', lastSeenAt: now, misses: 3 });
    const weak = concept({ id: 'w', lastSeenAt: now - 6 * 86_400_000 });
    expect(bestHint([weak, strong], 'closure capture scope variables', now)?.id).toBe('s');
  });
  it('stores a note and teaches the next rung from it', () => {
    const now = 1_700_000_000_000;
    const code = 'const [open, setOpen] = useState(false);';
    expect(learningBrief([], code, 'Card.tsx').nextRung).toBe('basic');
    const first = recordLearning(undefined, {
      term: 'useState',
      bottomLine: 'A hook that keeps a value between renders.',
      file: 'Card.tsx',
      line: 4,
      now,
    });
    const brief = learningBrief([first], code, 'Card.tsx');
    expect(brief.nextRung).toBe('working');
    expect(brief.known[0]?.term).toBe('useState');
    expect(brief.reference).toContain('useState');
    expect(referenceBottomLine('This banner toggles open.', brief)).toBe(
      'Building on useState: This banner toggles open.',
    );
    const second = recordLearning(first, {
      term: 'useState',
      bottomLine: 'The setter schedules another render.',
      file: 'Card.tsx',
      line: 4,
      now: now + 10,
    });
    expect(second.exposures).toBe(2);
    expect(rungOf(second)).toBe('working');
    expect(learningBrief([second], code, 'Card.tsx').nextRung).toBe('complex');
    const mastered = { ...second, mastered: true, hits: 2 };
    expect(learningBrief([mastered], code, 'Card.tsx').known).toHaveLength(1);
  });
  it('grade: miss makes a weak spot that sorts first; two hits master it', () => {
    const missed = grade(concept({}), false, now);
    expect(sortForReview([concept({ id: 'x' }), missed])[0]?.id).toBe('1');
    const once = grade(concept({}), true, now);
    expect(grade(once, true, now).mastered).toBe(true);
  });
});


it('keeps explanation prose while discarding echoed fenced code', () => {
  const result = evaluateExplanation('BOTTOM_LINE: Replaces a module.\n### The seam\nThe factory provides the replacement.\n```typescript\nvi.mock("module", () => replacement);\n```');
  expect(result.chunks[0]?.body).toBe('The factory provides the replacement.');
});
