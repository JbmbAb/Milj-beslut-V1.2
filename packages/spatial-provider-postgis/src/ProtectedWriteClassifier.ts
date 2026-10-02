import { classificationSpec, containsDynamic, dynamicHint } from "./ProtectedRelationSpec";
import {
  PROTECTED_RELATIONS,
  canonicalRelationText,
  classifyRelation,
  classifySchema,
  parseRelationName,
  type ProtectedRelationClass,
  type ProtectedRelationsDefinition,
  type RelationName,
} from "./ProtectedRelations";

/**
 * MIMER-PROTECTED-WRITE-CLASSIFIER-V1 -- U30F2 M1/M2 (PRES-05): what a SQL text, an ogr2ogr argument
 * vector or a command line writes, read the way PostgreSQL, GDAL and a shell read it.
 *
 * Pure: no database, no process, no file system (a psql -f file is read only through the caller's
 * `readSqlFile`). The vocabulary comes from protected-relation-classification.v1.json; the Python and
 * PowerShell bindings implement the same algorithm over the same file and are held to identical
 * verdicts by tests/unit/protectedRelationGateBindings.test.ts.
 *
 * SQL is TOKENISED, not pattern-matched: comments (nested block comments), string literals ('',
 * E'', U&'', dollar quotes), quoted identifiers ("" and U&"" with escapes), case folding of unquoted
 * names, psql meta commands and psql variables. Text inside string literals and quoted identifiers
 * that contains a trigger word is classified again as SQL (dynamic SQL: DO bodies, EXECUTE '...',
 * 'TRUNC' || 'ATE ...'); a non-constant part of a concatenation becomes the dynamic placeholder.
 * A destructive keyword whose target is not a static name is UNRESOLVED (fail-closed) when it stands
 * where a statement starts; a clean target is reported wherever it stands.
 */

export type WriteOperation =
  | "DROP"
  | "DROP_SCHEMA"
  | "TRUNCATE"
  | "DELETE"
  | "INSERT"
  | "UPDATE"
  | "MERGE"
  | "COPY_FROM"
  | "ALTER"
  | "RENAME"
  | "CREATE"
  | "CREATE_OR_REPLACE"
  | "REFRESH"
  | "ALTER_SCHEMA"
  | "RENAME_SCHEMA"
  | "IMPORT_FOREIGN_SCHEMA"
  | "RESTORE"
  | "RESTORE_SCHEMA"
  | "OGR2OGR_WRITE"
  | "SHP2PGSQL_WRITE"
  | "DROP_OWNED"
  | "DROP_DATABASE"
  | "DROP_EXTENSION"
  | "REASSIGN_OWNED"
  | "DYNAMIC_SQL"
  | "PSQL_STDIN"
  | "PSQL_FILE"
  | "PSQL_META"
  | "SEARCH_PATH"
  | "COMMAND"
  | "PARSE";

export interface WriteTarget {
  readonly operation: WriteOperation;
  readonly scope: "RELATION" | "SCHEMA";
  readonly name: RelationName;
}

export interface UnresolvedWrite {
  readonly operation: WriteOperation;
  readonly reason: string;
}

export interface WriteAnalysis {
  readonly targets: WriteTarget[];
  readonly unresolved: UnresolvedWrite[];
}

export interface ClassifierOptions {
  /** psql -f / prisma db execute --file: the SQL the file holds, or null when it cannot be read. */
  readonly readSqlFile?: (path: string) => string | null;
}

function emptyAnalysis(): { targets: WriteTarget[]; unresolved: UnresolvedWrite[] } {
  return { targets: [], unresolved: [] };
}

function merge(into: { targets: WriteTarget[]; unresolved: UnresolvedWrite[] }, from: WriteAnalysis): void {
  for (const t of from.targets) into.targets.push(t);
  for (const u of from.unresolved) into.unresolved.push(u);
}

// =============================================================================================
// SQL tokenizer
// =============================================================================================

type TokType = "WORD" | "QIDENT" | "STRING" | "PARAM" | "DYN" | "NUMBER" | "OP" | "SEMI" | "LPAREN" | "RPAREN" | "COMMA" | "DOT" | "META";

interface Tok {
  readonly t: TokType;
  /** WORD: ASCII-lower-cased; QIDENT/STRING: the decoded content; DYN: the hint; META: the command. */
  readonly v: string;
  /** No whitespace or comment between this token and the previous one. */
  readonly adj: boolean;
  /** QIDENT whose content could not be decoded (U&"" with an unknown escape or UESCAPE). */
  readonly bad: boolean;
}

const WS = " \t\n\r\f\v";

function isWs(c: string): boolean {
  return c.length === 1 && WS.includes(c);
}

function isAsciiLetter(c: string): boolean {
  return (c >= "A" && c <= "Z") || (c >= "a" && c <= "z");
}

function isDigit(c: string): boolean {
  return c >= "0" && c <= "9";
}

function isHigh(c: string): boolean {
  return c.length > 0 && c.charCodeAt(0) >= 0x80;
}

function asciiLower(s: string): string {
  let out = "";
  for (const c of s) out += c >= "A" && c <= "Z" ? String.fromCharCode(c.charCodeAt(0) + 32) : c;
  return out;
}

interface Tokenized {
  readonly tokens: Tok[];
  readonly error: string | null;
}

/** Read a quoted run starting at s[i] (the opening quote). Returns [content, endIndex] or null. */
function readQuoted(s: string, i: number, quote: string, backslash: boolean): [string, number] | null {
  let j = i + 1;
  let value = "";
  while (j < s.length) {
    const c = s[j]!;
    if (backslash && c === "\\") {
      if (j + 1 >= s.length) return null;
      value += s[j + 1]!;
      j += 2;
      continue;
    }
    if (c === quote) {
      if (s[j + 1] === quote) {
        value += quote;
        j += 2;
        continue;
      }
      return [value, j + 1];
    }
    value += c;
    j += 1;
  }
  return null;
}

function isHex(s: string): boolean {
  if (s.length === 0) return false;
  for (const c of s) if (!(isDigit(c) || (c >= "a" && c <= "f") || (c >= "A" && c <= "F"))) return false;
  return true;
}

/** U&'...' / U&"..." escapes with the default escape character; null on anything else. */
function decodeUnicodeEscapes(v: string): string | null {
  let out = "";
  let j = 0;
  while (j < v.length) {
    const c = v[j]!;
    if (c !== "\\") {
      out += c;
      j += 1;
      continue;
    }
    if (v[j + 1] === "\\") {
      out += "\\";
      j += 2;
      continue;
    }
    if (v[j + 1] === "+" && isHex(v.slice(j + 2, j + 8)) && v.slice(j + 2, j + 8).length === 6) {
      const cp = parseInt(v.slice(j + 2, j + 8), 16);
      if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return null;
      out += String.fromCodePoint(cp);
      j += 8;
      continue;
    }
    if (v.slice(j + 1, j + 5).length === 4 && isHex(v.slice(j + 1, j + 5))) {
      const cp = parseInt(v.slice(j + 1, j + 5), 16);
      if (cp >= 0xd800 && cp <= 0xdfff) return null;
      out += String.fromCodePoint(cp);
      j += 5;
      continue;
    }
    return null;
  }
  return out;
}

function followedByUescape(s: string, i: number): boolean {
  let j = i;
  while (j < s.length && isWs(s[j]!)) j += 1;
  return asciiLower(s.slice(j, j + 7)) === "uescape" && !(isAsciiLetter(s[j + 7] ?? "") || isDigit(s[j + 7] ?? "") || s[j + 7] === "_");
}

