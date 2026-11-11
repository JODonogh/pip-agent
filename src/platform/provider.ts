import {
  assertLocalhost,
  type ChatMessage,
  type ModelProvider,
  type ProviderResult,
  type ProviderTelemetry,
} from '../shared/types';

type OllamaTimingPayload = {
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
};

function ollamaTelemetry(data: OllamaTimingPayload): ProviderTelemetry {
  const evalCount = data.eval_count ?? 0;
  const evalDuration = data.eval_duration;
  return {
    totalDurationMs: (data.total_duration ?? 0) / 1e6,
    loadDurationMs: (data.load_duration ?? 0) / 1e6,
    promptEvalCount: data.prompt_eval_count ?? 0,
    promptEvalDurationMs: (data.prompt_eval_duration ?? 0) / 1e6,
    evalCount,
    evalDurationMs: (evalDuration ?? 0) / 1e6,
    tokensPerSecond: evalDuration ? evalCount / (evalDuration / 1e9) : 0,
  };
}

function providerInferenceMetrics(
  started: number,
  stats: OllamaTimingPayload,
): Pick<ProviderResult, 'latencyMs' | 'evalCount' | 'evalDuration' | 'tokensPerSecond' | 'telemetry'> {
  const latencyMs = Date.now() - started;
  const evalCount = stats.eval_count;
  const evalDuration = stats.eval_duration;
  const telemetry = ollamaTelemetry(stats);
  let tokensPerSecond: number | undefined;
  if (evalCount != null && evalDuration != null && evalDuration > 0) {
    tokensPerSecond = telemetry.tokensPerSecond;
  }
  return { latencyMs, evalCount, evalDuration, tokensPerSecond, telemetry };
}

/** Talks to a local Ollama server. Enforces localhost — nothing leaves this machine. */
export class OllamaProvider implements ModelProvider {
  private readonly base: URL;
  private readonly fetchFn: typeof fetch;

  constructor(baseUrl: string, fetchFn: typeof fetch = fetch) {
    this.base = assertLocalhost(baseUrl);
    this.fetchFn = fetchFn;
  }

  async getInstalledModels(): Promise<string[]> {
    const url = new URL('/api/tags', this.base);
    try {
      const res = await this.fetchFn(url, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        return ['mock'];
      }
      const data = (await res.json()) as { models?: Array<{ name?: string }> };
      const names = (data.models ?? [])
        .map((m) => m.name)
        .filter((name): name is string => typeof name === 'string' && name.length > 0);
      return names.length > 0 ? names : ['mock'];
    } catch {
      return ['mock'];
    }
  }

