import type { SearchFile, SearchHit } from './searcher';

/**
 * Local semantic search: files are cut into overlapping line chunks, embedded by a local Ollama embedding model,
 * and matched to a question by cosine similarity. Only changed files are re-embedded.
 */

export type Embedder = (texts: string[]) => Promise<number[][]>;

export interface IndexedChunk {
  file: string;
  start: number;
  end: number;
  text: string;
  vector: Float32Array;
}

export interface SemanticIndex {
  model: string;
  hashes: Record<string, string>;
  chunks: IndexedChunk[];
}

const DOC = 'search_document: ';
const QUERY = 'search_query: ';

export function hashText(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  return `${text.length}:${hash.toString(36)}`;
}

export function chunkFile(file: string, text: string, size = 40, overlap = 8): Omit<IndexedChunk, 'vector'>[] {
  const lines = text.split('\n');
  const chunks: Omit<IndexedChunk, 'vector'>[] = [];
  for (let start = 0; start < lines.length; start += size - overlap) {
    const slice = lines.slice(start, start + size);
    const body = slice.join('\n');
    if (body.trim().length >= 20) chunks.push({ file, start: start + 1, end: start + slice.length, text: body.slice(0, 1600) });
    if (start + size >= lines.length) break;
  }
  return chunks;
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export async function buildIndex(
  files: readonly SearchFile[],
  previous: SemanticIndex | null,
  embed: Embedder,
  options: { model: string; batch?: number; maxChunks?: number; onProgress?: (done: number, total: number) => void },
): Promise<SemanticIndex> {
  const reuse = previous && previous.model === options.model ? previous : null;
  const hashes: Record<string, string> = {};
  const kept: IndexedChunk[] = [];
  const fresh: Omit<IndexedChunk, 'vector'>[] = [];
  for (const file of files) {
    const hash = hashText(file.text);
    hashes[file.path] = hash;
    if (reuse && reuse.hashes[file.path] === hash) kept.push(...reuse.chunks.filter((chunk) => chunk.file === file.path));
    else fresh.push(...chunkFile(file.path, file.text));
  }
  const room = Math.max(0, (options.maxChunks ?? 8000) - kept.length);
  const todo = fresh.slice(0, room);
  // A file cut off by the chunk cap is not recorded as indexed, so the next run finishes it.
  for (const chunk of fresh.slice(room)) delete hashes[chunk.file];
  const added: IndexedChunk[] = [];
  const batch = options.batch ?? 16;
  for (let i = 0; i < todo.length; i += batch) {
    const part = todo.slice(i, i + batch);
    const vectors = await embed(part.map((chunk) => `${DOC}${chunk.file}\n${chunk.text}`));
    part.forEach((chunk, j) => added.push({ ...chunk, vector: Float32Array.from(vectors[j]!) }));
    options.onProgress?.(Math.min(i + batch, todo.length), todo.length);
  }
  return { model: options.model, hashes, chunks: [...kept, ...added] };
}

export async function semanticHits(index: SemanticIndex, query: string, embed: Embedder, k = 6): Promise<SearchHit[]> {
  if (index.chunks.length === 0) return [];
  const [vector] = await embed([`${QUERY}${query.slice(0, 1000)}`]);
  if (!vector) return [];
  return index.chunks
    .map((chunk) => ({ chunk, similarity: cosine(chunk.vector, vector) }))
    .filter((item) => item.similarity >= 0.45)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k)
    .map(({ chunk, similarity }) => ({ file: chunk.file, line: chunk.start, snippet: chunk.text.slice(0, 1200), score: Math.round(similarity * 100) / 10 }));
}

export function serializeIndex(index: SemanticIndex): string {
  return JSON.stringify({
    model: index.model,
    hashes: index.hashes,
    chunks: index.chunks.map((chunk) => ({
      file: chunk.file, start: chunk.start, end: chunk.end, text: chunk.text,
      v: Buffer.from(new Uint8Array(chunk.vector.buffer, chunk.vector.byteOffset, chunk.vector.byteLength)).toString('base64'),
    })),
  });
}

export function deserializeIndex(raw: string): SemanticIndex | null {
  try {
    const data = JSON.parse(raw) as { model: string; hashes: Record<string, string>; chunks: { file: string; start: number; end: number; text: string; v: string }[] };
    return {
      model: data.model,
      hashes: data.hashes,
      chunks: data.chunks.map((chunk) => {
        const bytes = Buffer.from(chunk.v, 'base64');
        return { file: chunk.file, start: chunk.start, end: chunk.end, text: chunk.text,
          vector: new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) };
      }),
    };
  } catch {
    return null;
  }
}
