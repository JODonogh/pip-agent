import { describe, expect, it } from 'vitest';
import { locate, parseEdits, stripEdits } from './edits';
import { buildIndex, chunkFile, cosine, deserializeIndex, semanticHits, serializeIndex, type Embedder } from './semantic';

// A fake embedder: one dimension per topic word, so similarity is predictable.
const TOPICS = ['partner', 'invoice', 'cache'];
const embed: Embedder = async (texts) => texts.map((text) => TOPICS.map((topic) => (text.toLowerCase().includes(topic) ? 1 : 0.01)));

const files = [
  { path: 'a/PartnerService.java', text: 'class PartnerService {\n  // partner lookup by id for the partner portal\n  Partner find(long id) { return partners.get(id); }\n}' },
  { path: 'b/Billing.java', text: 'class Billing {\n  // invoice totals for each invoice line\n  long total(Invoice invoice) { return invoice.sum(); }\n}' },
];

describe('semantic index', () => {
  it('cuts files into overlapping line chunks with 1-based ranges', () => {
    const text = Array.from({ length: 100 }, (_, i) => `line number ${i + 1} of the file`).join('\n');
    const chunks = chunkFile('x.ts', text);
    expect(chunks[0]).toMatchObject({ start: 1, end: 40 });
    expect(chunks[1]!.start).toBe(33);
    expect(chunks.at(-1)!.end).toBe(100);
  });

  it('finds the chunk about the question, even without the same words', async () => {
    const index = await buildIndex(files, null, embed, { model: 'm' });
    const hits = await semanticHits(index, 'where do we look up a partner', embed);
    expect(hits[0]).toMatchObject({ file: 'a/PartnerService.java', line: 1 });
    expect(hits.some((hit) => hit.file === 'b/Billing.java')).toBe(false);
  });

  it('re-embeds only files that changed and survives save and load', async () => {
    const first = await buildIndex(files, null, embed, { model: 'm' });
    let embedded = 0;
    const counting: Embedder = async (texts) => { embedded += texts.length; return embed(texts); };
    const changed = [files[0]!, { ...files[1]!, text: `${files[1]!.text}\n// cache the invoice totals` }];
    const second = await buildIndex(changed, deserializeIndex(serializeIndex(first)), counting, { model: 'm' });
    expect(embedded).toBe(1);
    expect(second.chunks).toHaveLength(2);
    expect(cosine(second.chunks[0]!.vector, first.chunks[0]!.vector)).toBeCloseTo(1, 5);
  });

  it('leaves a file unrecorded when the chunk cap cuts it off, so the next run finishes it', async () => {
    const capped = await buildIndex(files, null, embed, { model: 'm', maxChunks: 1 });
    expect(capped.chunks).toHaveLength(1);
    expect(Object.keys(capped.hashes)).toHaveLength(1);
  });
});

describe('vibe edits', () => {
  const reply = 'Plan: drop the stream.\nEDIT: src/A.java\nFIND:\n  return list.stream().toList();\nREPLACE:\n  return list.toList();\nEND\nDone.';

  it('parses edit blocks and strips them from the explanation', () => {
    expect(parseEdits(reply)).toEqual([{ file: 'src/A.java', find: '  return list.stream().toList();', replace: '  return list.toList();' }]);
    expect(stripEdits(reply)).toBe('Plan: drop the stream.\n\nDone.');
  });

  it('accepts a deletion and ignores code fences around a block', () => {
    const edits = parseEdits('```\nEDIT: A.java\nFIND:\nold();\nREPLACE:\nEND\n```');
    expect(edits).toEqual([{ file: 'A.java', find: 'old();', replace: '' }]);
  });

  it('applies only when the find text occurs exactly once', () => {
    expect(locate('a b a', 'b')).toEqual({ ok: true, start: 2 });
    expect(locate('a b a', 'a')).toMatchObject({ ok: false });
    expect(locate('a b a', 'zzz')).toMatchObject({ ok: false });
    expect(locate('a', '  ')).toMatchObject({ ok: false });
  });
});
