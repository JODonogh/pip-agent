import type { ChatMessage, CodeContext, Explanation, ProviderResult, ProviderTelemetry } from '../shared/types';
import { estimateTokens } from '../shared/types';

export interface PromptPart {
  role: 'system' | 'user';
  label: string;
  content: string;
  estTokens: number;
  anchors: string[];
}

export interface GlassBoxInspection {
  model: string;
  parts: PromptPart[];
  totalEstTokens: number;
  fewShotAnchors: string[];
  ungroundedSpans: string[];
  telemetry?: ProviderTelemetry;
  latencyMs?: number;
  tokensPerSecond?: number;
  rawText?: string;
  fromMock: boolean;
}

export const GLASS_BOX_COMPARE_MODELS = ['qwen2.5-coder:1.5b', 'qwen2.5-coder:14b'] as const;

const FEW_SHOT_SIGNATURES: readonly string[] = [
  'Example format and tone',
  'BOTTOM_LINE: Early return',
  'Wildcard escapes',
  'Reply in EXACTLY this format',
  'at most 50 words',
  'Example format:',
  'The engineer clicked on this term',
  '[INTENT:explain]',
];

function fewShotAnchorsInPrompt(messages: readonly ChatMessage[]): string[] {
  const joined = messages.map((message) => message.content).join('\n');
  return FEW_SHOT_SIGNATURES.filter((phrase) => joined.includes(phrase));
}

function labelPart(message: ChatMessage, index: number): string {
  if (message.role === 'system') return 'System rules and output contract';
  return index === 1 ? 'User: code excerpt and teaching brief' : `User message ${index}`;
}

export function ungroundedSpansInExplanation(ctx: CodeContext, explanation: Explanation): string[] {
  const source = `${ctx.selection}\n${ctx.surrounding}`.toLowerCase();
  const spans = new Set<string>();
  const corpus = [explanation.bottomLine, ...explanation.chunks.map((chunk) => `${chunk.title} ${chunk.body}`)].join(' ');
  const probes: Array<{ pattern: RegExp; normalizer?: (value: string) => string }> = [
    { pattern: /\b401\b/g },
    { pattern: /\b40[34]\b/g },
    { pattern: /\b500\b/g },
    { pattern: /\btimeout\b/gi, normalizer: (value) => value.toLowerCase() },
    { pattern: /\bexceptions?\b/gi, normalizer: (value) => value.toLowerCase().replace(/s$/, '') },
    { pattern: /\bSQL injection\b/gi, normalizer: (value) => value.toLowerCase() },
  ];
  for (const { pattern, normalizer } of probes) {
    for (const match of corpus.matchAll(pattern)) {
      const raw = match[0] ?? '';
      const needle = normalizer ? normalizer(raw) : raw;
      if (!source.includes(needle)) spans.add(raw);
    }
  }
  if (explanation.experimentalDraft) spans.add('Evaluator marked experimental draft (instruction or grounding drift)');
  if (explanation.repaired) spans.add('Evaluator repaired or trimmed model output');
  if (corpus.includes('[Diagnostic Note: Evaluator check failed:')) {
    spans.add('Diagnostic note appended after evaluator guard');
  }
  return [...spans];
}

export function buildGlassBoxInspection(
  messages: readonly ChatMessage[],
  ctx: CodeContext,
  explanation: Explanation,
  result: ProviderResult & { latencyMs?: number },
): GlassBoxInspection {
  const fewShotAnchors = fewShotAnchorsInPrompt(messages);
  const parts: PromptPart[] = messages.map((message, index) => {
    const anchors = FEW_SHOT_SIGNATURES.filter((phrase) => message.content.includes(phrase));
    return {
      role: message.role,
      label: labelPart(message, index),
      content: message.content,
      estTokens: estimateTokens(message.content),
      anchors,
    };
  });
  return {
    model: result.model,
    parts,
    totalEstTokens: parts.reduce((sum, part) => sum + part.estTokens, 0),
    fewShotAnchors,
    ungroundedSpans: ungroundedSpansInExplanation(ctx, explanation),
    telemetry: result.telemetry,
    latencyMs: result.latencyMs,
    tokensPerSecond: result.tokensPerSecond,
    rawText: result.rawText ?? result.text,
    fromMock: result.fromMock,
  };
}
