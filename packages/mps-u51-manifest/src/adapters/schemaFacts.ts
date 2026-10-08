/**
 * Static adapter, schema / parity extraction FACTS (contract 5.5, 12.2 `u51-schema-derivation-1`).
 *
 * Pure text in, facts out. It reads no database, runs no Prisma, and neither validates nor approves anything: the
 * `prisma validate` run (controller-owned config, hermetic environment) and the migration approval are separate
 * adapter work that waits on owner decisions (contract 14, steps 11). These are the parts that need no provider
 * decision: which tables the Prisma schema maps, which vector columns and dimensions each migration table has, which
 * CHECK constraints pin a dimension or a (model, revision, pipeline) triple, and which embedding tables and vector
 * casts the non-test runtime SQL touches.
 *
 * Honest limits: this is a conservative TEXT extractor, not a SQL or Prisma parser. A construct it does not
 * recognise yields no fact (never an invented one), so the parity check then fails closed instead of passing.
 * Names of the columns that carry the pinned (model, revision, pipeline) triple and the embedding-table family are
 * injected options: the extractor chooses neither.
 */
import { compareBytewise } from '../json';

export interface PrismaModelFact {
  readonly name: string;
  readonly mapped_table: string;
  readonly vector_columns: readonly { readonly column: string; readonly declared_dimension: number }[];
}
export interface PrismaFacts {
  readonly prisma_models: readonly PrismaModelFact[];
  /** vector columns whose type declares no dimension; reported with declared_dimension 0 so a parity check fails closed */
  readonly undeclared_dimension_columns: readonly { readonly model: string; readonly column: string }[];
}

const byBytes = <T>(xs: readonly T[], key: (x: T) => string): T[] => [...xs].sort((a, b) => compareBytewise(key(a), key(b)));

function stripPrismaComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:"'`\\])\/\/.*$/gm, '$1');
}

/** Models that have at least one vector column, with their @@map resolved table. */
export function extractPrismaFacts(schemaText: string): PrismaFacts {
  const text = stripPrismaComments(schemaText);
  const models: PrismaModelFact[] = [];
  const undeclared: { model: string; column: string }[] = [];
  const header = /^\s*model\s+([A-Za-z_]\w*)\s*\{/gm;
  for (let m = header.exec(text); m !== null; m = header.exec(text)) {
    const name = m[1]!;
    let depth = 1;
    let i = header.lastIndex;
    for (; i < text.length && depth > 0; i += 1) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') depth -= 1;
    }
    const body = text.slice(header.lastIndex, i - 1);
    const mapped = /@@map\(\s*(?:name:\s*)?"([^"]+)"\s*\)/.exec(body);
    const columns: { column: string; declared_dimension: number }[] = [];
    for (const line of body.split('\n')) {
      const field = /^\s*([A-Za-z_]\w*)\s+Unsupported\(\s*"vector(?:\((\d+)\))?"\s*\)/.exec(line);
      if (field === null) continue;
      const columnName = /@map\(\s*"([^"]+)"\s*\)/.exec(line)?.[1] ?? field[1]!;
      if (field[2] === undefined) undeclared.push({ model: name, column: columnName });
      columns.push({ column: columnName, declared_dimension: field[2] === undefined ? 0 : Number(field[2]) });
    }
    if (columns.length > 0) {
      models.push({ name, mapped_table: mapped?.[1] ?? name, vector_columns: byBytes(columns, (c) => c.column) });
    }
  }
  return { prisma_models: byBytes(models, (x) => x.name), undeclared_dimension_columns: undeclared };
}

// ------------------------------------------------------------------------------------------------ migration SQL

export interface PipelineColumns {
  readonly model_id: string;
  readonly model_revision: string;
  readonly pipeline_version: string;
}
export interface MigrationTableFact {
  readonly table: string;
  readonly vector_columns: readonly { readonly column: string; readonly dimension: number }[];
  readonly dimension_checks: readonly { readonly name: string; readonly dimension: number }[];
  readonly pipeline_binding_checks: readonly {
    readonly name: string;
    readonly triples: readonly { readonly model_id: string; readonly model_revision: string; readonly pipeline_version: string }[];
  }[];
}
export interface MigrationOptions {
  /** the columns whose equality terms form the pinned triple (injected, not chosen here) */
  readonly pipelineColumns: PipelineColumns;
  /** the column a dimension CHECK constrains */
  readonly dimensionColumn: string;
}

