import { describe, expect, it } from 'vitest';
import { extractKeywords, isKeyword } from '../learning/keywords';
import { analyzeCode, analyzeDiagrams, LAYER_OF_KIND } from '../diagrams/diagram';
import { makeCloze, parseApproaches, parseMcq } from '../shared/evaluator';
import { deriveVerify } from '../diagrams/verify';
import { PipStore } from '../platform/store';
import type { CodeContext, Concept } from '../shared/types';

describe('keywords only (not every word)', () => {
  it('rejects common words', () => {
    for (const w of ['the', 'defines', 'named', 'when', 'called', 'will', 'this']) {
      expect(isKeyword(w, false)).toBe(false);
    }
  });
  it('accepts code and technical terms', () => {
    for (const w of ['@GetMapping', 'getAll()', 'LIKE', 'annotation', 'closure']) {
      expect(isKeyword(w, false)).toBe(true);
    }
    expect(isKeyword('anything', true)).toBe(true); // inside `code span`
  });
  it('extracts a small set from a sentence', () => {
    const keys = extractKeywords('This code defines an HTTP GET request endpoint named `getAll`.');
    expect(keys).not.toContain('http');
    expect(keys).toContain('getall');
    expect(keys).not.toContain('defines');
    expect(keys.length).toBeLessThan(6);
  });
});

const springCtx: CodeContext = {
  file: 'BackendController.java',
  line: 20,
  language: 'java',
  selection: `
    @GetMapping("/api/v1/backend")
    public List<Backend> getAll() {
        return backendService.findAll();
    }`,
  surrounding: '',
};

const reactCtx: CodeContext = {
  file: 'Card.tsx',
  line: 5,
  language: 'typescriptreact',
  selection: `
    import { useState } from 'react';
    export const Card = (props: Props) => {
      const [open, setOpen] = useState(false);
      return renderCard(props);
    };`,
  surrounding: '',
};

describe('diagram analyser (Systematic/Graphical)', () => {
  it('maps a Spring endpoint: endpoint → method → call → return', () => {
    const d = analyzeCode(springCtx);
    const kinds = d.nodes.map((n) => n.kind);
    expect(kinds).toContain('endpoint');
    expect(d.nodes.find((n) => n.kind === 'endpoint')?.label).toContain('/api/v1/backend');
    expect(d.nodes.find((n) => n.kind === 'method')?.label).toBe('getAll()');
    expect(d.nodes.some((n) => n.kind === 'call' && n.label.includes('findAll'))).toBe(true);
    expect(kinds).toContain('return');
    expect(d.edges.some((e) => e.to.startsWith('method:'))).toBe(true);
  });
  it('produces three views: data flow, architecture, testing', () => {
    const all = analyzeDiagrams(springCtx);
    expect(all.dataFlow.nodes.some((n) => n.kind === 'call')).toBe(true);
    expect(all.architecture.nodes.every((n) => ['endpoint', 'method', 'import'].includes(n.kind))).toBe(true);
    expect(all.testing.nodes.some((n) => n.kind === 'assert')).toBe(true);
    expect(all.testing.nodes.some((n) => n.label.startsWith('Act:'))).toBe(true);
  });
  it('testing flow surfaces branches to test both sides of', () => {
    const branchy: CodeContext = {
      ...springCtx,
      selection: 'public int f(int x) { if (x > 0) { return x; } try { work(); } catch (Exception e) { return -1; } }',
    };
    const all = analyzeDiagrams(branchy);
    expect(all.testing.nodes.some((n) => n.kind === 'branch')).toBe(true);
  });
  it('maps a React component: import, hook, state layers', () => {
    const d = analyzeCode(reactCtx);
    expect(d.nodes.some((n) => n.kind === 'import')).toBe(true);
    expect(d.nodes.some((n) => n.kind === 'state' && n.label.includes('setOpen'))).toBe(true);
    expect(LAYER_OF_KIND['state']).toBe('hooks');
    expect(LAYER_OF_KIND['call']).toBe('calls');
  });
});

describe('innovator + games + verify parsers', () => {
  it('parses approaches and MCQ, rejects broken MCQ', () => {
    expect(parseApproaches('APPROACH: A — x\nAPPROACH: B — y\nnoise')).toHaveLength(2);
    const mcq = parseMcq('Q: Why?\nA: one\nB: two\nC: three\nD: four\nANSWER: C');
    expect(mcq?.answerIndex).toBe(2);
    expect(parseMcq('Q: broken')).toBeNull();
  });
  it('cloze blanks the term out of its own line', () => {
    expect(makeCloze({ term: 'getAll', bottomLine: 'getAll returns everything' })).toBe('______ returns everything');
  });
  it('verify derives a Bruno request and a DB hint from an endpoint', () => {
    const verify = deriveVerify(springCtx, analyzeDiagrams(springCtx));
    expect(verify.http).toEqual({ method: 'GET', path: '/api/v1/backend' });
    expect(deriveVerify({ ...springCtx, selection: 'repo.findAll()' }, analyzeDiagrams(springCtx)).sqlHint).toContain('SELECT');
  });
});

class FakeMemento {
  private data = new Map<string, unknown>();
  get<T>(key: string, fallback: T): T {
    return (this.data.get(key) as T) ?? fallback;
  }
  async update(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
  }
  keys(): readonly string[] {
    return [...this.data.keys()];
  }
}

describe('PipStore — Mark Concept regression', () => {
  it('mark → listed once; re-marking same spot does not duplicate', async () => {
    const store = new PipStore(new FakeMemento() as never);
    const concept: Concept = {
      id: 'getAll|BackendController.java|20',
      term: 'getAll',
      bottomLine: 'Defines a GET endpoint.',
      file: 'BackendController.java',
      line: 20,
      createdAt: 1,
      lastSeenAt: 1,
      hits: 0,
      misses: 0,
      mastered: false,
    };
    await store.upsertConcept(concept);
    await store.upsertConcept(concept);
    expect(store.concepts()).toHaveLength(1);
    expect(store.concepts()[0]?.term).toBe('getAll');
  });
});
