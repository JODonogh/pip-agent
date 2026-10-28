/** Shared types for the Learn POC. */

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface ProviderResult {
  text: string;
  model: string;
  /** True when the deterministic offline fallback produced this. */
  fromMock: boolean;
}

export interface ModelProvider {
  chat(messages: readonly ChatMessage[], model: string, maxTokens?: number): Promise<ProviderResult>;
}

export interface CodeContext {
  file: string;
  line: number;
  language: string;
  selection: string;
  surrounding: string;
}

export interface Chunk {
  title: string;
  body: string;
}

export interface Explanation {
  bottomLine: string;
  chunks: Chunk[];
  /** Evaluator had to cut/repair the raw model output. */
  repaired: boolean;
}

export interface Concept {
  id: string;
  term: string;
  bottomLine: string;
  file: string;
  line: number;
  createdAt: number;
  lastSeenAt: number;
  hits: number;
  misses: number;
  mastered: boolean;
}

export interface TurnStat {
  worker: string;
  model: string;
  latencyMs: number;
  estTokens: number;
  costUsd: number;
  fromMock: boolean;
  at: number;
}

/** Assert a URL points at this machine only. Model traffic must never leave it. */
export function assertLocalhost(rawUrl: string): URL {
  const url = new URL(rawUrl);
  const hosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Refusing non-http(s) model URL: ${rawUrl}`);
  }
  if (!hosts.has(url.hostname)) {
    throw new Error(
      `Refusing non-local model URL "${url.hostname}". Agent PIP is local-only: use Ollama on localhost.`,
    );
  }
  return url;
}

/** Rough token estimate (chars/4). Good enough for a local cost/observability strip. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