/** Removes `-- ...` and block comments outside single-quoted strings and double-quoted identifiers. */
export function stripSqlComments(sql: string): string {
  let out = '';
  for (let i = 0; i < sql.length; ) {
    const c = sql[i]!;
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === c) {
          if (sql[j + 1] === c) j += 2;
          else break;
        } else j += 1;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
    } else if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1;
    } else if (c === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end < 0 ? sql.length : end + 2;
      out += ' ';
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

/** Index just past the parenthesis that closes the one at `open`; -1 if unbalanced. Quotes are skipped. */
function closingParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i]!;
    if (c === "'" || c === '"') {
      const end = text.indexOf(c, i + 1);
      if (end < 0) return -1;
      i = end;
    } else if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** Split at top level (depth 0, outside quotes) by a single character. */
function splitTop(text: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (c === "'" || c === '"') {
      const end = text.indexOf(c, i + 1);
      if (end < 0) break;
      i = end;
    } else if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
    else if (c === sep && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** Split at top level by a keyword (AND / OR). */
function splitKeyword(expr: string, keyword: 'AND' | 'OR'): string[] {
  const parts: string[] = [];
  const re = new RegExp(`^\\s+${keyword}\\s+`, 'i');
  let depth = 0;
  let start = 0;
  for (let i = 0; i < expr.length; i += 1) {
    const c = expr[i]!;
    if (c === "'" || c === '"') {
      const end = expr.indexOf(c, i + 1);
      if (end < 0) break;
      i = end;
    } else if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
    else if (depth === 0 && /\s/.test(c)) {
      const m = re.exec(expr.slice(i));
      if (m !== null) {
        parts.push(expr.slice(start, i));
        start = i + m[0].length;
        i = start - 1;
      }
    }
  }
  parts.push(expr.slice(start));
  return parts.map((p) => stripOuterParens(p.trim())).filter((p) => p.length > 0);
}

function stripOuterParens(expr: string): string {
  let e = expr.trim();
  while (e.startsWith('(') && closingParen(e, 0) === e.length) e = e.slice(1, -1).trim();
  return e;
}

const identOf = (raw: string): string => raw.replace(/^"|"$/g, '').replace(/""/g, '"');

interface RawTable {
  name: string;
  vector: { column: string; dimension: number }[];
  checks: { name: string; expr: string }[];
}

function parseCheckConstraint(item: string): { name: string; expr: string } | undefined {
  const m = /^CONSTRAINT\s+("(?:[^"]|"")+"|\w+)\s+CHECK\s*\(/i.exec(item);
  if (m === null) return undefined;
  const open = item.indexOf('(', m[0].length - 1);
  const close = closingParen(item, open);
  if (close < 0) return undefined;
  return { name: identOf(m[1]!), expr: item.slice(open + 1, close - 1).trim() };
}

export function extractMigrationFacts(sqlText: string, options: MigrationOptions): MigrationTableFact[] {
  const sql = stripSqlComments(sqlText);
  const tables = new Map<string, RawTable>();

  const create = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"[^"]+"\.)?("(?:[^"]|"")+"|\w+)\s*\(/gi;
  for (let m = create.exec(sql); m !== null; m = create.exec(sql)) {
    const open = create.lastIndex - 1;
    const close = closingParen(sql, open);
    if (close < 0) continue;
    const table: RawTable = { name: identOf(m[1]!), vector: [], checks: [] };
    for (const item of splitTop(sql.slice(open + 1, close - 1), ',')) {
      const check = parseCheckConstraint(item);
      if (check !== undefined) {
        table.checks.push(check);
        continue;
      }
      const column = /^("(?:[^"]|"")+"|\w+)\s+vector\s*\(\s*(\d+)\s*\)/i.exec(item);
      if (column !== null) table.vector.push({ column: identOf(column[1]!), dimension: Number(column[2]) });
    }
    tables.set(table.name, table);
  }
  const alter = /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:"[^"]+"\.)?("(?:[^"]|"")+"|\w+)\s+ADD\s+(CONSTRAINT\s+("(?:[^"]|"")+"|\w+)\s+CHECK\s*\()/gi;
  for (let m = alter.exec(sql); m !== null; m = alter.exec(sql)) {
    const target = tables.get(identOf(m[1]!));
    if (target === undefined) continue;
    const open = alter.lastIndex - 1;
    const close = closingParen(sql, open);
    if (close >= 0) target.checks.push({ name: identOf(m[3]!), expr: sql.slice(open + 1, close - 1).trim() });
  }

  const dimensionCheck = new RegExp(`^"?${options.dimensionColumn}"?\\s*=\\s*(\\d+)$`);
  const cols = options.pipelineColumns;
  const facts: MigrationTableFact[] = [];
  for (const table of tables.values()) {
    const dimension_checks: { name: string; dimension: number }[] = [];
    const pipeline_binding_checks: { name: string; triples: { model_id: string; model_revision: string; pipeline_version: string }[] }[] = [];
    for (const check of table.checks) {
      const only = dimensionCheck.exec(stripOuterParens(check.expr));
      if (only !== null) {
        dimension_checks.push({ name: check.name, dimension: Number(only[1]) });
        continue;
      }
      const triples: { model_id: string; model_revision: string; pipeline_version: string }[] = [];
      let binding = true;
      for (const group of splitKeyword(stripOuterParens(check.expr), 'OR')) {
        const values = new Map<string, string>();
        for (const term of splitKeyword(group, 'AND')) {
          const eq = /^"?(\w+)"?\s*=\s*'((?:[^']|'')*)'$/.exec(term);
          if (eq !== null) values.set(eq[1]!, eq[2]!.replace(/''/g, "'"));
        }
        const model_id = values.get(cols.model_id);
        const model_revision = values.get(cols.model_revision);
        const pipeline_version = values.get(cols.pipeline_version);
        if (model_id === undefined || model_revision === undefined || pipeline_version === undefined) {
          binding = false;
          break;
        }
        triples.push({ model_id, model_revision, pipeline_version });
      }
      if (binding && triples.length > 0) {
        const key = (t: { model_id: string; model_revision: string; pipeline_version: string }): string => [t.model_id, t.model_revision, t.pipeline_version].join('\u0000');
        const unique = new Map(triples.map((t) => [key(t), t]));
        pipeline_binding_checks.push({ name: check.name, triples: byBytes([...unique.values()], key) });
      }
    }
    facts.push({
      table: table.name,
      vector_columns: byBytes(table.vector, (c) => c.column),
      dimension_checks: byBytes(dimension_checks, (c) => c.name),
      pipeline_binding_checks: byBytes(pipeline_binding_checks, (c) => c.name),
    });
  }
  return byBytes(facts, (t) => t.table);
}

