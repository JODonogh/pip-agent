import { describe, expect, it } from 'vitest';
import type { CodeContext } from '../shared/types';
import { deriveEngagement } from './verify';

const ctx = (selection: string, file = 'src/PartnerRepository.java'): CodeContext => ({
  file,
  line: 12,
  language: 'java',
  selection,
  surrounding: '',
});

describe('deriveEngagement', () => {
  it('suggests DBeaver with a LIKE fragment for SQL excerpts', () => {
    const like =
      "OR LOWER(p.partner_name) LIKE '%' || LOWER(CAST(:search AS TEXT)) || '%' ESCAPE '\\\\'";
    const info = deriveEngagement(ctx(like, 'Solve chat'));
    expect(info.sqlHint).toMatch(/DBeaver/i);
    expect(info.sqlHint).toContain('LIKE');
    expect(info.engagementLine).toMatch(/DBeaver/i);
  });

  it('suggests Bruno on localhost for HTTP mappings', () => {
    const source = '@GetMapping("/api/partners")\nList<Partner> list() { return service.findAll(); }';
    const info = deriveEngagement(ctx(source));
    expect(info.http).toEqual({ method: 'GET', path: '/api/partners' });
    expect(info.engagementLine).toMatch(/localhost:8081/i);
    expect(info.engagementLine).toMatch(/GET/i);
  });

  it('suggests a breakpoint when code looks like a method body', () => {
    const source = 'return partnerService.findFilteredInScope(criteria).stream().toList();';
    const info = deriveEngagement(ctx(source));
    expect(info.debugHint).toMatch(/Breakpoint/i);
    expect(info.engagementLine).toMatch(/Breakpoint/i);
  });
});
