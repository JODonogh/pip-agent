import { describe, expect, it } from 'vitest';
import { extractFileReferences, selectFileMatches } from './solver-files';

describe('solver file hints', () => {
  it('preserves javac absolute paths with spaces and source line numbers', () => {
    expect(extractFileReferences('  /Users/jon/Global Partner Portal/src/PartnerServiceFilterIntTest.java:105: error: cannot find symbol')).toEqual([
      { path: '/Users/jon/Global Partner Portal/src/PartnerServiceFilterIntTest.java', line: 105 },
    ]);
  });

  it('extracts relative paths, backtick filenames, and Java frames without changing case', () => {
    expect(extractFileReferences('Read `PartnerRepository.java`, src/PartnerService.java:42 and at com.app.CartService.total(CartService.java:12)')).toEqual([
      { path: 'PartnerRepository.java' },
      { path: 'src/PartnerService.java', line: 42 },
      { path: 'CartService.java', line: 12 },
    ]);
  });

  it('accepts Windows diagnostic paths and quoted relative paths with spaces', () => {
    expect(extractFileReferences('C:\\Work Area\\src\\PartnerService.java:105:2: error\n"src/My File.ts:8"')).toEqual([
      { path: 'src/My File.ts', line: 8 },
      { path: 'C:\\Work Area\\src\\PartnerService.java', line: 105 },
    ]);
  });

  it('rejects URLs, traversal and glob patterns without linking their tails', () => {
    expect(extractFileReferences('https://example.com/src/A.java file:///tmp/B.java ../src/C.java src/*/D.java src/[x]/E.java')).toEqual([]);
  });

  it('deduplicates repeated references without losing distinct line numbers', () => {
    expect(extractFileReferences('A.java:1 A.java:1 A.java:2')).toEqual([
      { path: 'A.java', line: 1 }, { path: 'A.java', line: 2 },
    ]);
  });
});

describe('verified workspace file matching', () => {
  const candidates = ['/workspace/src/A.java', '/workspace/test/A.java', '/workspace/src/Only.java'];

  it('requires a unique basename and resolves a specific relative suffix', () => {
    expect(selectFileMatches({ path: 'A.java' }, candidates)).toEqual([]);
    expect(selectFileMatches({ path: 'src/A.java', line: 105 }, candidates)).toEqual(['/workspace/src/A.java']);
    expect(selectFileMatches({ path: 'Only.java' }, candidates)).toEqual(['/workspace/src/Only.java']);
  });

  it('never substitutes a basename when the supplied path differs', () => {
    expect(selectFileMatches({ path: 'other/Only.java' }, candidates)).toEqual([]);
    expect(selectFileMatches({ path: '/outside/Only.java' }, candidates)).toEqual([]);
    expect(selectFileMatches({ path: '../src/Only.java' }, candidates)).toEqual([]);
  });

  it('matches Windows paths case insensitively while preserving Unix case', () => {
    expect(selectFileMatches({ path: 'C:\\repo\\src\\A.java' }, ['c:\\Repo\\src\\a.java'])).toEqual(['c:\\Repo\\src\\a.java']);
    expect(selectFileMatches({ path: 'A.java' }, ['c:\\Repo\\src\\a.java'])).toEqual(['c:\\Repo\\src\\a.java']);
    expect(selectFileMatches({ path: '/workspace/src/only.java' }, candidates)).toEqual([]);
  });
});
