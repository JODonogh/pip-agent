/** VS Code OutputChannel sink for evaluator guard failures (registered from the extension host). */
export type EvaluatorDiagnosticSink = (line: string) => void;

export const DIAGNOSTICS_CHANNEL_NAME = 'Agent PIP Diagnostics';

let sink: EvaluatorDiagnosticSink | null = null;

/** @deprecated Use diagnostic note appended to draft text instead. */
export const EXPERIMENTAL_DRAFT_TAG = '[Draft - Experimental]';

export function setEvaluatorDiagnostics(next: EvaluatorDiagnosticSink | null): void {
  sink = next;
}

export function logEvaluatorDiagnostic(area: string, message: string, detail?: string): void {
  const stamp = new Date().toISOString();
  const line = detail
    ? `[${stamp}] ${DIAGNOSTICS_CHANNEL_NAME} | ${area}: ${message} | ${detail}`
    : `[${stamp}] ${DIAGNOSTICS_CHANNEL_NAME} | ${area}: ${message}`;
  sink?.(line);
}

/** Log when evaluator output is kept as a draft instead of replaced with a static template. */
export function logEvaluatorDrop(reason: string, rawText: string): void {
  const excerpt = rawText.slice(0, 2000).replace(/\s+/g, ' ');
  logEvaluatorDiagnostic('drop', reason, excerpt);
}

export function appendEvaluatorDiagnosticNote(text: string, reason: string): string {
  const marker = '[Diagnostic Note: Evaluator check failed: ';
  if (text.includes(marker)) return text;
  return `${text}\n\n${marker}${reason}]`;
}

/** Keep the model draft visible when a grounding guard fails instead of replacing it silently. */
export function markExperimentalDraft<T extends { bottomLine: string; repaired: boolean }>(
  explanation: T,
  area: string,
  reason: string,
  rawText?: string,
): T & { experimentalDraft: true } {
  const draftSource = rawText ?? [explanation.bottomLine, ...('chunks' in explanation
    ? (explanation as T & { chunks?: { title: string; body: string }[] }).chunks?.map((chunk) => `${chunk.title}\n${chunk.body}`) ?? []
    : [])].join('\n');
  logEvaluatorDrop(reason, draftSource);
  logEvaluatorDiagnostic(area, reason);
  return {
    ...explanation,
    bottomLine: appendEvaluatorDiagnosticNote(explanation.bottomLine, reason),
    repaired: true,
    experimentalDraft: true,
  };
}
