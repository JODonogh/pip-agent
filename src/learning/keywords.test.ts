import { describe, expect, it } from 'vitest';
import { extractKeywords } from './keywords';
describe('useful learning terms', () => {
  it('prioritises LIKE over familiar SQL/HTTP/API labels', () => {
    expect(extractKeywords('The SQL query uses LIKE. An HTTP API sends JSON.')).toEqual(['like']);
  });
  it('ignores ordinary English like and arbitrary capitalised prose', () => {
    expect(extractKeywords('This Looks Like Something useful. It works like a sieve.')).toEqual([]);
  });
  it('keeps unfamiliar phrases and operators ahead of identifiers and excludes files', () => {
    const terms = extractKeywords('SQL `COALESCE` and overload resolution in `PartnerService.java`, using `someMethod` and `otherMethod`.');
    expect(terms.slice(0, 2)).toEqual(['coalesce', 'overload resolution']);
    expect(terms).not.toContain('partnerservice');
    expect(terms).not.toContain('java');
  });
  it('keeps highlighting sparse', () => {
    expect(extractKeywords('LIKE ILIKE COALESCE NULLIF EXISTS HAVING OVER UNNEST LATERAL recursion closure')).toHaveLength(6);
  });
});