export function tokenizeSql(s: string): Tokenized {
  const spec = classificationSpec();
  const open = spec.dynamic_placeholder_open;
  const close = spec.dynamic_placeholder_close;
  const tokens: Tok[] = [];
  let i = 0;
  let lastEnd = -1;
  let copyLine = false;
  const push = (t: TokType, v: string, start: number, end: number, bad = false) => {
    tokens.push({ t, v, adj: start === lastEnd, bad });
    lastEnd = end;
  };
  const isIdentStart = (k: number) => {
    const c = s[k] ?? "";
    return (isAsciiLetter(c) || c === "_" || isHigh(c)) && !s.startsWith(open, k) && !s.startsWith(close, k);
  };
  const isIdentChar = (k: number) => {
    const c = s[k] ?? "";
    return (isAsciiLetter(c) || isDigit(c) || c === "_" || c === "$" || isHigh(c)) && !s.startsWith(open, k) && !s.startsWith(close, k);
  };

  while (i < s.length) {
    const c = s[i]!;
    if (isWs(c)) {
      if (c === "\n" && copyLine) {
        push("SEMI", ";", i, i + 1);
        copyLine = false;
      }
      i += 1;
      continue;
    }
    if (s.startsWith(open, i)) {
      const end = s.indexOf(close, i + open.length);
      if (end < 0) return { tokens, error: "unterminated dynamic placeholder" };
      const inner = s.slice(i + open.length, end);
      push("DYN", inner.startsWith(":") ? inner.slice(1) : "", i, end + close.length);
      i = end + close.length;
      continue;
    }
    if (c === "-" && s[i + 1] === "-") {
      const nl = s.indexOf("\n", i);
      i = nl < 0 ? s.length : nl;
      continue;
    }
    if (c === "/" && s[i + 1] === "*") {
      let depth = 1;
      let j = i + 2;
      while (j < s.length && depth > 0) {
        if (s[j] === "/" && s[j + 1] === "*") {
          depth += 1;
          j += 2;
        } else if (s[j] === "*" && s[j + 1] === "/") {
          depth -= 1;
          j += 2;
        } else j += 1;
      }
      if (depth > 0) return { tokens, error: "unterminated block comment" };
      i = j;
      continue;
    }
    if ((c === "u" || c === "U") && s[i + 1] === "&" && (s[i + 2] === "'" || s[i + 2] === '"')) {
      const q = s[i + 2]!;
      const r = readQuoted(s, i + 2, q, false);
      if (!r) return { tokens, error: q === "'" ? "unterminated string" : "unterminated quoted identifier" };
      const decoded = decodeUnicodeEscapes(r[0]);
      if (q === "'") push("STRING", decoded ?? r[0], i, r[1]);
      else push("QIDENT", decoded ?? r[0], i, r[1], decoded === null || followedByUescape(s, r[1]) || r[0].length === 0);
      i = r[1];
      continue;
    }
    if ((c === "e" || c === "E") && s[i + 1] === "'") {
      const r = readQuoted(s, i + 1, "'", true);
      if (!r) return { tokens, error: "unterminated string" };
      push("STRING", r[0], i, r[1]);
      i = r[1];
      continue;
    }
    if ((c === "b" || c === "B" || c === "x" || c === "X" || c === "n" || c === "N") && s[i + 1] === "'") {
      const r = readQuoted(s, i + 1, "'", false);
      if (!r) return { tokens, error: "unterminated string" };
      push("STRING", r[0], i, r[1]);
      i = r[1];
      continue;
    }
    if (c === "'") {
      const r = readQuoted(s, i, "'", false);
      if (!r) return { tokens, error: "unterminated string" };
      push("STRING", r[0], i, r[1]);
      i = r[1];
      continue;
    }
    if (c === '"') {
      const r = readQuoted(s, i, '"', false);
      if (!r) return { tokens, error: "unterminated quoted identifier" };
      push("QIDENT", r[0], i, r[1], r[0].length === 0);
      i = r[1];
      continue;
    }
    if (c === "$") {
      if (isDigit(s[i + 1] ?? "")) {
        let j = i + 1;
        while (j < s.length && isDigit(s[j]!)) j += 1;
        push("PARAM", s.slice(i, j), i, j);
        i = j;
        continue;
      }
      let j = i + 1;
      if (isIdentStart(j)) {
        j += 1;
        while (j < s.length && isIdentChar(j) && s[j] !== "$") j += 1;
      }
      if (s[j] === "$") {
        const tag = s.slice(i, j + 1);
        const end = s.indexOf(tag, j + 1);
        if (end < 0) return { tokens, error: "unterminated dollar-quoted string" };
        push("STRING", s.slice(j + 1, end), i, end + tag.length);
        i = end + tag.length;
        continue;
      }
      push("OP", "$", i, i + 1);
      i += 1;
      continue;
    }
    if (c === ":" && s[i + 1] !== ":" && s[i - 1] !== ":" && (isIdentStart(i + 1) || s[i + 1] === "'" || s[i + 1] === '"')) {
      let j = i + 1;
      let hint: string;
      if (s[j] === "'" || s[j] === '"') {
        const r = readQuoted(s, j, s[j]!, false);
        if (!r) return { tokens, error: "unterminated psql variable" };
        hint = r[0];
        j = r[1];
      } else {
        const start = j;
        while (j < s.length && isIdentChar(j)) j += 1;
        hint = s.slice(start, j);
      }
      push("DYN", hint, i, j);
      i = j;
      continue;
    }
    if (isIdentStart(i)) {
      let j = i + 1;
      while (j < s.length && isIdentChar(j)) j += 1;
      push("WORD", asciiLower(s.slice(i, j)), i, j);
      i = j;
      continue;
    }
    if (isDigit(c)) {
      let j = i + 1;
      while (j < s.length && (isDigit(s[j]!) || isAsciiLetter(s[j]!) || s[j] === "_" || (s[j] === "." && isDigit(s[j + 1] ?? "")))) j += 1;
      push("NUMBER", s.slice(i, j), i, j);
      i = j;
      continue;
    }
    if (c === "\\") {
      let j = i + 1;
      if (s[j] === "!") j += 1;
      else while (j < s.length && isAsciiLetter(s[j]!)) j += 1;
      const name = asciiLower(s.slice(i + 1, j));
      if (name.length === 0) {
        push("OP", "\\", i, i + 1);
        i += 1;
        continue;
      }
      if (spec.sql.psql_meta_copy.includes(name)) {
        push("WORD", "copy", i, j);
        copyLine = true;
        i = j;
        continue;
      }
      if (spec.sql.psql_meta_unresolvable.includes(name)) push("META", name, i, j);
      const nl = s.indexOf("\n", j);
      i = nl < 0 ? s.length : nl;
      continue;
    }
    if (c === ";") push("SEMI", ";", i, i + 1);
    else if (c === "(") push("LPAREN", "(", i, i + 1);
    else if (c === ")") push("RPAREN", ")", i, i + 1);
    else if (c === ",") push("COMMA", ",", i, i + 1);
    else if (c === ".") push("DOT", ".", i, i + 1);
    else if (c === "|" && s[i + 1] === "|") {
      push("OP", "||", i, i + 2);
      i += 2;
      continue;
    } else if (c === ":" && s[i + 1] === ":") {
      push("OP", "::", i, i + 2);
      i += 2;
      continue;
    } else push("OP", c, i, i + 1);
    i += 1;
  }
  return { tokens, error: null };
}

// =============================================================================================
// SQL analysis
// =============================================================================================

interface SqlState {
  /** null: the session default (unknown, judged by the unqualified-name rule); "UNKNOWN": set dynamically. */
  searchPath: readonly string[] | "UNKNOWN" | null;
}

function containsTriggerWord(text: string): boolean {
  const lower = asciiLower(text);
  for (const w of classificationSpec().sql.trigger_words) {
    let from = 0;
    for (;;) {
      const at = lower.indexOf(w, from);
      if (at < 0) break;
      const before = at === 0 ? "" : lower[at - 1]!;
      const after = lower[at + w.length] ?? "";
      const boundary = (ch: string) => ch === "" || !(isAsciiLetter(ch) || isDigit(ch) || ch === "_");
      if (boundary(before) && boundary(after)) return true;
      from = at + 1;
    }
  }
  return false;
}

function matchParen(toks: readonly Tok[], i: number): number {
  let depth = 0;
  for (let j = i; j < toks.length; j += 1) {
    if (toks[j]!.t === "LPAREN") depth += 1;
    else if (toks[j]!.t === "RPAREN") {
      depth -= 1;
      if (depth === 0) return j;
    }
  }
  return toks.length - 1;
}

/** Exclusive end of one operand of a `||` chain starting at i. */
function pieceEnd(toks: readonly Tok[], i: number): number {
  const t = toks[i];
  if (!t) return i;
  let j: number;
  if (t.t === "LPAREN") j = matchParen(toks, i) + 1;
  else if (t.t === "WORD" || t.t === "QIDENT") {
    j = i + 1;
    while (toks[j]?.t === "DOT" && (toks[j + 1]?.t === "WORD" || toks[j + 1]?.t === "QIDENT")) j += 2;
    if (toks[j]?.t === "LPAREN") j = matchParen(toks, j) + 1;
  } else j = i + 1;
  while (toks[j]?.t === "OP" && toks[j]!.v === "::" && toks[j + 1]?.t === "WORD") j += 2;
  return j;
}

