import { describe, expect, it } from 'vitest';
import type * as vscode from 'vscode';
import { buildDayReview, conceptsForLocalDay, localDateKey, retrievalQuestions, safeReviewCard } from './day-summary';
import { PipStore } from '../platform/store';
import type { Concept } from '../shared/types';

const morning = new Date(2026, 10, 2, 10, 30).getTime();
const yesterday = new Date(2026, 10, 1, 10, 30).getTime();
const note = (over: Partial<Concept> = {}): Concept => ({
  id: 'normalizeSearch|PartnerService.java', term: 'normalizeSearch',
  bottomLine: 'Escaping characters for LIKE queries prevents SQL injection.',
  file: 'PartnerService.java', line: 42,
  createdAt: morning, lastSeenAt: morning, hits: 0, misses: 0, mastered: false, ...over,
});

describe('daily retrieval practice', () => {
  it('asks a useful SQL distinction without replaying an unsafe stored assertion', () => {
    const review = buildDayReview([note()], '2026-11-02');
    expect(review.questions).toHaveLength(1);
    expect(review.questions[0]).toMatchObject({ conceptId: note().id, term: 'normalizeSearch', source: 'PartnerService.java:42' });
    expect(review.questions[0]?.question).toContain('SQL LIKE matching');
    expect(review.questions[0]?.question).toContain('parameter binding a separate concern');
    expect(review.text).not.toContain('prevents SQL injection');
  });

  it('does not mistake everyday like for the SQL operator', () => {
    const question = buildDayReview([note({ term: 'gate', bottomLine: 'Acts like a guard before access.' })]).questions[0]!.question;
    expect(question).not.toContain('SQL');
  });

  it('returns separate questions anchored to retained sources rather than a merged three-hint paragraph', () => {
    const review = buildDayReview([
      note(),
      note({ id: 'client', term: 'vi.mock', file: 'client.test.ts', bottomLine: 'The mock simulates fetch requests.' }),
      note({ id: 'wait', term: 'await response', file: 'request.ts', bottomLine: 'The async callback returns a Promise.' }),
    ], '2026-11-02');
    expect(review.questions).toHaveLength(3);
    expect(review.text.split('\n')).toHaveLength(3);
    expect(review.questions.every((question) => question.question.endsWith('?') && question.source)).toBe(true);
    expect(review.questions.find((question) => question.term === 'vi.mock')?.question).toContain('what additional evidence');
    expect(review.questions.find((question) => question.term === 'await response')?.question).toContain('what must finish');
    expect(review.text).not.toContain('simulates fetch requests');
  });

  it('does not borrow older notes when there is nothing for today', () => {
    const old = note({ createdAt: yesterday, lastSeenAt: yesterday });
    expect(conceptsForLocalDay([old], localDateKey(new Date(morning)))).toEqual([]);
    expect(buildDayReview([], '2026-11-02').questions).toEqual([]);
  });

  it('asks retrieval questions tuned to kept AI mechanics observations', () => {
    const ai = note({
      id: 'temp-probe',
      term: 'debug temperature',
      bottomLine: 'Compared temperature 0.1 vs 0.7 on the same Ollama model; trace length diverged.',
      file: 'provider.ts',
    });
    const question = buildDayReview([ai], '2026-11-02').questions[0]!.question;
    expect(question).toContain('T=0.1');
    expect(question).toContain('0.7');
    expect(question).not.toContain('diverged');
  });

  it('prioritises missed concepts, deduplicates a kept idea and preserves its hypothesis status', () => {
    const weak = note({ id: 'weak', term: 'order dependency', file: 'OrderTest.java', bottomLine: 'Hypothesis to check: order changes the result.', misses: 2 });
    const questions = retrievalQuestions([note(), weak, { ...weak, id: 'same-idea' }]);
    expect(questions[0]?.term).toBe('order dependency');
    expect(questions[0]?.question).toContain('rule it out');
    expect(questions).toHaveLength(2);
    expect(retrievalQuestions([note()], 0)).toEqual([]);
  });
});

describe('safe previous summaries', () => {
  it('rebuilds a legacy merged summary from the matching kept notes instead of displaying its prose', () => {
    const saved = { date: '2026-11-01', text: 'Hint: escaping prevents SQL injection. Hint: review this. Hint: remember it.' };
    const review = safeReviewCard(saved, [note({ createdAt: yesterday, lastSeenAt: yesterday })]);
    expect(review?.questions).toHaveLength(1);
    expect(review?.text).not.toContain('prevents SQL injection');
    expect(saved.text).toContain('Hint: escaping prevents');
    expect(review?.schemaVersion).toBe(2);
  });

  it('never displays stale summary prose when its kept notes have been removed', () => {
    expect(safeReviewCard({ date: '2026-11-01', text: 'Unsafe legacy claim.' }, [])).toBeNull();
    expect(safeReviewCard({ date: '2026-11-01', text: 'Unsafe new claim.', conceptIds: ['deleted'], schemaVersion: 2 }, [note()])).toBeNull();
  });

  it('normalises cards on read without rewriting or deleting persisted user data', async () => {
    const values = new Map<string, unknown>([
      ['pip.concepts.v1', [note({ createdAt: yesterday, lastSeenAt: yesterday })]],
      ['pip.review.v1', { date: '2026-11-01', text: 'Escaping LIKE prevents SQL injection.' }],
    ]);
    const before = JSON.stringify([...values]);
    const state = {
      get: (key: string, fallback: unknown) => values.get(key) ?? fallback,
      update: async (key: string, value: unknown) => { values.set(key, value); },
    } as unknown as vscode.Memento;
    const store = new PipStore(state);
    expect(store.review()?.questions).toHaveLength(1);
    expect(store.review()?.text).not.toContain('prevents SQL injection');
    expect(JSON.stringify([...values])).toBe(before);
    const current = buildDayReview([note()], '2026-11-02');
    await store.saveReview(current);
    expect(store.review()?.questions?.[0]?.conceptId).toBe(note().id);
  });
});
