import type { CodeContext } from '../shared/types';
import type { Diagrams } from './diagram';

/** Deterministic "ways to prod it" derived from the selection — no LLM, no side effects. */
export interface VerifyInfo {
  http: { method: string; path: string } | null;
  sqlHint: string | null;
  endpointLabel: string | null;
  debugHint: string | null;
  /** One-line nudge shown under Learn answers and Solve replies. */
  engagementLine: string;
}

function sqlFragment(selection: string): string {
  const oneLine = selection.replace(/\s+/g, ' ').trim();
  const like = /\bLIKE\b[\s\S]{0,200}/i.exec(oneLine)?.[0];
  if (like) return like.slice(0, 160);
  const select = /\bSELECT\b[\s\S]{0,240}/i.exec(oneLine)?.[0];
  if (select) return select.slice(0, 160);
  return oneLine.slice(0, 120);
}

function httpFromSource(selection: string): VerifyInfo['http'] {
  const mapping =
    /@(?:Get|Post|Put|Delete|Patch)Mapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/i.exec(selection) ??
    /@RequestMapping\s*\([^)]*["']([^"']+)["']/i.exec(selection) ??
    /fetch\s*\(\s*["']([^"']+)["']/i.exec(selection);
  if (!mapping) return null;
  const path = mapping[1]!;
  const methodMatch = /@(Get|Post|Put|Delete|Patch)Mapping/i.exec(selection);
  const method = methodMatch ? methodMatch[1]!.toUpperCase() : selection.includes('fetch') ? 'GET' : 'GET';
  return { method, path };
}

function debugFromContext(ctx: CodeContext): string | null {
  if (/\bSELECT\b[\s\S]*\bFROM\b/i.test(ctx.selection)) return null;
  const symbol = /(\w+)\s*\([^)]*\)\s*\{/.exec(ctx.selection)?.[1] ??
    /(\w+)\s*\(/.exec(ctx.selection)?.[1];
  const inspect = symbol
    ? `inspect \`${symbol}\` arguments and return value`
    : 'inspect locals at this line before the next step runs';
  return `Breakpoint at ${ctx.file}:${ctx.line} — ${inspect}.`;
}

function engagementLine(info: Pick<VerifyInfo, 'http' | 'sqlHint' | 'debugHint'>): string {
  if (info.sqlHint) return info.sqlHint.replace(/^DB \(DBeaver\):\s*/i, 'In DBeaver, ');
  if (info.http) {
    return `In Bruno, send ${info.http.method} http://localhost:8081${info.http.path.startsWith('/') ? '' : '/'}${info.http.path} and compare the response to what this code expects.`;
  }
  if (info.debugHint) return info.debugHint;
  return 'Set a breakpoint on this line and step once — note which value differs from what you expected.';
}

export function deriveVerify(ctx: CodeContext, diagrams: Diagrams): VerifyInfo {
  const endpoint = diagrams.dataFlow.nodes.find((n) => n.kind === 'endpoint');
  let http: VerifyInfo['http'] = httpFromSource(ctx.selection);
  let endpointLabel: string | null = null;
  if (endpoint) {
    const [method, ...rest] = endpoint.label.split(' ');
    http = http ?? { method: (method ?? 'GET').toUpperCase(), path: rest.join(' ') || '/' };
    endpointLabel = endpoint.label;
  }

  let sqlHint: string | null = null;
  if (/\bSELECT\b[\s\S]*\bFROM\b|\bLIKE\b|\bEXISTS\b|\bWHERE\b/i.test(ctx.selection)) {
    const fragment = sqlFragment(ctx.selection);
    sqlHint =
      `DB (DBeaver): run a read-only check with this fragment (bind :params yourself): ${fragment}`;
  } else if (/findAll\(/.test(ctx.selection)) {
    sqlHint =
      'In DBeaver you would see the same rows with: SELECT * FROM <table>; — findAll() loads the whole table, ' +
      'which is exactly why it gets slow as data grows.';
  } else if (/\.findBy(\w+)\(/.test(ctx.selection)) {
    const field = /\.findBy(\w+)\(/.exec(ctx.selection)?.[1] ?? 'field';
    sqlHint = `Derived query idea: SELECT * FROM <table> WHERE ${field.replace(/([A-Z])/g, '_$1').toLowerCase()} = ?; — Spring turns findBy${field} into that WHERE clause.`;
  }

  const debugHint = debugFromContext(ctx);
  const partial = { http, sqlHint, debugHint, endpointLabel };
  return { ...partial, engagementLine: engagementLine(partial) };
}

/** Engagement hints work even when diagrams were not generated (large selection, text paste, chat). */
export function deriveEngagement(ctx: CodeContext, diagrams?: Diagrams | null): VerifyInfo {
  if (diagrams) return deriveVerify(ctx, diagrams);
  const http = httpFromSource(ctx.selection);
  let sqlHint: string | null = null;
  if (/\bSELECT\b[\s\S]*\bFROM\b|\bLIKE\b|\bEXISTS\b|\bWHERE\b/i.test(ctx.selection)) {
    sqlHint =
      `DB (DBeaver): run a read-only check with this fragment (bind :params yourself): ${sqlFragment(ctx.selection)}`;
  }
  const debugHint = debugFromContext(ctx);
  const partial = { http, sqlHint, endpointLabel: http ? `${http.method} ${http.path}` : null, debugHint };
  return { ...partial, engagementLine: engagementLine(partial) };
}