/** The texts inside literals that may hold SQL: folded `||` chains, other strings, quoted identifiers. */
function embeddedTexts(toks: readonly Tok[], dyn: string): string[] {
  const texts: string[] = [];
  const consumed = new Set<number>();
  const pieceStarts = new Set<number>();
  for (let i = 0; i < toks.length; i += 1) {
    if (pieceStarts.has(i)) continue;
    const t = toks[i]!;
    if (t.t === "OP" || t.t === "SEMI" || t.t === "COMMA" || t.t === "RPAREN" || t.t === "DOT") continue;
    const pieces: [number, number][] = [[i, pieceEnd(toks, i)]];
    let j = pieces[0]![1];
    while (toks[j]?.t === "OP" && toks[j]!.v === "||" && j + 1 < toks.length) {
      const e = pieceEnd(toks, j + 1);
      pieces.push([j + 1, e]);
      j = e;
    }
    const isString = (p: [number, number]) => toks[p[0]]!.t === "STRING" && p[1] - p[0] === 1;
    if (pieces.length > 1 && pieces.some(isString)) {
      texts.push(pieces.map((p) => (isString(p) ? toks[p[0]]!.v : dyn)).join(""));
      for (const p of pieces) {
        pieceStarts.add(p[0]);
        if (isString(p)) consumed.add(p[0]);
      }
    }
  }
  toks.forEach((t, k) => {
    if ((t.t === "STRING" && !consumed.has(k)) || t.t === "QIDENT") texts.push(t.v);
  });
  return texts.filter(containsTriggerWord);
}

function splitStatements(toks: readonly Tok[]): Tok[][] {
  const out: Tok[][] = [];
  let cur: Tok[] = [];
  for (const t of toks) {
    if (t.t === "SEMI") {
      if (cur.length) out.push(cur);
      cur = [];
    } else cur.push(t);
  }
  if (cur.length) out.push(cur);
  return out;
}

interface ParsedName {
  readonly name: RelationName | null;
  readonly end: number;
}

/** A static relation name at j (optionally ONLY ... *), or name=null when it is not one. */
function parseNameAt(toks: readonly Tok[], j: number, opts: { only?: boolean; star?: boolean } = {}): ParsedName {
  const reserved = classificationSpec().sql.reserved_at_name_position;
  let k = j;
  if (opts.only && toks[k]?.t === "WORD" && toks[k]!.v === "only") k += 1;
  const parts: string[] = [];
  for (;;) {
    const t = toks[k];
    if (!t) return { name: null, end: k };
    if (t.t === "WORD" && !reserved.includes(t.v)) parts.push(t.v);
    else if (t.t === "QIDENT" && !t.bad) parts.push(t.v);
    else return { name: null, end: k };
    k += 1;
    const n = toks[k];
    if (n && n.adj && (n.t === "WORD" || n.t === "NUMBER" || n.t === "DYN" || n.t === "PARAM" || n.t === "QIDENT" || n.t === "STRING")) {
      return { name: null, end: k };
    }
    if (toks[k]?.t === "DOT") {
      if (parts.length >= 3) return { name: null, end: k };
      k += 1;
      continue;
    }
    break;
  }
  if (opts.star && toks[k]?.t === "OP" && toks[k]!.v === "*") k += 1;
  const name = parts.length === 1 ? { schema: null, table: parts[0]! } : { schema: parts[parts.length - 2]!, table: parts[parts.length - 1]! };
  return { name, end: k };
}

function wordAt(toks: readonly Tok[], k: number, v: string): boolean {
  return toks[k]?.t === "WORD" && toks[k]!.v === v;
}

function wordsAt(toks: readonly Tok[], k: number, seq: readonly string[]): boolean {
  return seq.every((w, n) => wordAt(toks, k + n, w));
}

function matchKind(toks: readonly Tok[], k: number, kinds: readonly (readonly string[])[]): readonly string[] | null {
  let best: readonly string[] | null = null;
  for (const kind of kinds) if (wordsAt(toks, k, kind) && (!best || kind.length > best.length)) best = kind;
  return best;
}

function prevKey(toks: readonly Tok[], p: number): string | null {
  const prev = toks[p - 1];
  if (!prev) return null;
  if (prev.t === "WORD") return prev.v;
  if (prev.t === "COMMA") return ",";
  if (prev.t === "LPAREN") return "(";
  if (prev.t === "RPAREN") return ")";
  if (prev.t === "DYN") return "DYN";
  return prev.t;
}

function atStatementStart(toks: readonly Tok[], p: number): boolean {
  if (p === 0) return true;
  const key = prevKey(toks, p);
  return key !== null && classificationSpec().sql.statement_start_after.includes(key);
}

function describeAt(toks: readonly Tok[], p: number): string {
  return toks
    .slice(p, p + 6)
    .map((t) => (t.t === "DYN" ? "<dynamic>" : t.t === "STRING" ? "'…'" : t.v))
    .join(" ");
}

class SqlAnalyzer {
  readonly out = emptyAnalysis();
  private readonly spec = classificationSpec();
  private readonly state: SqlState;

  constructor(state: SqlState) {
    this.state = state;
  }

  private target(operation: WriteOperation, name: RelationName, scope: "RELATION" | "SCHEMA" = "RELATION"): void {
    this.out.targets.push({ operation, scope, name });
    if (scope === "RELATION" && name.schema === null) {
      const path = this.state.searchPath;
      if (path === "UNKNOWN") this.unresolved(operation, `unqualified ${name.table} under a search_path set from a non-constant value`);
      else if (path) for (const schema of path) this.out.targets.push({ operation, scope, name: { schema, table: name.table } });
    }
  }

  private unresolved(operation: WriteOperation, reason: string): void {
    this.out.unresolved.push({ operation, reason });
  }

  /** One name; report unresolved only where a statement starts. */
  private one(toks: readonly Tok[], p: number, j: number, op: WriteOperation, opts: { only?: boolean; star?: boolean } = {}): ParsedName {
    const r = parseNameAt(toks, j, opts);
    if (r.name) this.target(op, r.name);
    else if (atStatementStart(toks, p)) this.unresolved(op, `target is not a static relation name: ${describeAt(toks, p)}`);
    return r;
  }

  private list(toks: readonly Tok[], p: number, j: number, op: WriteOperation, opts: { only?: boolean; star?: boolean; schema?: boolean } = {}): void {
    let k = j;
    for (;;) {
      const r = parseNameAt(toks, k, opts);
      if (!r.name || (opts.schema && r.name.schema !== null)) {
        if (atStatementStart(toks, p)) this.unresolved(op, `target is not a static ${opts.schema ? "schema" : "relation"} name: ${describeAt(toks, p)}`);
        return;
      }
      if (opts.schema) this.target(op, { schema: null, table: r.name.table }, "SCHEMA");
      else this.target(op, r.name);
      k = r.end;
      if (toks[k]?.t !== "COMMA") return;
      k += 1;
    }
  }

  statement(toks: readonly Tok[]): void {
    const sql = this.spec.sql;
    for (let p = 0; p < toks.length; p += 1) {
      const t = toks[p]!;
      if (t.t === "META") {
        this.unresolved("PSQL_META", `psql \\${t.v} runs SQL the text does not contain`);
        continue;
      }
      if (t.t !== "WORD") continue;
      const prev = prevKey(toks, p);
      switch (t.v) {
        case "truncate": {
          if (prev !== null && sql.truncate_not_after.includes(prev)) break;
          this.list(toks, p, wordAt(toks, p + 1, "table") ? p + 2 : p + 1, "TRUNCATE", { only: true, star: true });
          break;
        }
        case "drop":
          this.drop(toks, p);
          break;
        case "delete":
          if (wordAt(toks, p + 1, "from")) this.one(toks, p, p + 2, "DELETE", { only: true, star: true });
          break;
        case "insert":
          if (wordAt(toks, p + 1, "into")) this.one(toks, p, p + 2, "INSERT");
          break;
        case "merge":
          if (wordAt(toks, p + 1, "into")) this.one(toks, p, p + 2, "MERGE", { only: true });
          break;
        case "update":
          this.update(toks, p, prev);
          break;
        case "copy":
          if (atStatementStart(toks, p)) this.copy(toks, p);
          break;
        case "alter":
          this.alter(toks, p);
          break;
        case "create":
          this.create(toks, p);
          break;
        case "refresh":
          if (wordsAt(toks, p + 1, ["materialized", "view"])) {
            this.one(toks, p, wordAt(toks, p + 3, "concurrently") ? p + 4 : p + 3, "REFRESH");
          }
          break;
        case "reassign":
          if (wordAt(toks, p + 1, "owned") && atStatementStart(toks, p)) this.unresolved("REASSIGN_OWNED", "REASSIGN OWNED changes every object a role owns");
          break;
        case "import":
          if (wordsAt(toks, p + 1, ["foreign", "schema"])) {
            const into = toks.findIndex((x, k) => k > p && x.t === "WORD" && x.v === "into");
            const r = into < 0 ? { name: null } : parseNameAt(toks, into + 1);
            if (r.name && r.name.schema === null) this.target("IMPORT_FOREIGN_SCHEMA", r.name, "SCHEMA");
            else this.unresolved("IMPORT_FOREIGN_SCHEMA", "IMPORT FOREIGN SCHEMA without a static local schema");
          }
          break;
        case "execute":
          this.execute(toks, p, prev);
          break;
        case "into":
          this.selectInto(toks, p, prev);
          break;
        case "set":
          if (atStatementStart(toks, p)) this.setSearchPath(toks, p);
          break;
        case "reset":
          if (atStatementStart(toks, p) && (wordAt(toks, p + 1, "search_path") || wordAt(toks, p + 1, "all"))) this.state.searchPath = null;
          break;
        case "set_config":
          this.setConfig(toks, p);
          break;
        default:
          if (Object.prototype.hasOwnProperty.call(sql.postgis_functions, t.v) && toks[p + 1]?.t === "LPAREN") {
            this.postgisFunction(toks, p, sql.postgis_functions[t.v] as WriteOperation);
          } else if (sql.dynamic_exec_functions.includes(t.v) && toks[p + 1]?.t === "LPAREN") {
            const end = matchParen(toks, p + 1);
            const inner = toks.slice(p + 2, end);
            if (inner.some((x) => !(x.t === "STRING" || x.t === "COMMA" || (x.t === "OP" && x.v === "||")))) {
              this.unresolved("DYNAMIC_SQL", `${t.v}() with a non-constant argument runs SQL the text does not contain`);
            }
          }
      }
    }
  }

