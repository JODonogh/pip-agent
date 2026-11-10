import type { CodeContext } from '../shared/types';

/**
 * Systematic/Graphical analyser: deterministic, no LLM, instant.
 * Turns a selection into a small flow graph you can toggle layer by layer.
 */

export type NodeKind = 'endpoint' | 'method' | 'call' | 'param' | 'return' | 'import' | 'hook' | 'state' | 'branch' | 'assert';

export interface DiagramNode {
  id: string;
  label: string;
  detail: string;
  kind: NodeKind;
  /** Source offset, not an execution order. */
  order?: number;
  sourceLine?: number;
  coverageState?: 'covered' | 'missed' | 'unknown';
  coverage?: { covered: number; total: number; source: string };
  /** Label shown instead of the kind, e.g. "table" or "filter" in a SQL diagram. */
  tag?: string;
  /** Overrides the layer the kind would put the node in (which toggle shows or hides it). */
  layer?: string;
  /** Performance cards: how much attention the choice deserves. */
  tone?: 'good' | 'watch' | 'risk';
  /** The part of the code a card is about. */
  snippet?: string;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
}

export interface Diagram {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  language: string;
  caption?: string;
  xLabel?: string;
  yLabel?: string;
  series?: { name: string; description?: string; points: { x: number; y: number }[] }[];
  sequence?: { participants: { id: string; label: string }[]; messages: { from: string; to: string; label: string; sourceLine?: number; kind?: string }[] };
}

export const LAYER_OF_KIND: Record<NodeKind, string> = {
  endpoint: 'core',
  method: 'core',
  return: 'core',
  call: 'calls',
  import: 'imports',
  param: 'params',
  hook: 'hooks',
  state: 'hooks',
  branch: 'core',
  assert: 'core',
};

const uniq = <T,>(items: T[]): T[] => [...new Set(items)];

/** Find a complete condition, including nested calls, without clipping the visible expression. */
function closingParen(code: string, start: number): number {
  let depth = 0;
  let quote = '';
  for (let index = start; index < code.length; index += 1) {
    const char = code[index]!;
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '(') depth += 1;
    else if (char === ')' && --depth === 0) return index;
    if (char === '\n' && depth > 0 && index - start > 500) break;
  }
  return start;
}

