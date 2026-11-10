import { describe, expect, it } from 'vitest';
import { acceptRoots, fetchReference, rootsWebPrompt, topicFor } from './webroots';

const page = { ok: true, json: async () => ({ title: 'SQL', type: 'standard', extract: 'SQL is a domain-specific language. It was developed at IBM by Donald Chamberlin and Raymond Boyce after learning about the relational model from Edgar Codd in the early 1970s; first called SEQUEL in 1974.', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/SQL' } } }) };

describe('restricted web roots', () => {
  it('chooses the topic from a fixed list and never from identifiers', () => {
    expect(topicFor('SELECT p.* FROM partner p WHERE EXISTS (SELECT 1 FROM x)')?.title).toBe('Existential quantification');
    expect(topicFor('class PartnerFilterCriteria {}')).toBeUndefined();
  });

  it('contacts only the allow-listed host with the topic title and nothing else', async () => {
    const seen: string[] = [];
    const ref = await fetchReference('SQL', async (url) => { seen.push(url); return page; });
    expect(seen).toEqual(['https://en.wikipedia.org/api/rest_v1/page/summary/SQL']);
    expect(ref).toMatchObject({ title: 'SQL', url: 'https://en.wikipedia.org/wiki/SQL' });
  });

  it('falls back (null) on errors, disambiguation and short pages', async () => {
    expect(await fetchReference('SQL', async () => { throw new Error('offline'); })).toBeNull();
    expect(await fetchReference('SQL', async () => ({ ok: false, json: async () => ({}) }))).toBeNull();
    expect(await fetchReference('X', async () => ({ ok: true, json: async () => ({ type: 'disambiguation', extract: 'x'.repeat(200) }) }))).toBeNull();
  });

  it('rejects a story with a year that is not in the page and adds the source otherwise', async () => {
    const ref = (await fetchReference('SQL', async () => page))!;
    const story = (year: string) => ({ bottomLine: `SQL began at IBM in ${year}.`, chunks: [{ title: 'Where it came from', body: 'Chamberlin and Boyce.' }], repaired: false });
    expect(acceptRoots(story('1991'), ref)).toBeNull();
    const accepted = acceptRoots(story('1974'), ref)!;
    expect(accepted.chunks.at(-1)!.body).toContain('https://en.wikipedia.org/wiki/SQL');
    expect(rootsWebPrompt(ref, 'SELECT 1')[0]!.content).toContain('ONLY the REFERENCE');
  });
});