  private drop(toks: readonly Tok[], p: number): void {
    const sql = this.spec.sql;
    const kind = matchKind(toks, p + 1, sql.relation_object_kinds);
    const ifExists = (k: number) => (wordsAt(toks, k, ["if", "exists"]) ? k + 2 : k);
    if (kind) {
      this.list(toks, p, ifExists(p + 1 + kind.length), "DROP");
      return;
    }
    if (wordAt(toks, p + 1, "schema")) {
      this.list(toks, p, ifExists(p + 2), "DROP_SCHEMA", { schema: true });
      return;
    }
    const unresolvable = matchKind(toks, p + 1, sql.drop_unresolvable_object_kinds);
    if (unresolvable) {
      if (atStatementStart(toks, p)) {
        this.unresolved(`DROP_${unresolvable.join("_").toUpperCase()}` as WriteOperation, `DROP ${unresolvable.join(" ").toUpperCase()} can drop protected relations no name shows`);
      }
      return;
    }
    if (toks[p + 1]?.t === "WORD" && sql.drop_on_object_kinds.includes(toks[p + 1]!.v)) {
      const named = parseNameAt(toks, ifExists(p + 2));
      if (named.name && wordAt(toks, named.end, "on")) this.one(toks, p, named.end + 1, "ALTER", { only: true });
      else if (atStatementStart(toks, p)) this.unresolved("ALTER", `DROP ${toks[p + 1]!.v.toUpperCase()} without a static ON relation`);
    }
  }

  private update(toks: readonly Tok[], p: number, prev: string | null): void {
    if (prev !== null && this.spec.sql.update_not_after.includes(prev)) return;
    if (wordAt(toks, p + 1, "set")) return; // ON CONFLICT DO UPDATE SET / MERGE ... THEN UPDATE SET
    const r = parseNameAt(toks, p + 1, { only: true, star: true });
    let k = r.end;
    if (r.name) {
      if (wordAt(toks, k, "as")) k += 1;
      if (toks[k]?.t === "WORD" && toks[k]!.v !== "set") k += 1;
      if (wordAt(toks, k, "set")) {
        this.target("UPDATE", r.name);
        return;
      }
    }
    if (atStatementStart(toks, p)) this.unresolved("UPDATE", `UPDATE target is not a static relation name: ${describeAt(toks, p)}`);
  }

  private copy(toks: readonly Tok[], p: number): void {
    if (toks[p + 1]?.t === "LPAREN") return; // COPY (query) TO
    const r = parseNameAt(toks, p + 1);
    let k = r.end;
    if (r.name) {
      if (toks[k]?.t === "LPAREN") k = matchParen(toks, k) + 1;
      if (wordAt(toks, k, "from")) this.target("COPY_FROM", r.name);
      return;
    }
    if (toks.some((x, n) => n > p && x.t === "WORD" && x.v === "from")) this.unresolved("COPY_FROM", `COPY target is not a static relation name: ${describeAt(toks, p)}`);
  }

  private alter(toks: readonly Tok[], p: number): void {
    const kind = matchKind(toks, p + 1, this.spec.sql.relation_object_kinds);
    if (kind) {
      let k = p + 1 + kind.length;
      if (wordsAt(toks, k, ["if", "exists"])) k += 2;
      if (wordsAt(toks, k, ["all", "in", "tablespace"])) {
        this.unresolved("ALTER", "ALTER ... ALL IN TABLESPACE moves relations no name shows");
        return;
      }
      const r = parseNameAt(toks, k, { only: true, star: true });
      if (!r.name) {
        if (atStatementStart(toks, p)) this.unresolved("ALTER", `ALTER target is not a static relation name: ${describeAt(toks, p)}`);
        return;
      }
      const rest = toks.slice(r.end);
      const renameAt = rest.findIndex((x, n) => x.t === "WORD" && x.v === "rename" && wordAt(rest, n + 1, "to"));
      if (renameAt >= 0) {
        const to = parseNameAt(rest, renameAt + 2);
        this.target("RENAME", r.name);
        if (to.name) this.target("RENAME", { schema: r.name.schema, table: to.name.table });
        else this.unresolved("RENAME", "RENAME TO a name that is not static");
        return;
      }
      this.target("ALTER", r.name);
      const setSchemaAt = rest.findIndex((x, n) => x.t === "WORD" && x.v === "set" && wordAt(rest, n + 1, "schema"));
      if (setSchemaAt >= 0) {
        const dest = parseNameAt(rest, setSchemaAt + 2);
        if (dest.name && dest.name.schema === null) this.target("ALTER", { schema: dest.name.table, table: r.name.table });
        else this.unresolved("ALTER", "SET SCHEMA to a schema that is not static");
      }
      return;
    }
    if (wordAt(toks, p + 1, "schema")) {
      const r = parseNameAt(toks, p + 2);
      if (!r.name || r.name.schema !== null) {
        if (atStatementStart(toks, p)) this.unresolved("ALTER_SCHEMA", `ALTER SCHEMA target is not a static schema name: ${describeAt(toks, p)}`);
        return;
      }
      if (wordsAt(toks, r.end, ["rename", "to"])) {
        const to = parseNameAt(toks, r.end + 2);
        this.target("RENAME_SCHEMA", r.name, "SCHEMA");
        if (to.name && to.name.schema === null) this.target("RENAME_SCHEMA", to.name, "SCHEMA");
        else this.unresolved("RENAME_SCHEMA", "RENAME TO a schema name that is not static");
      } else this.target("ALTER_SCHEMA", r.name, "SCHEMA");
    }
  }

  private create(toks: readonly Tok[], p: number): void {
    const sql = this.spec.sql;
    let k = p + 1;
    let orReplace = false;
    if (wordsAt(toks, k, ["or", "replace"])) {
      orReplace = true;
      k += 2;
    }
    while (toks[k]?.t === "WORD" && sql.create_modifiers.includes(toks[k]!.v)) k += 1;
    const kind = matchKind(toks, k, sql.relation_object_kinds);
    if (kind) {
      k += kind.length;
      if (wordsAt(toks, k, ["if", "not", "exists"])) k += 3;
      const r = parseNameAt(toks, k);
      if (!r.name) {
        if (atStatementStart(toks, p)) this.unresolved("CREATE", `CREATE target is not a static relation name: ${describeAt(toks, p)}`);
        return;
      }
      this.target(orReplace ? "CREATE_OR_REPLACE" : "CREATE", r.name);
      const rest = toks.slice(r.end);
      const partitionOf = rest.findIndex((x, n) => x.t === "WORD" && x.v === "partition" && wordAt(rest, n + 1, "of"));
      if (partitionOf >= 0) {
        const parent = parseNameAt(rest, partitionOf + 2);
        if (parent.name) this.target("ALTER", parent.name);
        else this.unresolved("ALTER", "PARTITION OF a parent that is not static");
      }
      const inherits = rest.findIndex((x, n) => x.t === "WORD" && x.v === "inherits" && rest[n + 1]?.t === "LPAREN");
      if (inherits >= 0) {
        let n = inherits + 2;
        for (;;) {
          const parent = parseNameAt(rest, n);
          if (!parent.name) {
            this.unresolved("ALTER", "INHERITS a parent that is not static");
            break;
          }
          this.target("ALTER", parent.name);
          if (rest[parent.end]?.t !== "COMMA") break;
          n = parent.end + 1;
        }
      }
      return;
    }
    if (wordAt(toks, k, "constraint") && wordAt(toks, k + 1, "trigger")) k += 1;
    const objectWord = toks[k]?.t === "WORD" ? toks[k]!.v : null;
    if (objectWord === "trigger" || objectWord === "policy" || objectWord === "rule") {
      const anchor = objectWord === "rule" ? "to" : "on";
      const at = toks.findIndex((x, n) => n > k + 1 && x.t === "WORD" && x.v === anchor);
      const r = at < 0 ? null : parseNameAt(toks, at + 1, { only: true });
      if (r?.name) this.target("ALTER", r.name);
      else if (atStatementStart(toks, p)) this.unresolved("ALTER", `CREATE ${objectWord.toUpperCase()} on a relation that is not static`);
    }
  }