  async chat(
    messages: readonly ChatMessage[],
    model: string,
    maxTokens = 380,
    signal?: AbortSignal,
    inference: { contextSize?: number; temperature?: number } = {},
  ): Promise<ProviderResult> {
    const contextSize = inference.contextSize ?? 4096;
    const temperature = inference.temperature ?? 0.2;
    const started = Date.now();
    const url = new URL('/api/chat', this.base);
    const res = await this.fetchFn(url, {
      method: 'POST',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        // Speed, staying in the Mistral family: keep the model loaded between
        // turns, cap output per intent, and use a context sized for a selection.
        keep_alive: '30m',
        options: { temperature, num_predict: maxTokens, num_ctx: contextSize },
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    if (!res.ok) {
      throw new Error(`Ollama returned ${res.status}`);
    }
    const data = (await res.json()) as { message?: { content?: string } } & OllamaTimingPayload;
    const rawText = data.message?.content ?? '';
    const text = rawText.trim();
    if (!text) {
      throw new Error('Ollama returned an empty response');
    }
    return { text, rawText, model, fromMock: false, ...providerInferenceMetrics(started, data) };
  }

  /** Streaming variant: onText receives the accumulated text as tokens arrive. */
  async chatStream(
    messages: readonly ChatMessage[],
    model: string,
    maxTokens: number,
    onText: (accumulated: string) => void,
    signal?: AbortSignal,
  ): Promise<ProviderResult> {
    const started = Date.now();
    const url = new URL('/api/chat', this.base);
    const res = await this.fetchFn(url, {
      method: 'POST',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: true,
        keep_alive: '30m',
        options: { temperature: 0.2, num_predict: maxTokens, num_ctx: 4096 },
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`Ollama stream failed: ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulated = '';
    let streamTiming: OllamaTimingPayload = {};
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        try {
          const parsed = JSON.parse(line) as { message?: { content?: string }; done?: boolean } & OllamaTimingPayload;
          const piece = parsed.message?.content ?? '';
          if (piece) {
            accumulated += piece;
            onText(accumulated);
          }
          if (
            parsed.done
            || parsed.total_duration != null
            || parsed.load_duration != null
            || parsed.prompt_eval_count != null
            || parsed.prompt_eval_duration != null
            || parsed.eval_count != null
            || parsed.eval_duration != null
          ) {
            streamTiming = {
              total_duration: parsed.total_duration ?? streamTiming.total_duration,
              load_duration: parsed.load_duration ?? streamTiming.load_duration,
              prompt_eval_count: parsed.prompt_eval_count ?? streamTiming.prompt_eval_count,
              prompt_eval_duration: parsed.prompt_eval_duration ?? streamTiming.prompt_eval_duration,
              eval_count: parsed.eval_count ?? streamTiming.eval_count,
              eval_duration: parsed.eval_duration ?? streamTiming.eval_duration,
            };
          }
        } catch {
          // Partial JSON line — wait for more bytes.
        }
      }
    }
    if (!accumulated.trim()) {
      throw new Error('Ollama streamed an empty response');
    }
    const rawText = accumulated;
    return {
      text: rawText.trim(),
      rawText,
      model,
      fromMock: false,
      ...providerInferenceMetrics(started, streamTiming),
    };
  }
}

/**
 * Deterministic offline fallback. Not clever — it proves the whole loop
 * (popup → evaluator → flashcards) works for $0 when Ollama is stopped.
 */
export class MockProvider implements ModelProvider {
  async getInstalledModels(): Promise<string[]> {
    return ['mock'];
  }

  async chat(messages: readonly ChatMessage[], model: string): Promise<ProviderResult> {
    const user = messages.find((m) => m.role === 'user')?.content ?? '';
    const intent = /\[INTENT:(\w+)\]/.exec(user)?.[1] ?? 'explain';
    const snippet = (/```[\s\S]*?\n([\s\S]*?)```/.exec(user)?.[1] ?? '').trim();
    const firstLine = snippet.split('\n').find((l) => l.trim().length > 0)?.trim() ?? 'this selection';

    if (intent === 'quickfire') {
      return { text: `In one sentence: \`${firstLine.slice(0, 80)}\` is the selected code doing its job in place.`, model, fromMock: true };
    }
    if (intent === 'duck') {
      return {
        text: 'Ollama is unavailable; I could not check your understanding.\nCan you check your local model and try again?',
        model,
        fromMock: true,
      };
    }
    if (intent === 'improve') {
      return {
        text: [
          `IMPROVE: Architecture | Isolate domain policy from ${firstLine.slice(0, 32)} | Keeps transport/UI separate from business rules | Extract a pure function for the core decision and unit-test it directly | XS · ~20 min, zero API break`,
          'IMPROVE: Performance | Bound payload & add pagination/caching | Unbounded reads degrade as rows grow | Add a page/limit guard or short-TTL cache around the hot path | S · ~45 min, cap scope to 1 endpoint',
          'IMPROVE: DX & Testing | Contract test the failure path | Happy path is obvious but edge cases regress silently | Add a parameterized test covering empty, invalid, and unauthorized inputs | XS · ~15 min',
        ].join('\n'),
        model,
        fromMock: true,
      };
    }
    if (intent === 'poc') {
      return {
        text: [
          `POC: Self-Verifying Endpoint Sandbox | Interactive contract runner beside ${firstLine.slice(0, 28)} | Proves engineers catch regressions 3x faster when examples run in-IDE | 1 read-only replay command against localhost | Live status + latency diff on save`,
          'POC: Shadow-Mode Policy Validator | Run new validation rules in parallel without blocking traffic | Proves new rules against real payloads before flipping the flag | Log-only comparator wrapper around current handler | Dashboard of mismatches caught',
          'POC: Auto-Generated State & Flow Spec | Turn this module into an executable state diagram | Proves code-to-diagram sync eliminates stale wiki docs | Deterministic AST/regex extractor feeding an SVG view | Click a node to jump to line + run its test',
        ].join('\n'),
        model,
        fromMock: true,
      };
    }
    if (intent === 'pocblueprint') {
      return {
        text: [
          `BOTTOM_LINE: Prove the POC on ${firstLine.slice(0, 40)} in under two hours by mocking storage and building only the interactive loop.`,
          '### Step 1 — 30-Min Skeleton',
          'Create a standalone command or test harness with 3 canned inputs so you can iterate in milliseconds without booting the full stack.',
          '### Step 2 — Core Mechanism',
          'Wire the real function under test to the harness and log input, output, and latency on every run.',
          '### Step 3 — Demo & Guardrails',
          'Show before vs after on one real bug case; keep database migrations and auth out of scope for the POC.',
        ].join('\n'),
        model,
        fromMock: true,
      };
    }
    if (intent === 'diverge') {
      return {
        text: [
          'APPROACH: Keep it as-is — mock fallback, Ollama is not answering.',
          'APPROACH: Simplify — delete a layer and call the service directly.',
          'APPROACH: Cache — memoise the result per input.',
          'APPROACH: Stream — return results incrementally.',
        ].join('\n'),
        model,
        fromMock: true,
      };
    }
    if (intent === 'mcq') {
      return {
        text: 'Q: Mock question — what does the marked concept do?\nA: Nothing at all\nB: Exactly what its card says\nC: It only works on Tuesdays\nD: It deletes data\nANSWER: B',
        model,
        fromMock: true,
      };
    }
    if (intent === 'solver') {
      return {
        text: [
          'RESTATE: Ollama is unavailable; no model diagnosis was made.',
          'CAUSE: No model hypothesis is available (confidence: long shot)',
          'CHECK: Check that Ollama and the configured local model are running, then retry.',
          'QUESTION:',
          'WHY: No model response was received.',
          'UNKNOWN: The cause has not been checked.',
        ].join('\n'),
        model,
        fromMock: true,
      };
    }
    if (intent === 'drillcheck') {
      return { text: 'PARTLY\nMock check (Ollama is not answering): compare your answer with the concept card.', model, fromMock: true };
    }
    if (intent === 'drill') {
      return { text: `Explain, in your own words, what \`${firstLine.slice(0, 60)}\` does and what breaks if it is removed.`, model, fromMock: true };
    }
    const text = [
      `BOTTOM_LINE: This selection centres on \`${firstLine.slice(0, 80)}\`, and its effect is local to where it runs.`,
      '### What it is',
      'Mock explanation (Ollama is not answering): the selected lines are treated as one unit. Read them top to bottom and name the value that changes.',
      '### Worth learning',
      'Find where the value is created, not where it is passed through. That is the source of truth, in this code and everywhere else.',
    ].join('\n');
    return { text, model, fromMock: true };
  }
}
