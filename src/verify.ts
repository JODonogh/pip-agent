import type { CodeContext } from './types';
import type { Diagrams } from './diagram';

/** Deterministic "ways to prod it" derived from the selection — no LLM, no side effects. */
export interface VerifyInfo {
  http: { method: string; path: string } | null;
  sqlHint: string | null;
  endpointLabel: string | null;
}

export function deriveVerify(ctx: CodeContext, diagrams: Diagrams): VerifyInfo {
  const endpoint = diagrams.dataFlow.nodes.find((n) => n.kind === 'endpoint');
  let http: VerifyInfo['http'] = null;
  let endpointLabel: string | null = null;
  if (endpoint) {
    const [method, ...rest] = endpoint.label.split(' ');
    http = { method: (method ?? 'GET').toUpperCase(), path: rest.join(' ') || '/' };
    endpointLabel = endpoint.label;
  }

  // Repository-style calls → a read-only query you could run in DBeaver to see the same data.
  let sqlHint: string | null = null;
  const findAll = /\.(\w+)\.findAll\(/.exec(ctx.selection) ?? /findAll\(/.exec(ctx.selection);
  if (/findAll\(/.test(ctx.selection)) {
    sqlHint =
      'In DBeaver you would see the same rows with: SELECT * FROM <table>; — findAll() loads the whole table, ' +
      'which is exactly why it gets slow as data grows.';
  } else if (/\.findBy(\w+)\(/.test(ctx.selection)) {
    const field = /\.findBy(\w+)\(/.exec(ctx.selection)?.[1] ?? 'field';
    sqlHint = `Derived query idea: SELECT * FROM <table> WHERE ${field.replace(/([A-Z])/g, '_$1').toLowerCase()} = ?; — Spring turns findBy${field} into that WHERE clause.`;
  } else if (findAll) {
    sqlHint = 'SELECT * FROM <table>;';
  }
  return { http, sqlHint, endpointLabel };
}
