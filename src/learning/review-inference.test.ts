import { describe, expect, it } from 'vitest';
import { rootsForSelection } from '../shared/evaluator';
import { layerOf } from './review';
import { dropEchoChunks, evaluateLearningReview } from './learning-quality';

const sql = 'SELECT p.* FROM gpp.partner p WHERE p.deleted_at IS NOT NULL AND EXISTS (SELECT 1 FROM gpp.api_client a WHERE a.partner_id = p.id)';
const ctx = { file: 'PartnerRepository.java', line: 1, language: 'java', selection: sql, surrounding: '' };
const concept = (over: object) => ({ term: 'q', bottomLine: 'b', file: '', line: 0, ...over }) as never;

describe('layer and roots follow the content', () => {
  it('treats SQL as the data layer even inside a Java file or a chat card', () => {
    expect(layerOf(concept({ term: `""" ${sql.slice(0, 60)}`, file: 'PartnerRepository.java' }))).toBe('data');
    expect(layerOf(concept({ term: 'Solve chat', bottomLine: sql, file: '' }))).toBe('data');
  });

  it('gives SQL its own origin story instead of the generic one', () => {
    expect(rootsForSelection(sql).bottomLine).toContain('Codd');
    expect(rootsForSelection('SELECT a FROM t').bottomLine).not.toBe(rootsForSelection(sql).bottomLine);
  });
});

describe('background review', () => {
  const raw = `STATUS: revise\nEVIDENCE: p.deleted_at IS NOT NULL\nISSUE: The query returns a 401 error and throws an exception for bad status.\nBOTTOM_LINE: x\n### Fix\nbody`;
  const current = { bottomLine: 'Selects partners.', chunks: [], repaired: false };

  it('ignores a correction about things the source does not contain', () => {
    expect(evaluateLearningReview(raw, ctx, current).status).toBe('uncertain');
  });

  it('removes sections that only echo the prompt wording', () => {
    const cleaned = dropEchoChunks({ bottomLine: 'x', chunks: [{ title: 'chunks in the original answer format:', body: 'z' }, { title: 'Real', body: 'z' }], repaired: false });
    expect(cleaned.chunks.map((chunk) => chunk.title)).toEqual(['Real']);
  });
});

import { ANALOGY_DOMAINS, analogyDomain, deepPrompt } from './prompts';
describe('analogy variety', () => {
  it('assigns different worlds to different code, never a stencil or library', () => {
    const picked = new Set(['SELECT 1', 'class A {}', 'useState(0)', 'try { x() } catch (e) {}', 'foo.map(bar)', 'if (a) b();'].map((code) => analogyDomain(code).name));
    expect(picked.size).toBeGreaterThan(2);
    expect(ANALOGY_DOMAINS.map((domain) => domain.name).join(' ')).not.toMatch(/stencil|library|kitchen/);
    const prompt = deepPrompt({ ...ctx, selection: 'useState(0)' }, 'analogy')[1]!.content;
    expect(prompt).toContain(analogyDomain('useState(0)').name);
    expect(prompt).toContain('Do NOT use a stencil');
  });
});

import { preparedDeep } from './learning-quality';
describe('SQL lessons come from what the query actually contains', () => {
  const query = { ...ctx, selection: `SELECT p.* FROM partner p WHERE (CAST(:status AS TEXT) IS NULL OR p.partner_status = 'ACTIVE') AND EXISTS (SELECT 1 FROM cert c WHERE c.partner_id = p.id) AND LOWER(p.partner_name) LIKE '%' || LOWER(CAST(:search AS TEXT)) || '%' ORDER BY LOWER(p.partner_name)` };

  it('teaches EXISTS versus join and optional filters as foundations', () => {
    const lesson = preparedDeep(query, 'foundations')!;
    expect(lesson.chunks.map((chunk) => chunk.title)).toEqual(expect.arrayContaining(['Semi-join instead of join', 'Optional filters as predicates']));
  });

  it('names the performance choices that are really in the query, and says to measure', () => {
    const titles = preparedDeep(query, 'Trade-off: Performance')!.chunks.map((chunk) => chunk.title);
    expect(titles).toEqual(expect.arrayContaining(['Optional filters share one plan', 'Search with a leading %', 'Check before changing']));
    expect(titles).toHaveLength(4);
  });

  it('stays silent for SQL with nothing notable', () => {
    expect(preparedDeep({ ...ctx, selection: 'SELECT a FROM t' }, 'foundations')).toBeNull();
  });
});
