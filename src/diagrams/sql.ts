import type { Diagram, DiagramEdge, DiagramNode } from './diagram';

/**
 * A small, deterministic reader for one SELECT statement (a Java text block, a string, or a .sql file).
 * It extracts what is visibly there (tables, bound parameters, WHERE conditions, ORDER BY) so the Data flow
 * and Performance views describe this query instead of a generic shape. It is not a SQL planner or validator.
 */

export interface SqlTable {
  name: string;
  alias: string;
  /** How the table is used: the main FROM table, a JOIN, or a subquery inside a WHERE condition. */
  kind: 'from' | 'join' | 'exists' | 'not exists' | 'in subquery';
  /** Columns the subquery matches on (the outer row, or a bound parameter). */
  columns: string[];
}

export interface SqlFilter {
  text: string;
  params: string[];
  /** Number of OR alternatives at the top level of the condition (1 when there is no OR). */
  alternatives: number;
  subqueries: SqlTable[];
}

export interface SqlParam {
  name: string;
  type: string;
  /** A null value switches the filter off, e.g. `:x IS NULL OR ...`. */
  optional: boolean;
  list: boolean;
}

export interface SqlQuery {
  text: string;
  select: string;
  main: SqlTable;
  joins: SqlTable[];
  filters: SqlFilter[];
  params: SqlParam[];
  orderBy: string;
  limit: string;
}

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();
const clip = (text: string, length: number): string => (text.length > length ? `${text.slice(0, length - 1)}…` : text);
const unique = <T,>(items: T[]): T[] => [...new Set(items)];
const shortName = (name: string): string => name.split('.').pop() ?? name;
const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Blank out string literals and comments (keeping offsets) so keywords and brackets inside them are ignored. */
function mask(text: string): string {
  return text
    .replace(/'(?:[^']|'')*'/g, (match) => `'${' '.repeat(Math.max(0, match.length - 2))}'`)
    .replace(/--[^\n]*/g, (match) => ' '.repeat(match.length))
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '));
}

function depthMap(masked: string): number[] {
  const depth: number[] = [];
  let level = 0;
  for (const char of masked) {
    if (char === '(') { depth.push(level); level += 1; }
    else if (char === ')') { level = Math.max(0, level - 1); depth.push(level); }
    else depth.push(level);
  }
  return depth;
}

/** Split on a keyword that is not inside brackets (AND ignores the AND that belongs to BETWEEN). */
function splitKeyword(text: string, word: 'AND' | 'OR'): string[] {
  const masked = mask(text);
  const depth = depthMap(masked);
  const pattern = word === 'AND' ? /\b(AND|BETWEEN)\b/gi : /\b(OR)\b/gi;
  const parts: string[] = [];
  let from = 0;
  let between = false;
  for (let hit = pattern.exec(masked); hit; hit = pattern.exec(masked)) {
    if (depth[hit.index] !== 0) continue;
    if (hit[1]!.toUpperCase() === 'BETWEEN') { between = true; continue; }
    if (between) { between = false; continue; }
    parts.push(text.slice(from, hit.index));
    from = hit.index + hit[0].length;
  }
  parts.push(text.slice(from));
  return parts.map((part) => part.trim()).filter(Boolean);
}

function closingBracket(text: string): number {
  const masked = mask(text);
  let level = 0;
  for (let index = 0; index < masked.length; index += 1) {
    if (masked[index] === '(') level += 1;
    else if (masked[index] === ')' && --level === 0) return index;
  }
  return -1;
}

function unwrap(text: string): string {
  let result = text.trim();
  while (result.startsWith('(') && closingBracket(result) === result.length - 1) result = result.slice(1, -1).trim();
  return result;
}

/** The SQL inside a Java text block or string, or the text itself; null when it is not a SELECT. */
function extractSql(selection: string): string | null {
  const start = /\bSELECT\b/i.exec(selection);
  if (!start) return null;
  let text = selection.slice(start.index);
  const block = text.indexOf('"""');
  if (block >= 0) text = text.slice(0, block);
  else {
    text = text.replace(/"\s*\+\s*"/g, ' ');
    const quote = text.indexOf('"');
    if (quote >= 0) text = text.slice(0, quote);
  }
  text = text.replace(/\\[nt]/g, ' ').replace(/\\\\/g, '\\');
  // English prose that happens to contain "select ... from" is not SQL.
  const upper = /\bSELECT\b[\s\S]*\bFROM\b/.test(text);
  const lower = /\bselect\b[\s\S]*\bfrom\b\s+[\w.]+[\s\S]*\b(?:where|join|group\s+by|order\s+by)\b/i.test(text);
  return upper || lower ? text : null;
}