export function analyzeCode(ctx: CodeContext): Diagram {
  const code = ctx.selection;
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  const add = (node: DiagramNode, from?: string, order?: number) => {
    if (order !== undefined) {
      node.order = order;
      node.sourceLine = ctx.line + code.slice(0, order).split('\n').length - 1;
    }
    if (!nodes.some((n) => n.id === node.id)) {
      nodes.push(node);
      if (from) {
        edges.push({ from, to: node.id });
      }
    }
  };

  // Imports = dependency satellites (connection graph to other files)
  for (const match of code.matchAll(/^\s*import\s+(?:[\w*{}\s,]+?\s+from\s+)?['"]([^'"]+)['"]/gm)) {
    const source = match[1] ?? '';
    add({ id: `import:${source}`, label: source.split('/').pop() ?? source, detail: `import ${source}`, kind: 'import' }, undefined, match.index);
  }
  for (const match of code.matchAll(/^\s*import\s+[\w.]+;/gm)) {
    const source = (match[0] ?? '').replace(/^\s*import\s+/, '').replace(/;$/, '');
    add({ id: `import:${source}`, label: source.split('.').pop() ?? source, detail: `import ${source}`, kind: 'import' }, undefined, match.index);
  }

  const isJavaLike = /class\s+\w+|@\w+Mapping|public\s+\w+/.test(code) || ctx.language.includes('java');

  // Endpoint annotations, e.g. @GetMapping("/api/v1/backend")
  let endpointId: string | undefined;
  for (const match of code.matchAll(/@(Get|Post|Put|Delete|Patch|Request)Mapping(?:\(\s*"([^"]*)"\s*\))?/g)) {
    const verb = (match[1] ?? 'Request').toUpperCase();
    const path = match[2] ?? '';
    endpointId = `endpoint:${verb}:${path}`;
    add({ id: endpointId, label: `${verb} ${path}`.trim(), detail: `@${match[1]}Mapping endpoint`, kind: 'endpoint' }, undefined, match.index);
  }

  // React hooks / state
  for (const match of code.matchAll(/\b(use[A-Z]\w*)\s*\(/g)) {
    add({ id: `hook:${match[1]}`, label: match[1] ?? '', detail: `React hook ${match[1]}`, kind: 'hook' }, 'method:main', match.index);
  }
  for (const match of code.matchAll(/const\s*\[\s*(\w+)\s*,\s*(set\w+)\s*\]\s*=\s*useState/g)) {
    add({ id: `state:${match[1]}`, label: `${match[1]} / ${match[2]}`, detail: `state ${match[1]} updated by ${match[2]}`, kind: 'state' }, 'method:main', match.index);
  }

  // Method / component declaration
  let methodId = 'method:main';
  const javaMethod = /(\w[\w<>[\], ?]*)\s+(\w+)\s*\(([^)]*)\)\s*\{/.exec(code);
  const tsFunction = /(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:\([^)]*\)|[\w]+)\s*=>)/.exec(code);
  if (isJavaLike && javaMethod) {
    const name = javaMethod[2] ?? 'method';
    methodId = `method:${name}`;
    add({ id: methodId, label: `${name}()`, detail: `method ${name} returns ${javaMethod[1] ?? ''}`, kind: 'method' }, endpointId, javaMethod.index);
    const params = (javaMethod[3] ?? '').split(',').map((p) => p.trim()).filter(Boolean);
    for (const param of params) {
      const label = param.split(/\s+/).pop() ?? param;
      add({ id: `param:${label}`, label, detail: `parameter ${param}`, kind: 'param' }, methodId);
    }
  } else if (tsFunction) {
    const name = tsFunction[1] ?? tsFunction[2] ?? 'component';
    methodId = `method:${name}`;
    add({ id: methodId, label: `${name}()`, detail: `function/component ${name}`, kind: 'method' }, endpointId, tsFunction.index);
  } else {
    add({ id: methodId, label: 'selection', detail: 'selected code', kind: 'method' }, endpointId, 0);
  }

  // Calls and decisions retain source positions. These are observations, not a control-flow proof.
  const noise = new Set(['print', 'println', 'log', 'of', 'require']);
  const callMatches = [...code.matchAll(/(\w+)\.(\w+)\s*\(/g)];
  const seenCalls = new Set<string>();
  for (const match of callMatches) {
    const call = `${match[1]}.${match[2]}()`;
    if (noise.has(match[1] ?? '') || seenCalls.has(call) || seenCalls.size >= 12) continue;
    seenCalls.add(call);
    add({ id: `call:${call}`, label: call, detail: `calls ${call}`, kind: 'call' }, methodId, match.index);
  }

  for (const match of code.matchAll(/\b(if|else if|switch|try|catch)\b/g)) {
    let end = match.index + match[0].length;
    while (/\s/.test(code[end] ?? '') && end < code.length) end += 1;
    if (code[end] === '(') end = closingParen(code, end) + 1;
    const label = code.slice(match.index, end).trim();
    add({ id: `branch:${match.index}`, label, detail: `decision in excerpt: ${label}`, kind: 'branch' }, methodId, match.index);
  }

  let returnIndex = 0;
  for (const match of code.matchAll(/\breturn\s+([^;\n]+);?/g)) {
    const label = (match[1] ?? '').trim();
    add({ id: returnIndex++ === 0 ? 'return:main' : `return:${match.index}`, label: `return ${label}`,
      detail: `return site in excerpt: ${label}`, kind: 'return' }, methodId, match.index);
  }
  // Hook edges were collected before the method declaration was known.
  for (const edge of edges) if (edge.from === 'method:main') edge.from = methodId;

  return { nodes, edges, language: ctx.language };
}

export interface Diagrams {
  dataFlow: Diagram;
  architecture: Diagram;
  testing: Diagram;
  sequence: Diagram;
  dependencies: Diagram;
  availableTypes: string[];
}

/** Three views of the same selection: flow, architecture, and how you would test it. */
export function analyzeDiagrams(ctx: CodeContext): Diagrams {
  const flow = analyzeCode(ctx);
  const byKind = (kinds: NodeKind[]) => flow.nodes.filter((n) => kinds.includes(n.kind));

  const method = byKind(['method'])[0]!;
  const imports = byKind(['import']);
  const receivers = uniq([...ctx.selection.matchAll(/\b(\w+)\.\w+\s*\(/g)].map((match) => match[1]!));
  const receiverNodes: DiagramNode[] = receivers.filter((receiver) => receiver !== 'this' && receiver !== 'super').map((receiver) => ({
    id: `dependency:${receiver}`, label: receiver, detail: `receiver of an outgoing call in this excerpt: ${receiver}`, kind: 'import',
  }));
  const dependencyNodes = [method, ...imports, ...receiverNodes];
  const dependencies: Diagram = {
    language: ctx.language,
    nodes: dependencyNodes,
    edges: dependencyNodes.slice(1).map((node) => ({ from: method.id, to: node.id })),
    caption: 'Dependencies visible in this excerpt: imports and call receivers. This is not a project-wide map.',
  };
  const architectureNodes = [...byKind(['endpoint', 'method']), ...imports];
  const architecture: Diagram = {
    language: ctx.language,
    nodes: architectureNodes,
    edges: architectureNodes.slice(1).map((node) => ({ from: architectureNodes[0]!.id, to: node.id })),
    caption: 'Component and endpoint relationships visible in the selected code only.',
  };
  const sequenceCalls: DiagramNode[] = [...ctx.selection.matchAll(/(\w+)\.(\w+)\s*\(/g)].slice(0, 16).map((match) => ({
    id: `sequence:call:${match.index}`, label: `${match[1]}.${match[2]}()`, detail: `call site at line ${ctx.line + ctx.selection.slice(0, match.index).split('\n').length - 1}`,
    kind: 'call', order: match.index, sourceLine: ctx.line + ctx.selection.slice(0, match.index).split('\n').length - 1,
  }));
  const sequenceNodes = [...flow.nodes.filter((node) => ['method', 'branch', 'return'].includes(node.kind)), ...sequenceCalls]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const participants = [{ id: 'selection', label: method.label }];
  const participantIds = new Set(['selection']);
  const messages = [...ctx.selection.matchAll(/\b([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*\(/g)].slice(0, 24).map((match) => {
    const receiver = match[1]!;
    if (!participantIds.has(receiver)) {
      participantIds.add(receiver);
      participants.push({ id: receiver, label: receiver });
    }
    return { from: 'selection', to: receiver, label: `${receiver}.${match[2]}()`,
      sourceLine: ctx.line + ctx.selection.slice(0, match.index).split('\n').length - 1 };
  });
  const sequence: Diagram = {
    sequence: { participants, messages },
    language: ctx.language,
    nodes: sequenceNodes,
    edges: sequenceNodes.slice(1).map((node, index) => ({ from: sequenceNodes[index]!.id, to: node.id })),
    caption: 'Source-order excerpt sketch, not an execution trace. Branches and return sites are alternatives; nested expressions may execute in a different order.',
  };

  // Testing flow: Arrange (params) → Act (method) → branches → Assert (assertions or return)
  const testingNodes: DiagramNode[] = [];
  const params = byKind(['param']);
  if (params.length > 0) {
    testingNodes.push({
      id: 'test:arrange',
      label: `Arrange: ${params.map((p) => p.label).join(', ')}`,
      detail: 'test inputs / arrange step',
      kind: 'param',
    });
  }
  for (const node of byKind(['method', 'endpoint'])) {
    testingNodes.push({ ...node, id: `test:${node.id}`, label: `Act: ${node.label}` });
  }
  for (const node of byKind(['branch'])) {
    testingNodes.push({ ...node, id: `test:${node.id}`, label: `Test both sides: ${node.label}` });
  }
  const assertCalls = uniq(
    [...ctx.selection.matchAll(/\b(assert\w*|expect|verify|should\w*)\s*\(/g)].map((m) => `${m[1]}()`),
  );
  if (assertCalls.length > 0) {
    for (const call of assertCalls.slice(0, 4)) {
      testingNodes.push({ id: `test:assert:${call}`, label: `Assert: ${call}`, detail: `assertion ${call}`, kind: 'assert' });
    }
  } else {
    const ret = byKind(['return'])[0];
    testingNodes.push({
      id: 'test:assert:return',
      label: ret ? `Assert on: ${ret.label}` : 'Assert on the outcome',
      detail: 'suggested assertion target, not evidence that a test exists',
      kind: 'assert',
    });
  }
  const testing: Diagram = { language: ctx.language, nodes: testingNodes, edges: [] };

  const hasMethod = method.id !== 'method:main';
  const hasEndpoint = byKind(['endpoint']).length > 0;
  const hasStructure = hasMethod && (imports.length > 0 || (hasEndpoint && receiverNodes.length > 0));
  const executable = flow.nodes.some((node) => ['call', 'branch', 'return'].includes(node.kind));
  const availableTypes = ['dataFlow'];
  if (messages.length >= 2 && participantIds.size >= 2) availableTypes.push('sequence');
  if (dependencyNodes.length > 1) availableTypes.push('dependencies');
  if (hasStructure && architectureNodes.length > 1) availableTypes.push('architecture');
  if (executable || assertCalls.length > 0 || params.length > 0) availableTypes.push('testing');
  flow.caption = 'Code elements found in this excerpt. Connections show relationships, not proven execution order.';
  return { dataFlow: flow, architecture, testing, sequence, dependencies, availableTypes };
}
