import { analyzeCode } from './diagram';
import type { Diagram, DiagramNode } from './diagram';
import type { CodeContext, TurnStat } from '../shared/types';
import { estimateTokens } from '../shared/types';

export interface LlmGlassInput {
  stats: readonly TurnStat[];
  lastRun?: {
    promptEvalCount: number;
    promptEvalDurationMs: number;
    evalCount: number;
    evalDurationMs: number;
    model: string;
    worker: string;
  };
  temperature?: number;
}

const TOKEN_TICKS = [200, 500, 1000, 2000, 4000];

function tokenAxis(selectionTokens: number): number[] {
  const axis = TOKEN_TICKS.filter((tick) => tick <= Math.max(2000, selectionTokens * 2));
  if (selectionTokens >= 80 && !axis.includes(selectionTokens)) axis.push(selectionTokens);
  return [...new Set(axis)].sort((a, b) => a - b);
}

/** Theoretical attention (quadratic in context) vs KV cache (linear) on the same token axis. */
export function llmPhysicsDiagram(ctx: CodeContext, glass?: LlmGlassInput | null): Diagram {
  const selectionTokens = estimateTokens(ctx.selection);
  const axis = tokenAxis(selectionTokens);
  const base = axis[0] ?? 200;
  const series: Diagram['series'] = [
    {
      name: 'KV cache O(n)',
      description: 'Illustrative linear memory/compute for cached prefix length (not measured on this GPU).',
      points: axis.map((x) => ({ x, y: x })),
    },
    {
      name: 'Attention O(n²)',
      description: 'Illustrative pairwise attention cost grows with the square of context length.',
      points: axis.map((x) => ({ x, y: Math.round((x * x) / base) })),
    },
  ];
  const measured = (glass?.stats ?? []).filter((stat) => !stat.fromMock && stat.estTokens > 0 && stat.latencyMs > 0).slice(0, 15);
  if (measured.length >= 2) {
    series.push({
      name: 'Measured round-trip (ms)',
      description: 'Recent local PIP runs: latency vs estimated tokens for that turn (includes prompt + generation).',
      points: measured.map((stat) => ({ x: stat.estTokens, y: stat.latencyMs })),
    });
  }
  if (glass?.lastRun && glass.lastRun.promptEvalCount > 0) {
    series.push({
      name: 'Last prompt pass (ms)',
      description: `Ollama prompt_eval for ${glass.lastRun.worker} on ${glass.lastRun.model}.`,
      points: [{ x: glass.lastRun.promptEvalCount, y: Math.round(glass.lastRun.promptEvalDurationMs) }],
    });
    if (glass.lastRun.evalCount > 0) {
      series.push({
        name: 'Last generation (ms)',
        description: 'Ollama eval phase for completion tokens on the most recent instrumented call.',
        points: [{ x: glass.lastRun.evalCount, y: Math.round(glass.lastRun.evalDurationMs) }],
      });
    }
  }
  const pin = selectionTokens >= 80 ? ` Your selection is about ${selectionTokens} estimated prompt tokens.` : '';
  return {
    nodes: [],
    edges: [],
    language: 'llm',
    xLabel: 'Context or output tokens (estimated unless from Ollama)',
    yLabel: 'Illustrative units or milliseconds',
    series,
    caption:
      'Glass box: compare quadratic attention scaling with linear KV growth, then overlay real local timings when PIP has run probes or explanations.' +
      pin +
      ' Curves are teaching sketches unless labeled as measured or from Ollama telemetry.',
  };
}

/** Overlay an estimated token stream on the excerpt’s syntax branches (deterministic, not a live trace). */
export function enrichDataFlowForLlm(ctx: CodeContext, flow: Diagram, glass?: LlmGlassInput | null): Diagram {
  const est = estimateTokens(ctx.selection);
  const temp = glass?.temperature;
  const stream: DiagramNode = {
    id: 'llm:token-stream',
    kind: 'param',
    layer: 'tokens',
    label: `~${est} prompt tokens`,
    detail:
      temp != null
        ? `Sampling temperature ${temp} increases entropy on branchy syntax; this sketch links the token budget to visible branches in the selection.`
        : 'Token budget estimated from selection length (chars/4). Branch nodes are where decoders often scramble structure when temperature rises.',
    tag: 'token',
  };
  const code = analyzeCode(ctx);
  const branches = code.nodes.filter((node) => node.kind === 'branch').slice(0, 8);
  const extraNodes: DiagramNode[] = [stream];
  const extraEdges: Diagram['edges'] = [];
  for (const branch of branches) {
    const match = flow.nodes.find((node) => node.sourceLine === branch.sourceLine && node.kind === 'branch')
      ?? flow.nodes.find((node) => node.label === branch.label);
    const target = match ?? branch;
    if (!flow.nodes.some((node) => node.id === target.id)) extraNodes.push({ ...target, id: target.id });
    extraEdges.push({ from: stream.id, to: target.id, label: 'decode branch' });
  }
  const braceHits = [...ctx.selection.matchAll(/[{}();]/g)].slice(0, 6);
  braceHits.forEach((match, index) => {
    const id = `llm:syntax:${index}`;
    extraNodes.push({
      id,
      kind: 'assert',
      layer: 'tokens',
      label: match[0]!,
      detail: 'Delimiter in source order; high temperature can mis-align generated delimiters with this structure.',
      tag: 'ast',
    });
    extraEdges.push({ from: stream.id, to: id, label: `pos ${match.index ?? index}` });
  });
  const seen = new Set(flow.nodes.map((node) => node.id));
  const nodes = [...flow.nodes, ...extraNodes.filter((node) => !seen.has(node.id))];
  const caption = `${flow.caption ?? ''} Glass box token-to-syntax overlay: not a runtime AST, but the branches and delimiters visible in this excerpt.`.trim();
  return { ...flow, nodes, edges: [...extraEdges, ...flow.edges], caption };
}