export function parseSql(selection: string): SqlQuery | null {
  const text = extractSql(selection);
  if (!text) return null;
  const masked = mask(text);
  const depth = depthMap(masked);
  const top = (source: string, from = 0, to = masked.length): { index: number; length: number } | null => {
    const pattern = new RegExp(source, 'gi');
    pattern.lastIndex = from;
    for (let hit = pattern.exec(masked); hit && hit.index < to; hit = pattern.exec(masked)) {
      if (depth[hit.index] === 0) return { index: hit.index, length: hit[0].length };
    }
    return null;
  };
  const TAIL = '\\b(?:GROUP\\s+BY|HAVING|ORDER\\s+BY|LIMIT|OFFSET|FETCH|UNION|INTERSECT|EXCEPT|FOR\\s+UPDATE)\\b';
  const select = top('\\bSELECT\\b');
  const from = select && top('\\bFROM\\b', select.index);
  if (!select || !from) return null;
  const where = top('\\bWHERE\\b', from.index);
  const tail = top(TAIL, where ? where.index : from.index);
  const fromEnd = where ? where.index : tail?.index ?? masked.length;
  const fromClause = text.slice(from.index + from.length, fromEnd);

  const ident = '([A-Za-z_][\\w$]*(?:\\.[A-Za-z_][\\w$]*)*)';
  const stop = /^(?:ON|USING|WHERE|LEFT|RIGHT|INNER|OUTER|FULL|CROSS|NATURAL|JOIN|GROUP|ORDER|LIMIT|OFFSET|HAVING|UNION|AND|OR|SET)$/i;
  const tableAt = (clause: string): { name: string; alias: string } | null => {
    const hit = new RegExp(`^\\s*${ident}(?:\\s+(?:AS\\s+)?([A-Za-z_][\\w$]*))?`, 'i').exec(clause);
    if (!hit) return null;
    return { name: hit[1]!, alias: hit[2] && !stop.test(hit[2]) ? hit[2] : '' };
  };
  const first = tableAt(fromClause);
  if (!first) return null; // FROM (subquery) and similar shapes are not drawn
  const main: SqlTable = { ...first, kind: 'from', columns: [] };
  const joins: SqlTable[] = [];
  for (const hit of fromClause.matchAll(/\bJOIN\s+/gi)) {
    const table = tableAt(fromClause.slice(hit.index + hit[0].length));
    if (table) joins.push({ ...table, kind: 'join', columns: [] });
  }
  const mainAlias = main.alias || shortName(main.name);

  const filters: SqlFilter[] = [];
  if (where) {
    const whereEnd = tail?.index ?? masked.length;
    for (const piece of splitKeyword(text.slice(where.index + where.length, whereEnd), 'AND')) {
      const pieceMask = mask(piece);
      const params = unique([...pieceMask.matchAll(/(?<![:\w]):([A-Za-z_]\w*)/g)].map((hit) => hit[1]!));
      const subqueries: SqlTable[] = [];
      for (const hit of pieceMask.matchAll(/\b(?:FROM|JOIN)\s+/gi)) {
        const table = tableAt(piece.slice(hit.index + hit[0].length));
        if (!table) continue;
        const before = pieceMask.slice(0, hit.index);
        const lead = [...before.matchAll(/\b(NOT\s+EXISTS|EXISTS|IN)\s*\(\s*SELECT\b/gi)].pop()?.[1]?.toUpperCase().replace(/\s+/g, ' ');
        const alias = table.alias || shortName(table.name);
        const columns = unique([
          ...[...piece.matchAll(new RegExp(`\\b${escapeRe(alias)}\\.(\\w+)\\s*=\\s*${escapeRe(mainAlias)}\\.\\w+`, 'gi'))].map((m) => m[1]!),
          ...[...piece.matchAll(new RegExp(`\\b${escapeRe(mainAlias)}\\.\\w+\\s*=\\s*${escapeRe(alias)}\\.(\\w+)`, 'gi'))].map((m) => m[1]!),
          ...[...piece.matchAll(new RegExp(`\\b${escapeRe(alias)}\\.(\\w+)\\s*=\\s*(?:CAST\\s*\\(\\s*)?:\\w+`, 'gi'))].map((m) => m[1]!),
        ]);
        subqueries.push({ ...table, kind: lead === 'NOT EXISTS' ? 'not exists' : lead === 'IN' ? 'in subquery' : 'exists', columns });
      }
      filters.push({ text: piece, params, alternatives: splitKeyword(unwrap(piece), 'OR').length, subqueries });
    }
  }

  const params: SqlParam[] = unique([...masked.matchAll(/(?<![:\w]):([A-Za-z_]\w*)/g)].map((hit) => hit[1]!)).map((name) => ({
    name,
    type: new RegExp(`CAST\\s*\\(\\s*:${name}\\s+AS\\s+(\\w+)`, 'i').exec(masked)?.[1]?.toUpperCase() ?? '',
    optional: new RegExp(`(?:CAST\\s*\\(\\s*:${name}\\s+AS\\s+\\w+\\s*\\)|:${name})\\s+IS\\s+NULL\\b|:${name}\\s*=\\s*(?:TRUE|FALSE)\\s+OR\\b`, 'i').test(masked),
    list: new RegExp(`\\bIN\\s*\\(\\s*:${name}\\s*\\)`, 'i').test(masked),
  }));

  const order = top('\\bORDER\\s+BY\\b');
  const orderEnd = order && (top('\\b(?:LIMIT|OFFSET|FETCH|FOR\\s+UPDATE)\\b', order.index)?.index ?? masked.length);
  const limit = top('\\b(?:LIMIT|FETCH)\\b');
  return {
    text,
    select: squash(text.slice(select.index + select.length, from.index)),
    main,
    joins,
    filters,
    params,
    orderBy: order && orderEnd !== null ? squash(text.slice(order.index + order.length, orderEnd)) : '',
    limit: limit ? squash(text.slice(limit.index, limit.index + 60)).split(/\s+(?=OFFSET)/i)[0]! : '',
  };
}

/** Data flow of the query: parameters and subquery tables feed the filters; rows that pass are sorted and returned. */
export function sqlFlowDiagram(query: SqlQuery, language: string): Diagram {
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  const paramIds = new Map<string, string>();
  for (const param of query.params) {
    const id = `sql:param:${param.name}`;
    paramIds.set(param.name, id);
    nodes.push({
      id, kind: 'param', tag: 'parameter', label: `:${param.name}`,
      detail: `Bound parameter :${param.name}${param.type ? `, cast to ${param.type}` : ''}${param.list ? ', a list of values' : ''}. The caller supplies it at run time.${param.optional ? ' A null value switches its filter off.' : ''}`,
    });
  }
  const filterIds: string[] = [];
  const inputEdges: DiagramEdge[] = [];
  const usedParams = new Set<string>();
  query.filters.forEach((filter, index) => {
    const id = `sql:filter:${index}`;
    filterIds.push(id);
    const label = filter.params.length ? `Filter on ${filter.params.map((name) => `:${name}`).join(', ')}`
      : clip(squash(filter.text), 56);
    nodes.push({
      id, kind: 'call', tag: 'filter', layer: 'core', label,
      detail: `${clip(squash(filter.text), 420)}${filter.alternatives > 1 ? ` — ${filter.alternatives} alternatives joined by OR; the row is kept if any one is true.` : ''}`,
    });
    for (const name of filter.params) {
      usedParams.add(name);
      inputEdges.push({ from: paramIds.get(name)!, to: id });
    }
    filter.subqueries.forEach((table, position) => {
      const tableId = `sql:sub:${index}:${position}`;
      nodes.push({
        id: tableId, kind: 'import', tag: table.kind, layer: 'calls', label: shortName(table.name),
        detail: `${table.kind} subquery on ${table.name}${table.alias ? ` (${table.alias})` : ''}.${table.columns.length ? ` Matches on ${table.columns.join(', ')}.` : ''} It only asks whether a matching row exists; it does not return that row's data.`,
      });
      inputEdges.push({ from: tableId, to: id, label: table.kind === 'not exists' ? 'none' : undefined });
    });
  });
  const tableId = 'sql:table';
  nodes.push({
    id: tableId, kind: 'method', tag: 'table', label: `${shortName(query.main.name)}${query.main.alias ? ` ${query.main.alias}` : ''}`,
    detail: `FROM ${query.main.name}${query.main.alias ? ` ${query.main.alias}` : ''}. ${query.filters.length ? `A row is kept only if it passes all ${query.filters.length} filter${query.filters.length === 1 ? '' : 's'}.` : 'There is no WHERE clause, so every row is kept.'}`,
  });
  const joinEdges: DiagramEdge[] = [];
  query.joins.forEach((table, index) => {
    const id = `sql:join:${index}`;
    nodes.push({ id, kind: 'import', tag: 'join', layer: 'imports', label: shortName(table.name), detail: `JOIN ${table.name}${table.alias ? ` ${table.alias}` : ''}: its columns are combined with ${query.main.name} before the filters run.` });
    joinEdges.push({ from: id, to: tableId, label: 'JOIN' });
  });
  edges.push(...inputEdges, ...joinEdges);
  // Filters with inputs first, so the table sits one level after them.
  const ordered = [...filterIds].sort((a, b) => Number(inputEdges.some((edge) => edge.to === b)) - Number(inputEdges.some((edge) => edge.to === a)));
  for (const id of ordered) edges.push({ from: id, to: tableId });
  for (const param of query.params) if (!usedParams.has(param.name)) edges.push({ from: paramIds.get(param.name)!, to: tableId });
  let last = tableId;
  if (query.orderBy) {
    nodes.push({ id: 'sql:order', kind: 'call', tag: 'order by', layer: 'core', label: clip(query.orderBy, 64), detail: `Sorts the rows that passed every filter: ORDER BY ${query.orderBy}.` });
    edges.push({ from: last, to: 'sql:order' });
    last = 'sql:order';
  }
  nodes.push({
    id: 'sql:result', kind: 'return', tag: 'result', label: clip(query.select || 'rows', 56),
    detail: `Returned: ${query.select || 'the selected columns'}. ${query.limit ? query.limit : 'No LIMIT appears in this text.'}`,
  });
  edges.push({ from: last, to: 'sql:result' });
  return {
    nodes, edges, language,
    caption: `Data flow of this query, read from its text: bound parameters${query.filters.some((filter) => filter.subqueries.length) ? ' and EXISTS subqueries' : ''} feed the filters; rows of ${query.main.name} must pass them${query.orderBy ? ', are sorted' : ''} and are returned. This is not an execution plan.`,
  };
}

export interface CostFactor {
  title: string;
  tag: string;
  tone: 'good' | 'watch' | 'risk';
  snippet: string;
  body: string;
}

const TONE_RANK = { risk: 0, watch: 1, good: 2 } as const;

/** Performance choices that are visible in the query text. Observations to check with EXPLAIN, never measurements. */
export function sqlCostFactors(query: SqlQuery): CostFactor[] {
  const factors: CostFactor[] = [];
  const text = squash(query.text);
  const optional = query.params.filter((param) => param.optional);
  if (optional.length) {
    const filter = query.filters.find((item) => item.params.some((name) => optional.some((param) => param.name === name)));
    factors.push({
      title: 'Optional filters share one plan', tag: 'check the plan', tone: 'watch',
      snippet: filter ? clip(squash(filter.text), 100) : '',
      body: `${optional.map((param) => `:${param.name}`).join(', ')} switch${optional.length === 1 ? 'es' : ''} their filter off when null, so one statement serves every combination of filters. The database often reuses one plan for all combinations, so a filter that is selective for some callers may not use its index.`,
    });
  }
  const likes = [...text.matchAll(/((?:LOWER|UPPER)\s*\((?:[^()]|\([^()]*\))*\)|[\w.]+)\s+I?LIKE\s+('%|\(?\s*'%')/gi)];
  if (likes.length) {
    const columns = unique(likes.map((hit) => hit[1]!));
    const wrapped = columns.some((column) => /^(?:LOWER|UPPER)/i.test(column));
    factors.push({
      title: 'Search with a leading %', tag: 'scans rows', tone: 'risk', snippet: clip(likes[0]![0]!, 100),
      body: `${likes.length} LIKE condition${likes.length === 1 ? '' : 's'} on ${columns.join(', ')} start${likes.length === 1 ? 's' : ''} with %. A leading % cannot use an ordinary B-tree index, so the database checks rows one by one${likes.length > 1 ? ', and because the conditions are joined by OR a row may be tested against all of them' : ''}.${wrapped ? ' Wrapping the column in LOWER() also needs an expression index for any index to apply.' : ''} If this is PostgreSQL, a trigram index (pg_trgm) is the usual remedy when search is slow.`,
    });
  }
  const casts = unique([...text.matchAll(/CAST\s*\(\s*([A-Za-z_]\w*\.[A-Za-z_]\w*)\s+AS\s+(\w+)\s*\)/gi)].map((hit) => hit[0]));
  if (casts.length) {
    factors.push({
      title: 'Casting a column', tag: 'blocks index', tone: 'risk', snippet: clip(casts[0]!, 100),
      body: `${casts.join(', ')} converts the column for every row, so an ordinary index on that column cannot be used for the comparison it sits in. Cast the parameter to the column's type instead where you can.`,
    });
  }
  const subqueries = query.filters.flatMap((filter) => filter.subqueries);
  if (subqueries.length) {
    const wanted = unique(subqueries.map((table) => `${table.name}(${table.columns.join(', ') || '…'})`));
    factors.push({
      title: 'EXISTS per candidate row', tag: 'needs an index', tone: 'watch',
      snippet: clip(squash(query.filters.find((filter) => filter.subqueries.length)!.text), 100),
      body: `${subqueries.length} subquer${subqueries.length === 1 ? 'y asks' : 'ies ask'} about one partner row at a time. Planners usually turn this into a semi-join, which is cheap when the child table has an index on the matching columns. Look for indexes on: ${wanted.join('; ')}.`,
    });
  }
  const wide = query.filters.find((filter) => filter.alternatives >= 3);
  if (wide) {
    factors.push({
      title: `${wide.alternatives} OR alternatives${wide.params.length ? ` on ${wide.params.map((name) => `:${name}`).join(', ')}` : ''}`, tag: 'harder to plan', tone: 'watch',
      snippet: clip(squash(wide.text), 100),
      body: `Only one alternative is usually true for a given value, but the planner does not know that and plans for all ${wide.alternatives}. It reads clearly and is easy to test; if it is slow, one query per case is the alternative to compare.`,
    });
  }
  const listed = query.params.filter((param) => param.list);
  if (listed.length) {
    factors.push({
      title: `IN (:${listed[0]!.name}) list`, tag: 'size matters', tone: 'watch', snippet: `IN (:${listed[0]!.name})`,
      body: `The statement carries one value for every element of :${listed[0]!.name}. A handful is fine; thousands make the statement and its plan larger, and drivers cap the number of parameters per query.`,
    });
  }
  const sortKey = query.orderBy.split(',')[0]?.trim() ?? '';
  if (sortKey && /\w\s*\(/.test(sortKey)) {
    const expression = sortKey.replace(/\s+(?:ASC|DESC)$/i, '');
    factors.push({
      title: `Sorting on ${expression}`, tag: 'may sort everything', tone: 'watch', snippet: `ORDER BY ${clip(query.orderBy, 90)}`,
      body: `A plain index on the column cannot deliver rows in ${expression} order, so the database may sort every matching row. An index on that expression would match this ORDER BY.`,
    });
  } else if (sortKey) {
    factors.push({
      title: 'Sorting on plain columns', tag: 'usually fine', tone: 'good', snippet: `ORDER BY ${clip(query.orderBy, 90)}`,
      body: `An index on ${query.orderBy.replace(/\s+(?:ASC|DESC)\b/gi, '')} can return rows already in order, so the sort may cost nothing.`,
    });
  }
  if (!query.limit) {
    factors.push({
      title: 'No LIMIT in this text', tag: 'unbounded', tone: 'watch', snippet: '',
      body: `Every matching row of ${query.main.name} is${query.orderBy ? ' sorted and' : ''} returned. If the caller does not paginate, cost grows with the number of rows.`,
    });
  }
  if (/(^|,)\s*(?:\w+\.)?\*/.test(query.select)) {
    factors.push({
      title: `SELECT ${query.select}`, tag: 'usually fine', tone: 'good', snippet: '',
      body: `Returns every column of ${query.main.name}. Wider rows cost more to sort and send: fine if the caller uses most columns, wasteful if it needs two or three.`,
    });
  }
  factors.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]);
  return factors;
}

/** The Performance view for SQL: one card per choice found in this query, riskiest first, never a measurement. */
export function sqlCostDiagram(query: SqlQuery, language: string): Diagram {
  const factors = sqlCostFactors(query).slice(0, 7);
  const nodes: DiagramNode[] = factors.map((factor, index) => ({
    id: `sql:cost:${index}`, kind: 'method', label: factor.title, tag: factor.tag, tone: factor.tone, snippet: factor.snippet, detail: factor.body,
  }));
  nodes.push({
    id: 'sql:cost:next', kind: 'method', label: 'Check before changing anything', tag: 'next step', tone: 'good', snippet: '',
    detail: 'Run EXPLAIN (ANALYZE) on realistic data for the common filter combinations. Look for sequential scans and sorts on the largest tables, then change one thing at a time.',
  });
  return {
    nodes, edges: [], language,
    caption: 'Performance choices found in this query\'s text, riskiest first. These are observations to check with a query plan, not measurements.',
  };
}