  private execute(toks: readonly Tok[], p: number, prev: string | null): void {
    const sql = this.spec.sql;
    if (prev !== null && sql.execute_not_after.includes(prev)) return;
    if (toks[p + 1]?.t === "WORD" && sql.execute_not_before.includes(toks[p + 1]!.v)) return;
    if (!atStatementStart(toks, p)) return;
    const expr: Tok[] = [];
    for (let k = p + 1; k < toks.length; k += 1) {
      const x = toks[k]!;
      if (x.t === "WORD" && (x.v === "using" || x.v === "into")) break;
      expr.push(x);
    }
    const constant = expr.length > 0 && expr.every((x, n) => (n % 2 === 0 ? x.t === "STRING" : x.t === "OP" && x.v === "||"));
    if (!constant) this.unresolved("DYNAMIC_SQL", `EXECUTE of a non-constant expression: ${describeAt(toks, p)}`);
  }

  private selectInto(toks: readonly Tok[], p: number, prev: string | null): void {
    if (prev === "insert" || prev === "merge") return;
    if (!toks.slice(0, p).some((x) => x.t === "WORD" && x.v === "select")) return;
    let k = p + 1;
    while (toks[k]?.t === "WORD" && ["temp", "temporary", "unlogged", "table"].includes(toks[k]!.v)) k += 1;
    const r = parseNameAt(toks, k);
    if (r.name) this.target("CREATE", r.name); // lenient: a plpgsql variable is never a protected name
  }

  private pathValues(values: readonly Tok[]): readonly string[] | "UNKNOWN" | null {
    if (values.length === 1 && values[0]!.t === "WORD" && values[0]!.v === "default") return null;
    const path: string[] = [];
    for (const x of values) {
      if (x.t === "COMMA") continue;
      if (x.t === "WORD") path.push(x.v);
      else if (x.t === "QIDENT" && !x.bad) path.push(x.v);
      else if (x.t === "STRING") {
        for (const part of x.v.split(",")) {
          const name = parseRelationName(part);
          if (part.trim().length === 0) continue;
          if (!name || name.schema !== null) return "UNKNOWN";
          path.push(name.table);
        }
      } else return "UNKNOWN";
    }
    return path.filter((s) => s !== "$user" && s !== "pg_temp" && s !== "pg_catalog");
  }

  private setSearchPath(toks: readonly Tok[], p: number): void {
    let k = p + 1;
    if (wordAt(toks, k, "session") || wordAt(toks, k, "local")) k += 1;
    if (wordAt(toks, k, "schema")) {
      this.state.searchPath = this.pathValues(toks.slice(k + 1));
      return;
    }
    if (!wordAt(toks, k, "search_path")) return;
    k += 1;
    if (wordAt(toks, k, "to") || (toks[k]?.t === "OP" && toks[k]!.v === "=")) k += 1;
    this.state.searchPath = this.pathValues(toks.slice(k));
  }

  private setConfig(toks: readonly Tok[], p: number): void {
    if (toks[p + 1]?.t !== "LPAREN") return;
    const end = matchParen(toks, p + 1);
    const args = splitArgs(toks.slice(p + 2, end));
    const first = args[0];
    if (!first || first.length !== 1 || first[0]!.t !== "STRING") {
      if (first && first.some((x) => x.t !== "STRING")) this.state.searchPath = "UNKNOWN";
      return;
    }
    if (asciiLower(first[0]!.v.trim()) !== "search_path") return;
    const second = args[1];
    this.state.searchPath = second && second.length === 1 && second[0]!.t === "STRING" ? this.pathValues(second) : "UNKNOWN";
  }

  private postgisFunction(toks: readonly Tok[], p: number, op: WriteOperation): void {
    const end = matchParen(toks, p + 1);
    const args = splitArgs(toks.slice(p + 2, end)).map((a) => {
      let n = a.length;
      while (n >= 2 && a[n - 2]!.t === "OP" && a[n - 2]!.v === "::" && a[n - 1]!.t === "WORD") n -= 2;
      return a.slice(0, n);
    });
    if (args.length === 0 || args.some((a) => a.length !== 1 || (a[0]!.t !== "STRING" && a[0]!.t !== "NUMBER"))) {
      this.unresolved(op, `${toks[p]!.v}() without constant arguments: the relation it changes is not static`);
      return;
    }
    const strings = args.filter((a) => a[0]!.t === "STRING").map((a) => a[0]!.v);
    for (const s of strings) {
      const name = parseRelationName(s);
      if (name) this.target(op, name);
    }
    for (let n = 0; n + 1 < strings.length; n += 1) this.target(op, { schema: strings[n]!, table: strings[n + 1]! });
  }
}

function splitArgs(toks: readonly Tok[]): Tok[][] {
  const args: Tok[][] = [];
  let cur: Tok[] = [];
  let depth = 0;
  for (const t of toks) {
    if (t.t === "LPAREN") depth += 1;
    if (t.t === "RPAREN") depth -= 1;
    if (t.t === "COMMA" && depth === 0) {
      args.push(cur);
      cur = [];
    } else cur.push(t);
  }
  if (cur.length || args.length) args.push(cur);
  return args;
}

function analyzeSqlAt(sql: string, depth: number): WriteAnalysis & { searchPathChanged: boolean } {
  const out = emptyAnalysis();
  const { tokens, error } = tokenizeSql(sql);
  if (error) {
    out.unresolved.push({ operation: "PARSE", reason: `${error}: the text cannot be read as SQL` });
    return { ...out, searchPathChanged: false };
  }
  let nestedChangedPath = false;
  const dyn = `${classificationSpec().dynamic_placeholder_open}${classificationSpec().dynamic_placeholder_close}`;
  for (const text of embeddedTexts(tokens, dyn)) {
    if (depth + 1 > classificationSpec().sql.max_nesting) {
      out.unresolved.push({ operation: "DYNAMIC_SQL", reason: "SQL nested in literals deeper than the classifier reads" });
      continue;
    }
    const nested = analyzeSqlAt(text, depth + 1);
    merge(out, nested);
    if (nested.searchPathChanged) nestedChangedPath = true;
  }
  const state: SqlState = { searchPath: nestedChangedPath ? "UNKNOWN" : null };
  const analyzer = new SqlAnalyzer(state);
  let changed = nestedChangedPath;
  for (const statement of splitStatements(tokens)) {
    const before = JSON.stringify(state.searchPath);
    analyzer.statement(statement);
    if (JSON.stringify(state.searchPath) !== before) changed = true;
  }
  merge(out, analyzer.out);
  return { ...out, searchPathChanged: changed };
}

/** Every relation (or schema) a SQL text writes, and every write whose target is not static. */
export function analyzeSql(sql: string): WriteAnalysis {
  const r = analyzeSqlAt(sql, 0);
  return { targets: r.targets, unresolved: r.unresolved };
}

// =============================================================================================
// ogr2ogr
// =============================================================================================

export type Ogr2ogrWriteMode = "OVERWRITE" | "APPEND" | "UPSERT" | "UPDATE" | "CREATE";

export interface Ogr2ogrAnalysis extends WriteAnalysis {
  /** The output is a PostgreSQL database (or SQL for one: PGDump), or may be (dynamic). */
  readonly database: boolean;
  readonly mode: Ogr2ogrWriteMode;
  readonly formats: readonly string[];
}

/** Values after `flags`. GDAL compares option names without case; psql, pg_restore, shp2pgsql do not. */
function flagValues(args: readonly string[], flags: readonly string[], ignoreCase = false): { values: string[]; missing: boolean } {
  const values: string[] = [];
  let missing = false;
  args.forEach((a, i) => {
    if (!flags.includes(ignoreCase ? asciiLower(a.trim()) : a.trim())) return;
    if (i + 1 < args.length) values.push(args[i + 1]!);
    else missing = true;
  });
  return { values, missing };
}

function isPgDatasource(a: string): boolean {
  const lower = asciiLower(a.trim());
  return classificationSpec().ogr2ogr.database_datasource_prefixes.some((p) => lower.startsWith(p));
}

