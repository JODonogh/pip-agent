import { assertLocalhost } from '../shared/types';

/** Embeddings come from the local Ollama only, like every other model call. */
export async function embedTexts(baseUrl: string, model: string, texts: string[], signal?: AbortSignal): Promise<number[][]> {
  const url = new URL('/api/embed', assertLocalhost(baseUrl));
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, input: texts }),
    signal,
  });
  if (!response.ok) throw new Error(`Embedding model unavailable (${response.status}). Run: ollama pull ${model}`);
  const body = (await response.json()) as { embeddings?: number[][] };
  if (!body.embeddings || body.embeddings.length !== texts.length) throw new Error('Unexpected embedding response');
  return body.embeddings;
}
