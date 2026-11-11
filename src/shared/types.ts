/** Shared types for the Learn POC. */

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface ProviderTelemetry {
  totalDurationMs: number;
  loadDurationMs: number;
  promptEvalCount: number;
  promptEvalDurationMs: number;
  evalCount: number;
  evalDurationMs: number;
  tokensPerSecond: number;
}

export interface ProviderResult {
  text: string;
  model: string;
  /** True when the deterministic offline fallback produced this. */
  fromMock: boolean;
  /** End-to-end request time (Ollama round-trip). */
  latencyMs?: number;
  /** Completion tokens generated (`eval_count` from Ollama). */
  evalCount?: number;
  /** Nanoseconds spent generating completion tokens (`eval_duration`). */
  evalDuration?: number;
  /** Derived from evalCount and evalDuration when Ollama reports both. */
  tokensPerSecond?: number;
  /** Raw model output before sanitization (may include reasoning blocks). */
  rawText?: string;
  /** Parsed Ollama timing metadata from the inference response. */
  telemetry?: ProviderTelemetry;
}

export interface ModelProvider {
  chat(messages: readonly ChatMessage[], model: string, maxTokens?: number): Promise<ProviderResult>;
  /** Locally pulled Ollama model names; `['mock']` when the server is unreachable. */
  getInstalledModels(): Promise<string[]>;
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
  /** Model draft kept for comparison when a quality guard would have replaced it. */
  experimentalDraft?: boolean;
}

export type LearningLayer = 'data' | 'frontend' | 'backend';

export interface Concept {
  /** Optional engineer-selected practice layer; legacy cards infer it from the source file. */
  learningLayer?: LearningLayer;
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
  /** How many times this idea was explained or marked. Drives the basic → complex rung. */
  exposures?: number;
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
