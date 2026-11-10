/** VS Code OutputChannel sink for evaluator guard failures (registered from the extension host). */
export type EvaluatorDiagnosticSink = (line: string) => void;

let sink: EvaluatorDiagnosticSink | null = null;

export const EXPERIMENTAL_DRAFT_TAG = '[Draft - Experimental]';

export function setEvaluatorDiagnostics(next: EvaluatorDiagnosticSink | null): void {
  sink = next;
}

export function logEvaluatorDiagnostic(area: string, message: string, detail?: string): void {
  const stamp = new Date().toISOString();
  const line = detail ? `[${stamp}] ${area}: ${message} | ${detail}` : `[${stamp}] ${area}: ${message}`;
  sink?.(line);
}

/** Keep the model draft visible when a grounding guard fails instead of replacing it silently. */
export function markExperimentalDraft<T extends { bottomLine: string; repaired: boolean }>(
  explanation: T,
  area: string,
  reason: string,
  detail?: string,
): T & { experimentalDraft: true } {
  logEvaluatorDiagnostic(area, reason, detail);
  const bottomLine = explanation.bottomLine.startsWith(EXPERIMENTAL_DRAFT_TAG)
    ? explanation.bottomLine
    : `${EXPERIMENTAL_DRAFT_TAG} ${explanation.bottomLine}`;
  return { ...explanation, bottomLine, repaired: true, experimentalDraft: true };
}