// ------------------------------------------------------------------------------------------------ runtime SQL

export interface RuntimeSource {
  readonly path: string;
  readonly text: string;
  /** git blob sha1 of the file (the evidence names the source it read) */
  readonly blob_sha1: string;
}
export interface RuntimeOptions {
  /** every table name in non-test source matching this pattern is a reference (injected: the embedding-table family) */
  readonly embeddingTableFamily: RegExp;
  /** names of the vector columns to look for inside a statement (taken from the migration, not guessed) */
  readonly vectorColumns: readonly string[];
}
export interface RuntimeFacts {
  readonly statements: readonly {
    readonly kind: string;
    readonly table: string;
    readonly source_blob_sha1: string;
    readonly vector_columns: readonly { readonly column: string; readonly cast_dimension: number }[];
  }[];
  readonly embedding_table_references: readonly string[];
}

const LITERAL = /`(?:\\[\s\S]|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g;

/** Statements are the string / template literals of non-test source that mention an embedding table. */
export function extractRuntimeFacts(sources: Iterable<RuntimeSource>, options: RuntimeOptions): RuntimeFacts {
  const family = new RegExp(options.embeddingTableFamily.source, options.embeddingTableFamily.flags.includes('g') ? options.embeddingTableFamily.flags : `${options.embeddingTableFamily.flags}g`);
  const references = new Set<string>();
  const statements: RuntimeFacts['statements'][number][] = [];
  for (const source of sources) {
    for (const hit of source.text.matchAll(family)) references.add(hit[0]);
    for (const literal of source.text.matchAll(LITERAL)) {
      const body = literal[0];
      const tableHit = [...body.matchAll(family)][0];
      if (tableHit === undefined) continue;
      const verb = /\b(INSERT|SELECT|UPDATE|DELETE|WITH)\b/i.exec(body);
      if (verb === null) continue;
      const dimensions = [...new Set([...body.matchAll(/::\s*vector\s*\(\s*(\d+)\s*\)/gi)].map((c) => Number(c[1])))].sort((a, b) => a - b);
      const columns = options.vectorColumns.filter((c) => new RegExp(`(^|[^A-Za-z0-9_])${c}([^A-Za-z0-9_]|$)`).test(body));
      statements.push({
        kind: verb[1]!.toUpperCase(),
        table: tableHit[0],
        source_blob_sha1: source.blob_sha1,
        vector_columns: columns.flatMap((column) => dimensions.map((cast_dimension) => ({ column, cast_dimension }))),
      });
    }
  }
  return {
    statements: [...statements].sort((a, b) => compareBytewise([a.kind, a.table, a.source_blob_sha1].join('\u0000'), [b.kind, b.table, b.source_blob_sha1].join('\u0000'))),
    embedding_table_references: byBytes([...references], (r) => r),
  };
}
