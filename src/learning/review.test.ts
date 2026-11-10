import { describe, expect, it } from 'vitest';
import type { Concept } from '../shared/types';
import { conceptTerm, recordLearning } from './memory';
import { clozeFor, reviewStatus, reviewView, layerOf, drillFocus } from './review';

const concept = (over: Partial<Concept> = {}): Concept => ({
  id: 'getAll|FrontController.java',
  term: 'getAll',
  bottomLine: 'This code defines an HTTP GET request endpoint named getAll.',
  file: 'backend/src/main/java/org/llm/FrontController.java',
  line: 17,
  createdAt: 1,
  lastSeenAt: 1,
  hits: 0,
  misses: 0,
  mastered: false,
  ...over,
});

describe('conceptTerm', () => {
  it('names a call chain as one idea instead of its first line', () => {
    expect(conceptTerm('  .stream()\n  .toList()')).toBe('stream().toList()');
    expect(conceptTerm('.toList();')).toBe('toList()');
  });

  it('still prefers a declared name', () => {
    expect(conceptTerm('class Foo {}')).toBe('Foo');
  });

  it('never invents a placeholder title', () => {
    expect(conceptTerm('// only a comment\nimport a.b.C;')).toBe('');
    expect(conceptTerm('')).toBe('');
  });
});

describe('reviewStatus', () => {
  it('describes progress in plain words', () => {
    expect(reviewStatus(concept())).toMatchObject({ status: 'new', label: 'New' });
    expect(reviewStatus(concept({ misses: 1 }))).toMatchObject({ status: 'weak', label: 'Needs work ×1' });
    expect(reviewStatus(concept({ hits: 1 }))).toMatchObject({ status: 'practising' });
    expect(reviewStatus(concept({ hits: 2, misses: 1 }))).toMatchObject({ status: 'practising' });
    expect(reviewStatus(concept({ hits: 2, mastered: true }))).toMatchObject({ status: 'solid', label: 'Solid' });
  });
});

describe('clozeFor', () => {
  it('hides the idea name when the takeaway uses it', () => {
    const cloze = clozeFor(concept());
    expect(cloze?.answer).toBe('getAll');
    expect(cloze?.text).toContain('______');
    expect(cloze?.text).not.toContain('getAll');
  });

  it('hides a code-like word when the title is not in the takeaway', () => {
    const cloze = clozeFor(concept({ term: 'toList()', bottomLine: 'Converts a stream of AllowlistEntryResponse objects to a List.' }));
    expect(cloze).toEqual({ text: 'Converts a stream of ______ objects to a List.', answer: 'AllowlistEntryResponse' });
  });

  it('offers nothing when the takeaway is empty', () => {
    expect(clozeFor(concept({ bottomLine: '   ' }))).toBeNull();
  });
});

describe('reviewView', () => {
  it('offers hint-guessing only for single names and shortens the path', () => {
    expect(reviewView(concept()).guessable).toBe(true);
    expect(reviewView(concept({ term: 'toList()' })).guessable).toBe(true);
    expect(reviewView(concept({ term: 'stream().toList()' })).guessable).toBe(false);
    expect(reviewView(concept({ term: '@ExceptionHandler(MagicLinkVerificationException.class)' })).guessable).toBe(false);
    expect(reviewView(concept()).shortFile).toBe('FrontController.java');
  });

  it('says what the next explanation will do instead of a bare level name', () => {
    expect(reviewView(concept()).nextLesson).toContain('how it works');
    expect(reviewView(concept({ hits: 2 })).nextLesson).toContain('edge cases');
  });
});


describe('practice layers', () => {
  it('infers the three source layers and preserves an explicit engineer choice', () => {
    expect(layerOf(concept({ file: 'schema.sql' }))).toBe('data');
    expect(layerOf(concept({ file: 'Panel.test.tsx' }))).toBe('frontend');
    expect(layerOf(concept())).toBe('backend');
    expect(layerOf(concept({ file: 'README.md' }))).toBeUndefined();
    expect(layerOf(concept({ learningLayer: 'data' }))).toBe('data');
    expect(drillFocus(concept({ learningLayer: 'data' }))).toContain('transactions');
    expect(recordLearning(concept({ learningLayer: 'data' }), { term: 'getAll', bottomLine: 'Updated lesson', file: 'FrontController.java', line: 18, now: 2 }).learningLayer).toBe('data');
  });

  it('builds Explain in 30s copy from the kept takeaway without calling a model', () => {
    const view = reviewView(concept({ bottomLine: 'LIKE matches patterns. Parameter binding is separate.' }));
    expect(view.explainIn30s.what).toContain('LIKE');
    expect(view.explainIn30s.why).toMatch(/Why it matters/i);
    expect(`${view.explainIn30s.what} ${view.explainIn30s.why}`.toLowerCase()).not.toContain('standup');
  });
});
