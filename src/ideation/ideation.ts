import type { CodeContext } from '../shared/types';
import { codeAnchors, type PocIdea } from '../shared/evaluator';

export interface IdeaVerification {
  level: 'Context supported' | 'Speculation' | 'Refuted';
  evidence: string;
  challenge: string;
  check: string;
  pattern: string;
}

function unquote(value: string): string {
  return value.trim().replace(/^[`"“']|[`"”']$/g, '');
}

/** Only the bounded excerpt is evidence. A separate model opinion is never a live test. */
export function verifyIdeas(
  raw: string,
  ctx: CodeContext,
  count: number,
  offline = false,
  claims: readonly string[] = [],
): IdeaVerification[] {
  const source = [ctx.selection.slice(0, 3000), ctx.surrounding.slice(0, 1200)];
  const verdicts = new Map<number, string[]>();
  for (const line of raw.split('\n')) {
    const match = /^\s*VERIFY:\s*(\d+)\s*\|(.+)$/i.exec(line);
    if (!match) continue;
    const index = Number(match[1]) - 1;
    if (index >= 0 && index < count && !verdicts.has(index)) verdicts.set(index, match[2]!.split('|').map((part) => part.trim()));
  }
  return Array.from({ length: Math.min(4, Math.max(0, count)) }, (_, index) => {
    const fields = offline ? [] : verdicts.get(index) ?? [];
    const status = fields[0]?.toLowerCase();
    const quote = unquote(fields[1] ?? '');
    const evidence = quote.length >= 3 && quote.length <= 300 && source.some((text) => text.includes(quote)) ? quote : '';
    // An excerpt can reveal a mechanism but cannot establish a performance improvement.
    const performanceGain = /\b(faster|speed[ -]?up|optimi[sz]\w*|improv\w*\s+(?:performance|latency|throughput)|reduc\w*\s+(?:overhead|latency|memory|allocations))\b/i.test(claims[index] ?? '');
    const level: IdeaVerification['level'] = evidence && status === 'refuted' ? 'Refuted' :
      evidence && status === 'supported' && !performanceGain ? 'Context supported' : 'Speculation';
    const fallback = offline ? 'The local verifier was unavailable.' : !fields.length ? 'No independent review was returned.' :
      !evidence ? 'The reviewer supplied no matching code quote.' : performanceGain ? 'A performance gain needs a controlled measurement.' : 'The code excerpt does not settle this claim.';
    return {
      level,
      evidence,
      challenge: `${((!evidence || (performanceGain && status !== 'refuted')) ? fallback : fields[2] || fallback).slice(0, 220)} No live test was run.`,
      check: (fields[3] || 'Inspect the relevant declaration or run one controlled test before changing behaviour.').slice(0, 240),
      pattern: (fields[4] || 'Trace one input through the code; name the assumption and ask what result would disprove it.').slice(0, 240),
    };
  });
}


/** A useful trial needs a way to be wrong, rather than just another happy-path assertion. */
export function usefulExperiment(idea: PocIdea): boolean {
  return /\b(if|when|compared|versus|vs\.?|increase|decrease)\b/i.test(idea.hypothesis) &&
    /\b(reject|refut|rule out|unchanged|otherwise|no difference|does not|doesn't)\w*/i.test(idea.demo) &&
    idea.slice.trim().length > 20;
}

/** Explicit investigation scaffolds when the small local model cannot propose a falsifiable trial. */
export function experimentScaffolds(ctx: CodeContext, seed: string): PocIdea[] {
  const symbol = codeAnchors(ctx).find((name) => /test|filter|handle|render|process/i.test(name)) ?? codeAnchors(ctx)[0] ?? 'this code';
  if (/test|crash|fail|flak/i.test(seed)) return [{
    title: `Locate the failure stage in ${symbol}`,
    hook: 'Distinguish a setup failure, a failing call, and a failed assertion before changing the code. Ask which user/business behaviour the failing test protects.',
    hypothesis: 'If execution order or shared fixture state causes the failure, the same test will behave differently alone and in the suite.',
    slice: 'Use the existing test harness before proposing another component: run the selected test alone and with its suite using the same data; repeat three times and record the first failing line. Then check one empty or missing input as an edge case.',
    demo: 'Compare pass/fail and the first failing stage. If unchanged across runs, reject order dependence. Before accepting a fix, agree the protected business behaviour; explain why the harness isolates the cause and how the edge case reaches the result.',
  }];
  return [{
    title: `Compare boundary inputs for ${symbol}`,
    hook: `Turn ${seed.trim() ? `“${seed.trim().slice(0, 160)}”` : 'one uncertain behaviour'} into a small prototype. Ask who is affected and which user/business outcome would make it useful.`,
    hypothesis: 'If the behaviour depends on an input boundary, changing only that input across the boundary will change the observed result.',
    slice: 'Use the existing entry point before adding a component; record one ordinary input and output. Run a neighbouring boundary or empty input with other conditions fixed; record the output or first failure. Sketch any new boundary and justify it against the simpler direct call.',
    demo: 'Agree an observable business acceptance criterion before claiming value. Compare outputs and failing stages; if unchanged, reject this boundary as the explanation. Explain why the architecture fits the stated constraint and how it handles the edge case.',
  }];
}

export function metaphorScaffold(ctx: CodeContext): string {
  const symbol = codeAnchors(ctx).find((name) => /filter|select|find|render|process/i.test(name)) ?? codeAnchors(ctx)[0] ?? 'this code';
  if (/filter|scope|criteria/i.test(ctx.selection)) return `Library desk: treat the scope as shelves a reader may access, and criteria as the book features they request. Read ${symbol} as the librarian combining those constraints.\nLimit: this analogy does not establish how the method is implemented.\nTry: trace one permitted item that fails a criterion. Where should it be excluded?`;
  return `Kitchen prep station: read ${symbol}'s inputs as ingredients, its steps as preparation, and its output as the finished dish. Keep those roles distinct.\nLimit: this analogy does not explain the implementation or its performance.\nTry: follow one input through the actual steps. Which step changes it, and which only passes it along?`;
}
