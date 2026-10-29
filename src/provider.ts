import { assertLocalhost, type ChatMessage, type ModelProvider, type ProviderResult } from './types';

/** Talks to a local Ollama server. Enforces localhost — nothing leaves this machine. */
export class OllamaProvider implements ModelProvider {
  private readonly base: URL;
  private readonly fetchFn: typeof fetch;

  constructor(baseUrl: string, fetchFn: typeof fetch = fetch) {
    this.base = assertLocalhost(baseUrl);
    this.fetchFn = fetchFn;
  }

  async chat(messages: readonly ChatMessage[], model: string, maxTokens = 380): Promise<ProviderResult> {
    const url = new URL('/api/chat', this.base);
    const res = await this.fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        // Speed, staying in the Mistral family: keep the model loaded between
        // turns, cap output per intent, and use a context sized for a selection.
        keep_alive: '30m',
        options: { temperature: 0.2, num_predict: maxTokens, num_ctx: 4096 },
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    if (!res.ok) {
      throw new Error(`Ollama returned ${res.status}`);
    }
    const data = (await res.json()) as { message?: { content?: string } };
    const text = data.message?.content?.trim() ?? '';
    if (!text) {
      throw new Error('Ollama returned an empty response');
    }
    return { text, model, fromMock: false };
  }

  /** Streaming variant: onText receives the accumulated text as tokens arrive. */
  async chatStream(
    messages: readonly ChatMessage[],
    model: string,
    maxTokens: number,
    onText: (accumulated: string) => void,
  ): Promise<ProviderResult> {
    const url = new URL('/api/chat', this.base);
    const res = await this.fetchFn(url, {
      method: 'POST',
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
          const parsed = JSON.parse(line) as { message?: { content?: string } };
          const piece = parsed.message?.content ?? '';
          if (piece) {
            accumulated += piece;
            onText(accumulated);
          }
        } catch {
          // Partial JSON line — wait for more bytes.
        }
      }
    }
    if (!accumulated.trim()) {
      throw new Error('Ollama streamed an empty response');
    }
    return { text: accumulated.trim(), model, fromMock: false };
  }
}

/**
 * Deterministic offline fallback. Not clever — it proves the whole loop
 * (popup → evaluator → flashcards) works for $0 when Ollama is stopped.
 */
export class MockProvider implements ModelProvider {
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
        text: 'That holds only if the selection really is where the state changes, not just where it is passed through.\nWhat would you expect to see if this line never ran?',
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
          'RESTATE: Mock solver (Ollama is not answering) — something in the selected code misbehaves.',
          'CAUSE: The value is created somewhere other than where you are looking (confidence: possible)',
          'CHECK: Put a breakpoint or log line where the value is created, not where it is used.',
          'QUESTION: What is the exact error message or wrong output?',
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