/** `key=value` option values for `keys` in an option list or a PG connection string. */
function optionValues(text: string, keys: readonly string[]): string[] {
  const out: string[] = [];
  const re = /([A-Za-z_]+)\s*=\s*('([^']*)'|"([^"]*)"|([^\s'"]+))/g;
  for (const m of text.matchAll(re)) {
    if (keys.includes(asciiLower(m[1]!))) out.push(m[3] ?? m[4] ?? m[5] ?? "");
  }
  return out;
}

export function analyzeOgr2ogrArgs(args: readonly string[]): Ogr2ogrAnalysis {
  const spec = classificationSpec().ogr2ogr;
  const out = emptyAnalysis();
  const lower = args.map((a) => asciiLower(a.trim()));
  const formats = flagValues(args, spec.format_flags, true).values.map((f) => asciiLower(f.trim()));
  let mode: Ogr2ogrWriteMode = "CREATE";
  for (const [flag, m] of Object.entries(spec.write_mode_flags)) {
    if (lower.includes(flag)) {
      mode = m as Ogr2ogrWriteMode;
      break;
    }
  }
  const lcos = flagValues(args, spec.layer_creation_flags, true).values;
  if (mode === "CREATE" && lcos.some((v) => /^\s*OVERWRITE\s*=\s*YES\s*$/i.test(v))) mode = "OVERWRITE";

  for (const sqlText of flagValues(args, spec.sql_flags, true).values) {
    if (sqlText.trim().startsWith("@")) out.unresolved.push({ operation: "DYNAMIC_SQL", reason: "ogr2ogr -sql @file runs SQL the arguments do not contain" });
    else merge(out, analyzeSql(sqlText));
  }

  const pgSources = args.filter(isPgDatasource);
  const nln = flagValues(args, spec.layer_name_flags, true);
  const dynamicOnly = args.some((a) => dynamicHint(a) !== null);
  const database =
    formats.length > 0
      ? formats.some((f) => spec.database_formats.includes(f) || spec.sql_dump_formats.includes(f) || dynamicHint(f) !== null)
      : pgSources.length > 0 || (dynamicOnly && nln.values.length > 0);
  if (!database) return { ...out, database: false, mode, formats };

  if (nln.values.length === 0) {
    out.unresolved.push({ operation: "OGR2OGR_WRITE", reason: "a PostgreSQL ogr2ogr write without -nln takes its table name from the source" });
    return { ...out, database: true, mode, formats };
  }
  const schemas: string[] = [];
  for (const v of lcos) schemas.push(...optionValues(v, spec.schema_options));
  for (const v of flagValues(args, spec.destination_open_flags, true).values) {
    for (const s of optionValues(v, spec.active_schema_options)) schemas.push(...s.split(","));
  }
  for (const ds of pgSources) for (const s of optionValues(ds, spec.active_schema_options)) schemas.push(...s.split(","));
  for (const value of nln.values) {
    const name = parseRelationName(value);
    if (!name) {
      out.unresolved.push({ operation: "OGR2OGR_WRITE", reason: `-nln ${value} is not a static relation name` });
      continue;
    }
    out.targets.push({ operation: "OGR2OGR_WRITE", scope: "RELATION", name });
    if (name.schema !== null) continue;
    for (const raw of schemas) {
      const schema = parseRelationName(raw);
      if (!schema || schema.schema !== null) {
        out.unresolved.push({ operation: "OGR2OGR_WRITE", reason: `schema ${raw} is not a static schema name` });
        continue;
      }
      out.targets.push({ operation: "OGR2OGR_WRITE", scope: "RELATION", name: { schema: schema.table, table: name.table } });
    }
  }
  return { ...out, database: true, mode, formats };
}

// =============================================================================================
// Command lines
// =============================================================================================

export interface CommandSegment {
  readonly argv: string[];
  /** Here-document / here-string text fed to the command's stdin. */
  readonly stdin: string | null;
  /** `< file` */
  readonly stdinFile: string | null;
}

/**
 * Split a command line (sh, PowerShell, cmd) into pipeline segments of arguments. Quotes are
 * removed; variables ($x, ${x}, $(…), $env:X, %X%) become the dynamic placeholder (with the variable
 * name as hint); `\`, `` ` `` and `^` before a newline continue the line; `<<EOF` here-documents and
 * `@'…'@` / `@"…"@` here-strings are kept as text.
 */
export function splitCommandLine(command: string): CommandSegment[][] {
  const dyn = (hint: string) => {
    const s = classificationSpec();
    const clean = hint.replace(/[^A-Za-z0-9_.-]/g, "");
    return `${s.dynamic_placeholder_open}${clean ? `:${clean}` : ""}${s.dynamic_placeholder_close}`;
  };
  const pipelines: CommandSegment[][] = [];
  let pipeline: CommandSegment[] = [];
  let argv: string[] = [];
  let stdin: string | null = null;
  let stdinFile: string | null = null;
  let tok = "";
  let started = false;
  let pendingHeredoc: string | null = null;
  let expectStdinFile = false;
  let skipNext = false;
  const endToken = () => {
    if (started) {
      if (skipNext) skipNext = false;
      else if (expectStdinFile) {
        stdinFile = tok;
        expectStdinFile = false;
      } else argv.push(tok);
    }
    tok = "";
    started = false;
  };
  const endSegment = () => {
    endToken();
    if (argv.length || stdin !== null) pipeline.push({ argv, stdin, stdinFile });
    argv = [];
    stdin = null;
    stdinFile = null;
  };
  const endPipeline = () => {
    endSegment();
    if (pipeline.length) pipelines.push(pipeline);
    pipeline = [];
  };
  const readVariable = (s: string, i: number): [string, number] | null => {
    if (s[i + 1] === "(") {
      let depth = 0;
      for (let j = i + 1; j < s.length; j += 1) {
        if (s[j] === "(") depth += 1;
        else if (s[j] === ")") {
          depth -= 1;
          if (depth === 0) return [dyn(""), j + 1];
        }
      }
      return [dyn(""), s.length];
    }
    if (s[i + 1] === "{") {
      const end = s.indexOf("}", i + 2);
      return [dyn(s.slice(i + 2, end < 0 ? s.length : end)), end < 0 ? s.length : end + 1];
    }
    const m = /^[A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)?/.exec(s.slice(i + 1));
    if (m) return [dyn(m[0].replace(/^env:/i, "")), i + 1 + m[0].length];
    return null;
  };

  const s = command;
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === "'" ) {
      const end = s.indexOf("'", i + 1);
      tok += s.slice(i + 1, end < 0 ? s.length : end);
      started = true;
      i = end < 0 ? s.length : end + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') {
        if ((s[j] === "\\" || s[j] === "`") && (s[j + 1] === '"' || s[j + 1] === "\\" || s[j + 1] === "`" || s[j + 1] === "$")) {
          tok += s[j + 1];
          j += 2;
          continue;
        }
        if (s[j] === "$") {
          const v = readVariable(s, j);
          if (v) {
            tok += v[0];
            j = v[1];
            continue;
          }
        }
        if (s[j] === "%") {
          const m = /^%([A-Za-z_][A-Za-z0-9_]*)%/.exec(s.slice(j));
          if (m) {
            tok += dyn(m[1]!);
            j += m[0].length;
            continue;
          }
        }
        tok += s[j];
        j += 1;
      }
      started = true;
      i = j + 1;
      continue;
    }
    if (c === "@" && (s[i + 1] === "'" || s[i + 1] === '"') && !started && (s[i + 2] === "\n" || s.slice(i + 2, i + 4) === "\r\n")) {
      const closer = `\n${s[i + 1]}@`;
      const end = s.indexOf(closer, i + 2);
      const body = s.slice(s.indexOf("\n", i) + 1, end < 0 ? s.length : end).replace(/\r$/, "");
      // A here-string piped into a command is that command's stdin; as an argument it is text.
      tok += s[i + 1] === '"' ? body.replace(/\$\{?[A-Za-z_][A-Za-z0-9_:]*\}?/g, (v) => dyn(v.replace(/[${}]/g, ""))) : body;
      started = true;
      i = end < 0 ? s.length : end + closer.length;
      continue;
    }
    if ((c === "\\" || c === "`" || c === "^") && (s[i + 1] === "\n" || (s[i + 1] === "\r" && s[i + 2] === "\n"))) {
      i += s[i + 1] === "\r" ? 3 : 2;
      continue;
    }
    if (c === "\n" || c === "\r") {
      if (pendingHeredoc !== null) {
        const delim = pendingHeredoc;
        pendingHeredoc = null;
        const lines = s.slice(i + 1).split("\n");
        const body: string[] = [];
        let consumed = i + 1;
        let found = false;
        for (const line of lines) {
          consumed += line.length + 1;
          if (line.replace(/\r$/, "").trim() === delim) {
            found = true;
            break;
          }
          body.push(line.replace(/\r$/, ""));
        }
        stdin = body.join("\n");
        endPipeline();
        i = found ? consumed : s.length;
        continue;
      }
      endPipeline();
      i += 1;
      continue;
    }
    if (c === " " || c === "\t") {
      endToken();
      i += 1;
      continue;
    }
    if (c === "|") {
      if (s[i + 1] === "|") {
        endPipeline();
        i += 2;
      } else {
        endSegment();
        i += 1;
      }
      continue;
    }
    if (c === "&") {
      if (s[i + 1] === "&") {
        endPipeline();
        i += 2;
        continue;
      }
      if (!started && argv.length === 0) {
        i += 1; // PowerShell call operator
        continue;
      }
      endPipeline();
      i += 1;
      continue;
    }
    if (c === ";") {
      endPipeline();
      i += 1;
      continue;
    }
    if (c === "<") {
      endToken();
      if (s[i + 1] === "<") {
        const m = /^<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(s.slice(i));
        if (m) {
          pendingHeredoc = m[2]!;
          i += m[0].length;
          continue;
        }
        i += 2;
        continue;
      }
      expectStdinFile = true;
      i += 1;
      continue;
    }
    if (c === ">") {
      if (/^[0-9]+$/.test(tok)) {
        tok = "";
        started = false;
      }
      endToken();
      let j = i + 1;
      if (s[j] === ">") j += 1;
      if (s[j] === "&") {
        j += 1;
        while (j < s.length && /[0-9]/.test(s[j]!)) j += 1;
      } else skipNext = true;
      i = j;
      continue;
    }
    if (c === "$") {
      const v = readVariable(s, i);
      if (v) {
        tok += v[0];
        started = true;
        i = v[1];
        continue;
      }
    }
    if (c === "%") {
      const m = /^%([A-Za-z_][A-Za-z0-9_]*)%/.exec(s.slice(i));
      if (m) {
        tok += dyn(m[1]!);
        started = true;
        i += m[0].length;
        continue;
      }
    }
    tok += c;
    started = true;
    i += 1;
  }
  endPipeline();
  return pipelines;
}

