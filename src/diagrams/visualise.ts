import { analyzeDiagrams, type Diagram, type DiagramNode, type Diagrams } from './diagram';
import { javaTestingDiagram } from './junit-outline';
import { parseSql, sqlCostDiagram, sqlFlowDiagram } from './sql';
import type { CodeContext } from '../shared/types';

export interface BranchCoverage {
  covered: number;
  total: number;
  source: string;
  outcomes?: number[];
}
export interface CoverageReport { file: string; lines: Record<number, BranchCoverage>; }
export type Visualisations = Diagrams & Record<'decisions' | 'circuit' | 'wireframe' | 'cartesian' | 'growth' | 'context' | 'security', Diagram>;
const normal = (path: string): string => path.replace(/\\/g, '/').replace(/^\.\//, '');
const sameFile = (a: string, b: string): boolean => normal(a) === normal(b) || normal(a).endsWith('/' + normal(b)) || normal(b).endsWith('/' + normal(a));
const attrs = (xml: string): Record<string, string> => Object.fromEntries([...xml.matchAll(/([\w]+)=["']([^"']*)["']/g)].map((match) => [match[1]!, match[2]!]));
const count = (value: unknown): number => {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('Invalid branch count in report.');
  return result;
};

/** Read imported evidence only; never run tests or interpret missing coverage as a miss. */
export function readCoverage(raw: string, file: string): CoverageReport {
  const files: CoverageReport[] = [];
  if (raw.trim().startsWith('{')) {
    const json = JSON.parse(raw) as Record<string, any>;
    for (const [path, entry] of Object.entries(json)) {
      if (!entry || typeof entry !== 'object' || !entry.branchMap || !entry.b) continue;
      const lines: Record<number, BranchCoverage> = {};
      for (const [id, branch] of Object.entries(entry.branchMap) as [string, any][]) {
        const line = Number(branch.loc?.start?.line ?? branch.line);
        const values = entry.b[id];
        if (!Number.isInteger(line) || line < 1 || !Array.isArray(values) || !values.length) continue;
        const hits = values.map(count);
        const previous = lines[line];
        lines[line] = { covered: (previous?.covered ?? 0) + hits.filter((hit) => hit > 0).length,
          total: (previous?.total ?? 0) + hits.length, source: 'Vitest / Istanbul',
          outcomes: !previous && branch.type === 'if' && hits.length === 2 ? hits : undefined };
      }
      files.push({ file: String(entry.path ?? path), lines });
    }
  } else if (raw.includes('<report')) {
    for (const pkg of raw.matchAll(/<package\b([^>]*)>([\s\S]*?)<\/package>/g)) {
      for (const source of pkg[2]!.matchAll(/<sourcefile\b([^>]*)>([\s\S]*?)<\/sourcefile>/g)) {
        const lines: Record<number, BranchCoverage> = {};
        for (const line of source[2]!.matchAll(/<line\b([^>]*)\/?\s*>/g)) {
          const data = attrs(line[1]!);
          const covered = count(data.cb ?? 0), missed = count(data.mb ?? 0), number = count(data.nr);
          if (covered + missed && number) lines[number] = { covered, total: covered + missed, source: 'JaCoCo' };
        }
        files.push({ file: [attrs(pkg[1]!).name, attrs(source[1]!).name].filter(Boolean).join('/'), lines });
      }
    }
  } else throw new Error('Choose a Vitest/Istanbul coverage-final.json or JaCoCo XML report.');
  const matches = files.filter((report) => sameFile(report.file, file));
  if (matches.length !== 1) throw new Error('The report does not uniquely match the selected source file.');
  return { ...matches[0]!, file };
}

export function visualise(ctx: CodeContext, coverage?: CoverageReport): Visualisations {
  const diagrams = analyzeDiagrams(ctx);
  const junit = javaTestingDiagram(ctx);
  if (junit) {
    diagrams.testing = junit;
    if (!diagrams.availableTypes.includes('testing')) diagrams.availableTypes.push('testing');
  }
  const activeCoverage = coverage && sameFile(coverage.file, ctx.file) ? coverage : undefined;
  const branches = diagrams.dataFlow.nodes.filter((node) => node.kind === 'branch' && /^if\b|^else if\b/.test(node.label));
  const nodes: DiagramNode[] = [], edges: Diagram['edges'] = [];
  for (const branch of branches.slice(0, 8)) {
    const coverage = branch.sourceLine ? activeCoverage?.lines[branch.sourceLine] : undefined;
    nodes.push({ ...branch, coverage, coverageState: coverage ? coverage.covered === coverage.total ? 'covered' : 'missed' : 'unknown' });
    for (const [index, outcome] of ['true', 'false'].entries()) {
      const id = `${branch.id}:${outcome}`;
      const unambiguous = branches.filter((candidate) => candidate.sourceLine === branch.sourceLine).length === 1;
      const hits = unambiguous ? coverage?.outcomes?.[index] : undefined;
      nodes.push({ id, kind: 'assert', label: outcome === 'true' ? 'Condition holds' : 'Condition does not hold',
        detail: `Check the ${outcome} outcome of ${branch.label}; no path execution is inferred.`,
        coverageState: hits === undefined ? 'unknown' : hits > 0 ? 'covered' : 'missed' });
      edges.push({ from: branch.id, to: id, label: outcome });
    }
  }
  const decisions: Diagram = { nodes, edges, language: ctx.language, caption: activeCoverage ?
    'Independent condition outcomes with imported branch evidence. JaCoCo counts are line totals; true/false outcomes remain unknown. Reports can be stale after source edits.' :
    'Condition checklist, not a complete control-flow tree. Both outcomes need tests; coverage is unknown until you load a report.' };
  // A receiver is only a source reference when it occurs in an actual call.
  // Suppress string variables, enum valueOf and utility classes: they are not system components.
  const method = diagrams.dataFlow.nodes.find((node) => node.kind === 'method')!;
  const calls = [...ctx.selection.matchAll(/\b([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*\(/g)];
  const systemReceiver = /(?:service|repository|repo|client|controller|gateway|manager|adapter|store|bus|queue|publisher|handler|processor|api|db)$/i;
  const seen = new Set<string>();
  const collaborators = calls.filter((match) => systemReceiver.test(match[1]!) && !/^(clear|reset|cleanup)$/i.test(match[2]!) && !seen.has(match[1]!) && !!seen.add(match[1]!))
    .slice(0, 10).map((match): DiagramNode => ({ id: `collaborator:${match[1]}`, kind: 'call',
      label: `${match[1]}.${match[2]}()`, detail: `Outgoing call visible in the selection: ${match[1]}.${match[2]}(). The target implementation has not been traced.` }));
  const dependency: Diagram = { nodes: [method, ...collaborators],
    edges: collaborators.map((node) => ({ from: method.id, to: node.id })), language: ctx.language,
    caption: 'Outgoing calls to likely collaborators in the selection. These are source references; implementations and callers have not been traced.' };
  const contextImports = [...ctx.surrounding.matchAll(/^\s*import\s+([^;\n]+);?/gm)].slice(0, 12).map((match, index): DiagramNode => ({
    id: `context:import:${index}`, kind: 'import', label: match[1]!.trim(), detail: 'Import in the selected file; use and implementation have not been traced.',
  }));
  const root: DiagramNode = { id: 'context:selection', kind: 'method', label: ctx.file.split(/[\\/]/).pop() ?? ctx.file, detail: `Selected code in ${ctx.file}:${ctx.line}` };
  const contextNodes = [root, ...contextImports, ...collaborators];
  const context: Diagram = { nodes: contextNodes, edges: contextNodes.slice(1).map((node) => ({ from: root.id, to: node.id })), language: ctx.language,
    caption: 'Selected file and visible imports/receivers. These are source references, not a project-wide or runtime wiring map.' };
  // A request or query by itself is not evidence of a security boundary. Only show
  // explicitly named guards, and never claim they actually protect the system.
  const securityNodes = diagrams.dataFlow.nodes.filter((node) => node.kind === 'call' &&
    /\.(?:authenticate|authorize|authorise|checkPermission|validateToken|verifyToken|encrypt|decrypt|escapeHtml|sanitize)\(\)/i.test(node.label));
  const security: Diagram = { nodes: [root, ...securityNodes], edges: securityNodes.map((node) => ({ from: root.id, to: node.id })), language: ctx.language,
    caption: 'Explicitly named security-related calls visible in the excerpt. Their names do not prove that a boundary is protected; inspect their implementation.' };
  // For request assertions, show the relationships actually written in the test.
  // This is a source sketch, not a trace of network traffic.
  const code = ctx.selection;
  if (/\bexpect\s*\(\s*requests\s*\.\s*map\s*\([\s\S]{0,200}?\.pathname\b[\s\S]{0,100}?\.toEqual\s*\(/.test(code)) {
    const testNodes: DiagramNode[] = [
      { id: 'data:requests', kind: 'param', label: 'requests', detail: 'The request collection referenced by this test.' },
      { id: 'data:pathname', kind: 'call', label: 'requests.map(…pathname)', detail: 'Extracts pathname from each request for the assertion.' },
      { id: 'data:expected-paths', kind: 'assert', label: 'Expected paths', detail: 'The mapped pathnames are compared with the expected values in the test.' },
    ];
    const testEdges: Diagram['edges'] = [{ from: 'data:requests', to: 'data:pathname', label: 'map' }, { from: 'data:pathname', to: 'data:expected-paths', label: 'compare' }];
    if (/\bexpect\s*\([\s\S]{0,120}?requests\s*\[\s*0\s*\]\s*\.\s*searchParams[\s\S]{0,100}?\.toEqual\s*\(/.test(code)) {
      testNodes.push({ id: 'data:params', kind: 'call', label: 'requests[0].searchParams', detail: 'Search parameters from the first request, transformed for the assertion.' },
        { id: 'data:expected-params', kind: 'assert', label: 'Expected parameters', detail: 'The parameters are compared with the expected values in the test.' });
      testEdges.push({ from: 'data:requests', to: 'data:params', label: 'first request' }, { from: 'data:params', to: 'data:expected-params', label: 'compare' });
    }
    diagrams.dataFlow = { nodes: testNodes, edges: testEdges, language: ctx.language,
      caption: 'Data relationships explicitly referenced in the test: request paths and parameters are transformed and compared with expected values. This is not a runtime trace.' };
  }
  // SQL gets views built from the query itself: its parameters, subqueries, filters and sort.
  const sql = parseSql(ctx.selection);
  if (sql) diagrams.dataFlow = sqlFlowDiagram(sql, ctx.language);
  // A narrowly recognisable chain permits an illustrative, code-related model without pretending to benchmark.
  const chain = /\b([A-Za-z_$][\w$]*)\s*\.\s*trim\(\s*\)\s*\.\s*toUpperCase\(\s*(?:Locale\.ROOT)?\s*\)/.exec(ctx.selection);
  const points = [1, 2, 4, 8, 16];
  const counts = [...code.matchAll(/\bexpect\s*\(\s*requests\s*(?:\.\s*length)?\s*\)\s*\.\s*(?:toHaveLength|toBe|toEqual)\s*\(\s*(\d+)\s*\)/g)].map((match) => Number(match[1]));
  const cartesian: Diagram = { nodes: [], edges: [], language: ctx.language,
    xLabel: 'Input length n (UTF-16 units)', yLabel: 'Illustrative character visits',
    series: chain ? [
      { name: 'One pass: n', description: 'A simple n-character scan for trim or uppercase individually; the actual work depends on the implementation.', points: points.map((x) => ({ x, y: x })) },
      { name: 'Two passes: 2n', description: 'Adds both illustrative passes; excludes enum lookup, allocations, Unicode expansion, and error paths.', points: points.map((x) => ({ x, y: 2 * x })) },
    ] : [],
    caption: chain ? `Illustrative model for ${chain[1]}.trim().toUpperCase(): the first line represents a simplified n-character pass (trim or uppercase); the second adds two n-character passes. Actual work depends on input and implementation. It excludes enum lookup, allocations, Unicode expansion, null and exception paths; this is not a benchmark.` :
      'No supported code-specific model is available for this selection.' };
  if (!chain && counts.length >= 2) {
    cartesian.xLabel = 'Assertion checkpoint (source order)';
    cartesian.yLabel = 'Expected request count';
    cartesian.series = [{ name: 'Expected requests', description: 'Literal counts asserted in the selected test, in source order; these are expectations, not measured traffic or timing.', points: counts.map((y, index) => ({ x: index + 1, y })) }];
    cartesian.caption = 'Request counts asserted at each checkpoint in the selected test. These are test expectations, not measured network traffic or performance.';
  }
  const growth: Diagram = { nodes: [], edges: [], language: ctx.language,
    xLabel: 'Input size n', yLabel: 'Illustrative work units',
    series: [
      { name: 'n', description: 'Work grows in proportion to input size.', points: points.map((x) => ({ x, y: x })) },
      { name: '2n', description: 'Twice the work of n for the same input size.', points: points.map((x) => ({ x, y: 2 * x })) },
      { name: 'n²', description: 'Work grows with the square of input size.', points: points.map((x) => ({ x, y: x * x })) },
    ],
    caption: 'General growth examples for learning: input size is on the horizontal axis and illustrative work units on the vertical axis. These curves are not measurements or inferred complexity for the selected code.' };
  if (/\brequests\s*\.\s*map\s*\([\s\S]{0,200}?\.pathname\b/.test(code)) {
    growth.caption = 'For requests.map(…pathname), n is the number of recorded requests. The map visits each entry once. Two passes and an all-pairs comparison are hypothetical; this does not describe the whole test or measured performance.';
    growth.series = [
      { name: 'n', description: 'One traversal, like mapping each recorded request to its pathname.', points: points.map((x) => ({ x, y: x })) },
      { name: '2n', description: 'Two complete passes over the same requests, shown as a hypothetical comparison.', points: points.map((x) => ({ x, y: 2 * x })) },
      { name: 'n²', description: 'A hypothetical all-pairs comparison; this is not shown in the selected map.', points: points.map((x) => ({ x, y: x * x })) },
    ];
  }
  const multiTest = !!junit && junit.nodes.filter((node) => node.id.startsWith('junit:test:')).length > 1;
  const availableTypes = diagrams.availableTypes.filter((type) => type !== 'dependencies' && type !== 'architecture' &&
    !(multiTest && (type === 'dataFlow' || type === 'sequence')));
  const endpoint = diagrams.dataFlow.nodes.find((node) => node.kind === 'endpoint');
  const architecture: Diagram = { language: ctx.language, nodes: endpoint ? [endpoint, method, ...collaborators] : [],
    edges: endpoint ? [{ from: endpoint.id, to: method.id }, ...collaborators.map((node) => ({ from: method.id, to: node.id }))] : [],
    caption: 'Endpoint and outgoing collaborator calls visible in the selection. Implementations and callers are not traced.' };
  if (!multiTest && endpoint && collaborators.length) availableTypes.push('architecture');
  if (!multiTest && collaborators.length >= 2) availableTypes.push('dependencies');
  if (!multiTest && branches.length) availableTypes.push('decisions');
  // Different layouts are useful when they distinguish several collaborators, not just restyle one call.
  if (!multiTest && collaborators.length >= 2) availableTypes.push('circuit', 'wireframe');
  if (!multiTest && securityNodes.length) availableTypes.push('security');
  availableTypes.push('growth');
  if (chain || counts.length >= 2) availableTypes.push('cartesian');
  return { ...diagrams, dependencies: dependency, architecture, decisions, context, security, cartesian, growth: sql ? sqlCostDiagram(sql, ctx.language) : growth, availableTypes,
    circuit: { ...dependency, caption: 'Circuit analogy: components and reference lines from the excerpt. Lines are software relationships, not electrical behaviour.' },
    wireframe: { ...dependency, caption: 'Isometric wireframe of the same source references. Depth separates components visually; it is not a measured distance.' } };
}
