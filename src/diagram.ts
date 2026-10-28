import type { CodeContext } from './types';

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
}

export interface DiagramEdge {
  from: string;
  to: string;
}

export interface Diagram {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  language: string;
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

export function analyzeCode(ctx: CodeContext): Diagram {
  const code = ctx.selection;
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  const add = (node: DiagramNode, from?: string) => {
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
    add({ id: `import:${source}`, label: source.split('/').pop() ?? source, detail: `import ${source}`, kind: 'import' });
  }
  for (const match of code.matchAll(/^\s*import\s+[\w.]+;/gm)) {
    const source = (match[0] ?? '').replace(/^\s*import\s+/, '').replace(/;$/, '');
    add({ id: `import:${source}`, label: source.split('.').pop() ?? source, detail: `import ${source}`, kind: 'import' });
  }

  const isJavaLike = /class\s+\w+|@\w+Mapping|public\s+\w+/.test(code) || ctx.language.includes('java');

  // Endpoint annotations, e.g. @GetMapping("/api/v1/backend")
  let endpointId: string | undefined;
  for (const match of code.matchAll(/@(Get|Post|Put|Delete|Patch|Request)Mapping(?:\(\s*"([^"]*)"\s*\))?/g)) {
    const verb = (match[1] ?? 'Request').toUpperCase();
    const path = match[2] ?? '';
    endpointId = `endpoint:${verb}:${path}`;
    add({ id: endpointId, label: `${verb} ${path}`.trim(), detail: `@${match[1]}Mapping endpoint`, kind: 'endpoint' });
  }

  // React hooks / state
  for (const match of code.matchAll(/\b(use[A-Z]\w*)\s*\(/g)) {
    add({ id: `hook:${match[1]}`, label: match[1] ?? '', detail: `React hook ${match[1]}`, kind: 'hook' }, 'method:main');
  }
  for (const match of code.matchAll(/const\s*\[\s*(\w+)\s*,\s*(set\w+)\s*\]\s*=\s*useState/g)) {
    add({ id: `state:${match[1]}`, label: `${match[1]} / ${match[2]}`, detail: `state ${match[1]} updated by ${match[2]}`, kind: 'state' }, 'method:main');
  }

  // Method / component declaration
  let methodId = 'method:main';
  const javaMethod = /(\w[\w<>[\], ?]*)\s+(\w+)\s*\(([^)]*)\)\s*\{/.exec(code);
  const tsFunction = /(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:\([^)]*\)|[\w]+)\s*=>)/.exec(code);
  if (isJavaLike && javaMethod) {
    const name = javaMethod[2] ?? 'method';
    methodId = `method:${name}`;
    add({ id: methodId, label: `${name}()`, detail: `method ${name} returns ${javaMethod[1] ?? ''}`, kind: 'method' }, endpointId);
    const params = (javaMethod[3] ?? '').split(',').map((p) => p.trim()).filter(Boolean);
    for (const param of params) {
      const label = param.split(/\s+/).pop() ?? param;
      add({ id: `param:${label}`, label, detail: `parameter ${param}`, kind: 'param' }, methodId);
    }
  } else if (tsFunction) {
    const name = tsFunction[1] ?? tsFunction[2] ?? 'component';
    methodId = `method:${name}`;
    add({ id: methodId, label: `${name}()`, detail: `function/component ${name}`, kind: 'method' }, endpointId);
  } else {
    add({ id: methodId, label: 'selection', detail: 'selected code', kind: 'method' }, endpointId);
  }

  // Outgoing calls: obj.method( and bare calls, minus noise
  const noise = new Set(['if', 'for', 'while', 'switch', 'return', 'new', 'catch', 'print', 'println', 'log', 'of', 'require']);
  const calls = uniq(
    [...code.matchAll(/(\w+)\.(\w+)\s*\(/g)].map((m) => `${m[1]}.${m[2]}()`),
  ).filter((c) => !noise.has(c.split('.')[0] ?? ''));
  for (const call of calls.slice(0, 8)) {
    add({ id: `call:${call}`, label: call, detail: `calls ${call}`, kind: 'call' }, methodId);
  }

  // Branches — the decision points a reader (and a test) must reason about
  for (const match of code.matchAll(/\b(if|else if|switch|try|catch)\s*(\([^)]*\))?/g)) {
    const label = `${match[1]}${match[2] ? ` ${match[2].slice(0, 30)}` : ''}`;
    add({ id: `branch:${label}`, label, detail: `branch ${label}`, kind: 'branch' }, methodId);
  }

  // Return value
  const returnMatch = /return\s+([^;]+);?/.exec(code);
  if (returnMatch) {
    const label = (returnMatch[1] ?? '').trim().slice(0, 42);
    add({ id: 'return:main', label: `return ${label}`, detail: `returns ${label}`, kind: 'return' }, methodId);
  }

  return { nodes, edges, language: ctx.language };
}

export interface Diagrams {
  dataFlow: Diagram;
  architecture: Diagram;
  testing: Diagram;
}

/** Three views of the same selection: flow, architecture, and how you would test it. */
export function analyzeDiagrams(ctx: CodeContext): Diagrams {
  const flow = analyzeCode(ctx);
  const byKind = (kinds: NodeKind[]) => flow.nodes.filter((n) => kinds.includes(n.kind));

  const architecture: Diagram = {
    language: ctx.language,
    nodes: byKind(['endpoint', 'method', 'import']),
    edges: [],
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
      detail: 'what to assert in a test',
      kind: 'assert',
    });
  }
  const testing: Diagram = { language: ctx.language, nodes: testingNodes, edges: [] };

  return { dataFlow: flow, architecture, testing };
}