function toolBaseName(arg: string): string {
  const t = arg.trim().replace(/^["']+|["']+$/g, "");
  const parts = t.split(/[\\/]/);
  return asciiLower(parts[parts.length - 1] ?? "");
}

/** The DB/GIS tool an argument names, by file name or by a dynamic value's variable name. */
export function toolOf(arg: string): string | null {
  const spec = classificationSpec().commands;
  const hint = dynamicHint(arg);
  const names = Object.keys(spec.tools).sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  if (hint !== null) {
    const h = asciiLower(hint);
    for (const name of names) {
      const bare = name.replace(/\.py$/, "");
      if (spec.tools[name] !== "GDAL" && spec.tools[name] !== "PRISMA" && h.includes(bare)) return spec.tools[name]!;
    }
    return null;
  }
  const base = toolBaseName(arg);
  if (spec.tools[base]) return spec.tools[base]!;
  for (const suffix of spec.tool_suffixes) {
    if (base.endsWith(suffix) && spec.tools[base.slice(0, -suffix.length)]) return spec.tools[base.slice(0, -suffix.length)]!;
  }
  return null;
}

function shellWrapper(arg: string): { flags: readonly string[]; restOfLine: boolean } | null {
  const spec = classificationSpec().commands;
  let base = toolBaseName(arg);
  for (const suffix of spec.tool_suffixes) if (base.endsWith(suffix)) base = base.slice(0, -suffix.length);
  const flags = spec.shell_wrappers[base];
  return flags ? { flags, restOfLine: spec.shell_wrappers_rest_of_line.includes(base) } : null;
}

/** An argument as command-line text again: quoted (with \ escapes the splitter undoes) when needed. */
function requote(a: string): string {
  if (!/[\s"'`$\\]/.test(a)) return a;
  let out = "";
  for (const c of a) out += c === '"' || c === "\\" || c === "`" || c === "$" ? `\\${c}` : c;
  return `"${out}"`;
}

interface SegmentContext {
  readonly stdin: string | null;
  readonly stdinFile: string | null;
  readonly pipedFromTool: string | null;
  readonly pipesToTool: string | null;
}

const GENERATORS = new Set(["SHP2PGSQL", "PG_DUMP", "PG_RESTORE", "OGR2OGR"]);

function readFileOrUnresolved(out: { targets: WriteTarget[]; unresolved: UnresolvedWrite[] }, path: string, options: ClassifierOptions, depth: number): void {
  const text = containsDynamic(path) ? null : (options.readSqlFile?.(path) ?? null);
  if (text === null) {
    out.unresolved.push({ operation: "PSQL_FILE", reason: `SQL file ${path} is not available to the classifier` });
    return;
  }
  merge(out, depth > classificationSpec().sql.max_nesting ? { targets: [], unresolved: [{ operation: "PARSE", reason: "nesting" }] } : analyzeSql(text));
}

function pgObjectTargets(out: { targets: WriteTarget[]; unresolved: UnresolvedWrite[] }, rest: readonly string[], what: string): void {
  const spec = classificationSpec().commands.pg_restore;
  const collect = (flags: readonly string[]) => {
    const values = flagValues(rest, flags).values;
    for (const a of rest) {
      for (const f of flags) if (f.startsWith("--") && asciiLower(a).startsWith(`${f}=`)) values.push(a.slice(f.length + 1));
    }
    return values;
  };
  const tables = collect(spec.table_flags);
  const schemas = collect(spec.schema_flags);
  if (rest.some((a) => spec.list_file_flags.includes(a))) {
    out.unresolved.push({ operation: "RESTORE", reason: `${what} with a list file restores objects the arguments do not name` });
    return;
  }
  if (tables.length > 0) {
    for (const t of tables) {
      const name = parseRelationName(t);
      if (!name) {
        out.unresolved.push({ operation: "RESTORE", reason: `${what} table ${t} is not a static name` });
        continue;
      }
      if (name.schema !== null || schemas.length === 0) out.targets.push({ operation: "RESTORE", scope: "RELATION", name });
      for (const s of name.schema === null ? schemas : []) {
        const schema = parseRelationName(s);
        if (!schema || schema.schema !== null) out.unresolved.push({ operation: "RESTORE", reason: `${what} schema ${s} is not static` });
        else out.targets.push({ operation: "RESTORE", scope: "RELATION", name: { schema: schema.table, table: name.table } });
      }
    }
    return;
  }
  if (schemas.length > 0) {
    for (const s of schemas) {
      const schema = parseRelationName(s);
      if (!schema || schema.schema !== null) out.unresolved.push({ operation: "RESTORE_SCHEMA", reason: `${what} schema ${s} is not static` });
      else out.targets.push({ operation: "RESTORE_SCHEMA", scope: "SCHEMA", name: { schema: null, table: schema.table } });
    }
    return;
  }
  out.unresolved.push({ operation: "RESTORE", reason: `${what} without -t/-n writes every object of the archive` });
}

function analyzeTool(tool: string, rest: readonly string[], ctx: SegmentContext, options: ClassifierOptions, depth: number): WriteAnalysis {
  const spec = classificationSpec().commands;
  const out = emptyAnalysis();
  switch (tool) {
    case "OGR2OGR":
      return analyzeOgr2ogrArgs(rest);
    case "OGRINFO":
      for (const v of flagValues(rest, spec.ogrinfo.sql_flags, true).values) {
        if (v.trim().startsWith("@")) out.unresolved.push({ operation: "DYNAMIC_SQL", reason: "ogrinfo -sql @file" });
        else merge(out, analyzeSql(v));
      }
      return out;
    case "PSQL": {
      let hasSql = false;
      for (let i = 0; i < rest.length; i += 1) {
        const a = rest[i]!;
        if (spec.psql.command_flags.includes(a)) {
          hasSql = true;
          if (i + 1 < rest.length) merge(out, analyzeSql(rest[i + 1]!));
          else out.unresolved.push({ operation: "PSQL_STDIN", reason: "psql -c without a command" });
          i += 1;
        } else if (a.startsWith("--command=")) {
          hasSql = true;
          merge(out, analyzeSql(a.slice("--command=".length)));
        } else if (spec.psql.file_flags.includes(a)) {
          hasSql = true;
          if (i + 1 < rest.length) readFileOrUnresolved(out, rest[i + 1]!, options, depth);
          else out.unresolved.push({ operation: "PSQL_FILE", reason: "psql -f without a file" });
          i += 1;
        } else if (a.startsWith("--file=")) {
          hasSql = true;
          readFileOrUnresolved(out, a.slice("--file=".length), options, depth);
        } else if (spec.psql.value_flags.includes(a)) i += 1;
      }
      if (!hasSql) {
        if (ctx.stdin !== null) merge(out, analyzeSql(ctx.stdin));
        else if (ctx.stdinFile !== null) readFileOrUnresolved(out, ctx.stdinFile, options, depth);
        else if (ctx.pipedFromTool === null || !GENERATORS.has(ctx.pipedFromTool)) {
          out.unresolved.push({ operation: "PSQL_STDIN", reason: "psql reads SQL from stdin that the command line does not contain" });
        }
      }
      return out;
    }
    case "PG_RESTORE":
      if (rest.some((a) => spec.pg_restore.list_only_flags.includes(a))) return out;
      pgObjectTargets(out, rest, "pg_restore");
      return out;
    case "PG_DUMP":
      if (ctx.pipesToTool === "PSQL") pgObjectTargets(out, rest, "pg_dump | psql");
      return out;
    case "SHP2PGSQL": {
      const positionals: string[] = [];
      for (let i = 0; i < rest.length; i += 1) {
        const a = rest[i]!;
        if (a.startsWith("-") && a.length > 1) {
          if (spec.shp2pgsql.value_flags.includes(a)) i += 1;
          continue;
        }
        positionals.push(a);
      }
      if (positionals.length < 2) {
        out.unresolved.push({ operation: "SHP2PGSQL_WRITE", reason: "shp2pgsql/raster2pgsql without a table takes the name from the file" });
        return out;
      }
      const name = parseRelationName(positionals[1]!);
      if (name) out.targets.push({ operation: "SHP2PGSQL_WRITE", scope: "RELATION", name });
      else out.unresolved.push({ operation: "SHP2PGSQL_WRITE", reason: `table ${positionals[1]} is not a static name` });
      return out;
    }
    case "GDAL":
      if (rest.some(isPgDatasource)) {
        out.unresolved.push({ operation: "COMMAND", reason: "a GDAL tool with a PostgreSQL datasource writes relations the arguments do not name" });
      }
      return out;
    case "PRISMA": {
      const words = rest.filter((a) => !a.startsWith("-")).map(asciiLower);
      for (const sub of spec.prisma.unresolvable_subcommands) {
        if (sub.every((w, n) => words[n] === w)) {
          out.unresolved.push({ operation: "COMMAND", reason: `prisma ${sub.join(" ")} changes the database outside any classified SQL` });
          return out;
        }
      }
      for (const sub of spec.prisma.file_executing_subcommands) {
        if (!sub.every((w, n) => words[n] === w)) continue;
        if (rest.some((a) => spec.prisma.stdin_flags.includes(asciiLower(a)))) {
          out.unresolved.push({ operation: "PSQL_STDIN", reason: `prisma ${sub.join(" ")} --stdin` });
          return out;
        }
        const files = flagValues(rest, spec.prisma.file_flags).values;
        for (const a of rest) if (asciiLower(a).startsWith("--file=")) files.push(a.slice("--file=".length));
        if (files.length === 0) out.unresolved.push({ operation: "PSQL_FILE", reason: `prisma ${sub.join(" ")} without --file` });
        for (const f of files) readFileOrUnresolved(out, f, options, depth);
        return out;
      }
      return out;
    }
    default:
      return out;
  }
}

function analyzeArgvAt(argv: readonly string[], ctx: SegmentContext, options: ClassifierOptions, depth: number): WriteAnalysis {
  const out = emptyAnalysis();
  if (depth > classificationSpec().sql.max_nesting) {
    out.unresolved.push({ operation: "COMMAND", reason: "command nesting deeper than the classifier reads" });
    return out;
  }
  for (let k = 0; k < argv.length; k += 1) {
    const wrapper = shellWrapper(argv[k]!);
    if (wrapper) {
      const at = argv.findIndex((a, n) => n > k && wrapper.flags.includes(asciiLower(a)));
      if (at >= 0 && at + 1 < argv.length) {
        const command = wrapper.restOfLine ? argv.slice(at + 1).map(requote).join(" ") : argv[at + 1]!;
        merge(out, analyzeCommandAt(command, options, depth + 1));
        return out;
      }
      continue;
    }
    const tool = toolOf(argv[k]!);
    if (tool) {
      merge(out, analyzeTool(tool, argv.slice(k + 1), ctx, options, depth));
      return out;
    }
  }
  // A dynamic or unknown binary whose arguments are those of a GDAL write.
  const flagSet = new Set(argv.map((a) => asciiLower(a.trim())));
  const ogrSpec = classificationSpec().ogr2ogr;
  if (ogrSpec.layer_name_flags.some((f) => flagSet.has(f)) || ogrSpec.sql_flags.some((f) => flagSet.has(f)) || argv.some(isPgDatasource)) {
    merge(out, analyzeOgr2ogrArgs(argv.slice(1)));
    return out;
  }
  // Arguments that are themselves command lines (a wrapper this table does not know).
  for (const a of argv) {
    if (/\s/.test(a) && Object.keys(classificationSpec().commands.tools).some((name) => asciiLower(a).includes(name))) {
      merge(out, analyzeCommandAt(a, options, depth + 1));
    }
  }
  return out;
}

function analyzeCommandAt(command: string, options: ClassifierOptions, depth: number): WriteAnalysis {
  const out = emptyAnalysis();
  for (const pipeline of splitCommandLine(command)) {
    const tools = pipeline.map((seg) => {
      for (const a of seg.argv) {
        const t = toolOf(a);
        if (t) return t;
      }
      return null;
    });
    pipeline.forEach((seg, n) => {
      merge(
        out,
        analyzeArgvAt(seg.argv, { stdin: seg.stdin, stdinFile: seg.stdinFile, pipedFromTool: n > 0 ? tools[n - 1]! : null, pipesToTool: tools[n + 1] ?? null }, options, depth),
      );
    });
  }
  return out;
}

/** What a command line writes (every pipeline, every segment). */
export function analyzeCommandLine(command: string, options: ClassifierOptions = {}): WriteAnalysis {
  return analyzeCommandAt(command, options, 0);
}

/** What an argument vector (argv[0] = the program) writes. */
export function analyzeCommandArgv(argv: readonly string[], options: ClassifierOptions = {}): WriteAnalysis {
  return analyzeArgvAt(argv, { stdin: null, stdinFile: null, pipedFromTool: null, pipesToTool: null }, options, 0);
}

// =============================================================================================
// Judgement
// =============================================================================================

export type WriteVerdictKind = "ALLOWED" | "PROTECTED" | "UNRESOLVABLE";

export interface ProtectedWrite {
  readonly operation: WriteOperation;
  readonly relation: string;
  readonly class: ProtectedRelationClass;
  readonly reason: string;
}

export interface WriteVerdict {
  readonly verdict: WriteVerdictKind;
  readonly protectedWrites: readonly ProtectedWrite[];
  readonly unresolved: readonly UnresolvedWrite[];
  readonly targets: readonly WriteTarget[];
}

export function targetText(t: WriteTarget): string {
  return t.scope === "SCHEMA" ? `schema:${canonicalRelationText({ schema: null, table: t.name.table })}` : canonicalRelationText(t.name);
}

export function judgeWrites(analysis: WriteAnalysis, definition: ProtectedRelationsDefinition = PROTECTED_RELATIONS): WriteVerdict {
  const protectedWrites: ProtectedWrite[] = [];
  const unresolved: UnresolvedWrite[] = [...analysis.unresolved];
  for (const t of analysis.targets) {
    const c = t.scope === "SCHEMA" ? classifySchema(canonicalRelationText({ schema: null, table: t.name.table }), definition) : classifyRelation(t.name, definition);
    if (c.kind === "PROTECTED") protectedWrites.push({ operation: t.operation, relation: targetText(t), class: c.class, reason: c.reason });
    else if (c.kind === "UNRESOLVABLE") unresolved.push({ operation: t.operation, reason: c.reason });
  }
  return {
    verdict: protectedWrites.length > 0 ? "PROTECTED" : unresolved.length > 0 ? "UNRESOLVABLE" : "ALLOWED",
    protectedWrites,
    unresolved,
    targets: analysis.targets,
  };
}

/** The comparable form of a verdict (the bindings' parity test compares exactly this). */
export function normalizedVerdict(v: WriteVerdict): { verdict: WriteVerdictKind; protected: string[]; unresolved: string[] } {
  const uniqueSorted = (xs: string[]) => [...new Set(xs)].sort();
  return {
    verdict: v.verdict,
    protected: uniqueSorted(v.protectedWrites.map((p) => `${p.operation} ${p.relation}`)),
    unresolved: uniqueSorted(v.unresolved.map((u) => u.operation)),
  };
}
