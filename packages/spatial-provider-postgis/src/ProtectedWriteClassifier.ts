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
  /** U30F3 M-1: a view (or an ON SELECT rule) over the relation -- INSERT/UPDATE/DELETE through it write the relation. */
  | "WRITE_PATH"
  /** U30F5 (D-3): COPY ... FROM/TO PROGRAM runs a shell command on the database server. */
  | "COPY_PROGRAM"
  /** U30F5 (D-7): DROP/TRUNCATE/ALTER ... CASCADE reaches dependent objects no name shows. */
  | "CASCADE"
  /** U30F5 (B8): privileges and roles -- a GRANT lifts the database-level protection. */
  | "GRANT"
  | "REVOKE"
  | "DEFAULT_PRIVILEGES"
  | "ROLE"
  | "DYNAMIC_SQL"
  | "PSQL_STDIN"
  | "PSQL_FILE"
  | "PSQL_META"
  | "SEARCH_PATH"
  | "COMMAND"
  /**
   * U30F9 default-deny (owner decision 2026-10-03): a DB-capable tool run with any value the text does not hold -- an
   * expansion, a substitution, a template, a positional parameter, an expanding here-document -- in an argument, on stdin
   * or as its stdin file. The text cannot show what the tool is told, so the command is unresolvable whatever else it says.
   */
  | "NON_LITERAL"
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
  /**
   * U30F5 (D-7): the text is on a path that does NOT go through the gate (the inventory's static sites): a CASCADE is
   * then unresolved -- it reaches dependent objects no name shows. Through the gate (the default) the named targets are
   * judged, and what a CASCADE reaches is the database-level protection's (B4).
   */
  readonly ungated?: boolean;
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
      else push("QIDENT", decoded ?? r[0], i, r[1], decoded === null || followedByUescape(s, r[1]) || r[0].length === 0 || (decoded ?? r[0]).includes(open));
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
      // U30F2 H1: "${schema}" in a shell command line is a name the text does not hold
      push("QIDENT", r[0], i, r[1], r[0].length === 0 || r[0].includes(open));
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
        // `bad` on a STRING marks a dollar-quoted body (DO / function code), U30F2 H1
        push("STRING", s.slice(j + 1, end), i, end + tag.length, true);
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
  /** U30F5 (D-7): an ungated path -- CASCADE is unresolved. */
  readonly ungated: boolean;
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
  const code: string[] = [];
  toks.forEach((t, k) => {
    if ((t.t === "STRING" && !consumed.has(k)) || t.t === "QIDENT") texts.push(t.v);
    // U30F2 H1: a dollar-quoted body holding a dynamic value (`DO $$BEGIN $CMD; END$$`) is code the text does not hold
    if (t.t === "STRING" && t.bad && !consumed.has(k) && !containsTriggerWord(t.v) && containsDynamic(t.v)) code.push(t.v);
  });
  return [...texts.filter(containsTriggerWord), ...code];
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
      // U30F2 H1: `psql -c "$SQL"` / `BEGIN $CMD; END`: the statement's verb is not in the text
      const explainPrev = sql.dynamic_statement_after_explain.includes(prevKey(toks, p) ?? "") && wordAt(toks, 0, "explain");
      if (t.t === "DYN" && (p === 0 || sql.dynamic_statement_after.includes(prevKey(toks, p) ?? "") || explainPrev)) {
        this.unresolved("DYNAMIC_SQL", "a statement whose verb is a dynamic value");
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
            this.importForeignRemote(toks, p);
          }
          break;
        case "grant":
        case "revoke":
          if (atStatementStart(toks, p)) this.grant(toks, p, t.v === "grant" ? "GRANT" : "REVOKE");
          break;
        case "cascade": {
          // U30F5 (D-7): on an ungated path; not ON DELETE/UPDATE CASCADE (a foreign key's action); in a DROP/TRUNCATE/ALTER statement
          if (!this.state.ungated || (prev !== null && sql.cascade_not_after.includes(prev))) break;
          if (toks.some((x, k) => k < p && x.t === "WORD" && sql.cascade_verbs.includes(x.v) && atStatementStart(toks, k))) {
            this.unresolved("CASCADE", "CASCADE reaches dependent objects no name shows (foreign-key children, views over the target)");
          }
          break;
        }
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
    // U30F5 (D-3): FROM PROGRAM / TO PROGRAM runs a shell command on the database server, whatever the table
    if (toks.some((x, n) => n > p && x.t === "WORD" && x.v === "program" && (wordAt(toks, n - 1, "from") || wordAt(toks, n - 1, "to")))) {
      this.unresolved("COPY_PROGRAM", "COPY ... PROGRAM runs a shell command on the database server");
    }
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
      // U30F5 (D-4): OPTIONS, RENAME TO or SET SCHEMA of a foreign table can change the remote relation it writes
      if (kind.length === 2 && kind[0] === "foreign") {
        const changesRemote = rest.some(
          (x, n) => x.t === "WORD" && ((x.v === "options" && rest[n + 1]?.t === "LPAREN") || (x.v === "rename" && wordAt(rest, n + 1, "to")) || (x.v === "set" && wordAt(rest, n + 1, "schema"))),
        );
        if (changesRemote) this.unresolved("WRITE_PATH", "ALTER FOREIGN TABLE changes the remote relation it writes through to");
      }
      const renameAt = rest.findIndex((x, n) => x.t === "WORD" && x.v === "rename" && wordAt(rest, n + 1, "to"));
      if (renameAt >= 0) {
        const to = parseNameAt(rest, renameAt + 2);
        this.target("RENAME", r.name);
        if (to.name) this.target("RENAME", { schema: r.name.schema, table: to.name.table });
        else this.unresolved("RENAME", "RENAME TO a name that is not static");
        return;
      }
      this.target("ALTER", r.name);
      // U30F3 M-1: ATTACH/DETACH PARTITION <child> and [NO] INHERIT <parent> change that relation too -- a
      // protected table attached under an unprotected parent is emptied by TRUNCATE (dropped by DROP) of the parent
      for (let n = 0; n < rest.length; n += 1) {
        const x = rest[n]!;
        if (x.t !== "WORD") continue;
        let at = -1;
        if ((x.v === "attach" || x.v === "detach") && wordAt(rest, n + 1, "partition")) at = n + 2;
        else if (x.v === "inherit") at = n + 1;
        if (at < 0) continue;
        const other = parseNameAt(rest, at);
        if (other.name) this.target("ALTER", other.name);
        else this.unresolved("ALTER", `${x.v.toUpperCase()} of a relation that is not static`);
      }
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
      return;
    }
    // U30F5 (B8): ALTER DEFAULT PRIVILEGES [FOR ROLE r] [IN SCHEMA s, ...] -- without IN SCHEMA it applies to every schema
    if (wordsAt(toks, p + 1, ["default", "privileges"])) {
      const inAt = toks.findIndex((x, n) => n > p + 2 && x.t === "WORD" && x.v === "in" && wordAt(toks, n + 1, "schema"));
      if (inAt >= 0) this.list(toks, p, inAt + 2, "DEFAULT_PRIVILEGES", { schema: true });
      else if (atStatementStart(toks, p)) this.unresolved("DEFAULT_PRIVILEGES", "ALTER DEFAULT PRIVILEGES without IN SCHEMA applies to every schema");
      return;
    }
    // U30F5 (B8): ALTER ROLE / USER / GROUP (not USER MAPPING) can grant SUPERUSER, BYPASSRLS or a membership
    if ((wordAt(toks, p + 1, "role") || wordAt(toks, p + 1, "group") || (wordAt(toks, p + 1, "user") && !wordAt(toks, p + 2, "mapping"))) && atStatementStart(toks, p)) {
      this.unresolved("ROLE", "a role change can lift the database-level protection of the protected relations");
    }
  }

  /**
   * U30F5 (B8): GRANT/REVOKE ... ON <relations> | ON ALL TABLES IN SCHEMA <s> | ON SCHEMA <s> names what it opens;
   * other object kinds (a sequence, a function, a database ...) name no relation; without ON it is a role membership.
   */
  private grant(toks: readonly Tok[], p: number, op: "GRANT" | "REVOKE"): void {
    const end = op === "GRANT" ? "to" : "from";
    let depth = 0;
    let onAt = -1;
    let endAt = -1;
    for (let k = p + 1; k < toks.length; k += 1) {
      const x = toks[k]!;
      if (x.t === "LPAREN") depth += 1;
      else if (x.t === "RPAREN") depth -= 1;
      else if (depth === 0 && x.t === "WORD" && x.v === "on") {
        onAt = k;
        break;
      } else if (depth === 0 && x.t === "WORD" && x.v === end) {
        endAt = k;
        break;
      }
    }
    if (onAt < 0) {
      // GRANT <role> TO <role> (REVOKE ... FROM): a membership; without TO/FROM it is no privilege statement
      if (endAt >= 0) this.unresolved("ROLE", `${op} of a role membership can carry rights on the protected relations`);
      return;
    }
    const k = onAt + 1;
    if (wordsAt(toks, k, ["all", "tables", "in", "schema"])) this.list(toks, p, k + 4, op, { schema: true });
    else if (wordAt(toks, k, "all")) return; // ALL SEQUENCES / FUNCTIONS / PROCEDURES / ROUTINES IN SCHEMA
    else if (wordAt(toks, k, "schema")) this.list(toks, p, k + 1, op, { schema: true });
    else if (wordAt(toks, k, "table")) this.list(toks, p, k + 1, op);
    else if (toks[k]?.t === "WORD" && this.spec.sql.privilege_other_object_kinds.includes(toks[k]!.v)) return;
    else this.list(toks, p, k, op);
  }

  /**
   * U30F5 (D-4): IMPORT FOREIGN SCHEMA <remote> [LIMIT TO (t, ...)] makes a foreign table for each remote relation:
   * a write path to each LIMIT TO name, else to the whole remote schema.
   */
  private importForeignRemote(toks: readonly Tok[], p: number): void {
    const remote = parseNameAt(toks, p + 3);
    if (!remote.name || remote.name.schema !== null) {
      this.unresolved("WRITE_PATH", "IMPORT FOREIGN SCHEMA of a remote schema that is not static");
      return;
    }
    const schema = remote.name.table;
    if (wordsAt(toks, remote.end, ["limit", "to"]) && toks[remote.end + 2]?.t === "LPAREN") {
      const close = matchParen(toks, remote.end + 2);
      for (const arg of splitArgs(toks.slice(remote.end + 3, close))) {
        const n = parseNameAt(arg, 0);
        if (n.name && n.name.schema === null && n.end === arg.length) this.target("WRITE_PATH", { schema, table: n.name.table });
        else this.unresolved("WRITE_PATH", "IMPORT FOREIGN SCHEMA LIMIT TO a name that is not static");
      }
      return;
    }
    this.target("WRITE_PATH", { schema: null, table: schema }, "SCHEMA");
  }

  /**
   * U30F5 (D-4): a foreign table writes through to its remote relation -- OPTIONS (schema_name '...', table_name
   * '...'), each defaulting to the foreign table's own schema and name. A value that is not a constant string is unresolved.
   */
  private foreignTable(rest: readonly Tok[], local: RelationName): void {
    const names = this.spec.sql.foreign_table_remote_options;
    let depth = 0;
    let serverAt = -1;
    for (let n = 0; n < rest.length; n += 1) {
      const x = rest[n]!;
      if (x.t === "LPAREN") depth += 1;
      else if (x.t === "RPAREN") depth -= 1;
      else if (depth === 0 && x.t === "WORD" && x.v === "server") {
        serverAt = n;
        break;
      }
    }
    let schema = local.schema;
    let table = local.table;
    let notStatic = false;
    const optionsAt = serverAt < 0 ? -1 : rest.findIndex((x, n) => n > serverAt && x.t === "WORD" && x.v === "options" && rest[n + 1]?.t === "LPAREN");
    if (optionsAt >= 0) {
      for (const arg of splitArgs(rest.slice(optionsAt + 2, matchParen(rest, optionsAt + 1)))) {
        const key = arg[0];
        if (key?.t !== "WORD" || (key.v !== names.schema && key.v !== names.table)) continue;
        const value = arg[1];
        if (arg.length !== 2 || value?.t !== "STRING" || containsDynamic(value.v)) {
          notStatic = true;
          continue;
        }
        if (key.v === names.schema) schema = value.v;
        else table = value.v;
      }
    }
    if (notStatic) this.unresolved("WRITE_PATH", "a foreign table whose remote relation is not static");
    else this.target("WRITE_PATH", { schema, table });
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
      // U30F3 M-1: a (non-materialized) view is a write path to every relation its query reads
      if (kind.length === 1 && kind[0] === "view") this.writePath(rest, afterDefiningAs(rest));
      if (kind.length === 2 && kind[0] === "foreign") this.foreignTable(rest, r.name);
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
    // U30F5 (B8): CREATE ROLE/USER/GROUP with an option that carries rights or a membership (not CREATE USER MAPPING)
    if ((objectWord === "role" || objectWord === "group" || (objectWord === "user" && !wordAt(toks, k + 1, "mapping"))) && atStatementStart(toks, p)) {
      if (toks.some((x, n) => n > k + 1 && x.t === "WORD" && sql.role_options_unresolvable.includes(x.v))) {
        this.unresolved("ROLE", "a role created with rights or a membership can lift the database-level protection");
      }
      return;
    }
    if (objectWord === "trigger" || objectWord === "policy" || objectWord === "rule") {
      const anchor = objectWord === "rule" ? "to" : "on";
      const at = toks.findIndex((x, n) => n > k + 1 && x.t === "WORD" && x.v === anchor);
      const r = at < 0 ? null : parseNameAt(toks, at + 1, { only: true });
      if (r?.name) this.target("ALTER", r.name);
      else if (atStatementStart(toks, p)) this.unresolved("ALTER", `CREATE ${objectWord.toUpperCase()} on a relation that is not static`);
      // U30F3 M-1: an ON SELECT ... DO INSTEAD SELECT rule makes its relation a view of what the action reads
      if (objectWord === "rule") {
        const on = toks.findIndex((x, n) => n > k + 1 && x.t === "WORD" && x.v === "on");
        const doAt = on >= 0 && wordAt(toks, on + 1, "select") ? toks.findIndex((x, n) => n > on + 1 && x.t === "WORD" && x.v === "do") : -1;
        if (doAt >= 0) this.writePath(toks, doAt + 1);
      }
    }
  }

  /**
   * U30F3 M-1: every static relation name in a view's query (or an ON SELECT rule's action) from `start` on is a
   * WRITE_PATH target -- an auto-updatable view writes through to it; a dynamic value there is unresolved. Not
   * a name: a token after `.` (a qualified part), after `AS` (an alias), after `::` (a type), or a function call.
   */
  private writePath(def: readonly Tok[], start: number): void {
    let dynamic = false;
    let k = start;
    while (k < def.length) {
      const x = def[k]!;
      if (x.t === "DYN") dynamic = true;
      if (x.t !== "WORD" && x.t !== "QIDENT") {
        k += 1;
        continue;
      }
      const prev = def[k - 1];
      if (prev && (prev.t === "DOT" || (prev.t === "WORD" && prev.v === "as") || (prev.t === "OP" && prev.v === "::"))) {
        k += 1;
        continue;
      }
      const r = parseNameAt(def, k);
      if (!r.name) {
        k += 1;
        continue;
      }
      if (def[r.end]?.t !== "LPAREN") this.target("WRITE_PATH", r.name);
      k = Math.max(r.end, k + 1);
    }
    if (dynamic) this.unresolved("WRITE_PATH", "a view or rule over a relation that is not static");
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
    if (args.length === 0 || args.some((a) => a.length !== 1 || (a[0]!.t !== "STRING" && a[0]!.t !== "NUMBER") || containsDynamic(a[0]!.v))) {
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

/** U30F3 M-1: the index after the first `AS` outside parentheses (a view's defining query), or the end. */
function afterDefiningAs(toks: readonly Tok[]): number {
  let depth = 0;
  for (let k = 0; k < toks.length; k += 1) {
    const t = toks[k]!;
    if (t.t === "LPAREN") depth += 1;
    else if (t.t === "RPAREN") depth -= 1;
    else if (depth === 0 && t.t === "WORD" && t.v === "as") return k + 1;
  }
  return toks.length;
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

function analyzeSqlAt(sql: string, depth: number, ungated: boolean): WriteAnalysis & { searchPathChanged: boolean } {
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
    const nested = analyzeSqlAt(text, depth + 1, ungated);
    merge(out, nested);
    if (nested.searchPathChanged) nestedChangedPath = true;
  }
  const state: SqlState = { searchPath: nestedChangedPath ? "UNKNOWN" : null, ungated };
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

/** Every relation (or schema) a SQL text writes, and every write whose target is not static (U30F5: `ungated` -- D-7). */
export function analyzeSql(sql: string, options: Pick<ClassifierOptions, "ungated"> = {}): WriteAnalysis {
  const r = analyzeSqlAt(sql, 0, options.ungated === true);
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

export function analyzeOgr2ogrArgs(args: readonly string[], options: Pick<ClassifierOptions, "ungated"> = {}): Ogr2ogrAnalysis {
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
    else merge(out, analyzeSql(sqlText, options));
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

/**
 * A cmd variable at the start of `s`, as [matched text, hint]: `%NAME%`, and (U30F5 D-5) a FOR loop variable
 * `%%i` / `%%~nxi` and a batch argument `%1` / `%~dp0` / `%*` -- all values the command line does not hold.
 */
function cmdVariable(s: string): [string, string] | null {
  const named = /^%([A-Za-z_][A-Za-z0-9_]*)%/.exec(s);
  if (named) return [named[0], named[1]!];
  // U30F9: cmd delayed expansion !NAME! is a value too
  const delayed = /^!([A-Za-z_][A-Za-z0-9_]*)!/.exec(s);
  if (delayed) return [delayed[0], delayed[1]!];
  const loop = /^%%(?:~[A-Za-z]*)?([A-Za-z])/.exec(s);
  if (loop) return [loop[0], loop[1]!];
  const arg = /^%(?:~[A-Za-z]*)?([0-9*])/.exec(s);
  if (arg) return [arg[0], arg[1] === "*" ? "" : arg[1]!];
  return null;
}

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
interface MutableSegment {
  argv: string[];
  stdin: string | null;
  stdinFile: string | null;
}

export function splitCommandLine(command: string): CommandSegment[][] {
  const dyn = (hint: string) => {
    const s = classificationSpec();
    const clean = hint.replace(/[^A-Za-z0-9_.-]/g, "");
    return `${s.dynamic_placeholder_open}${clean ? `:${clean}` : ""}${s.dynamic_placeholder_close}`;
  };
  const pipelines: MutableSegment[][] = [];
  let pipeline: MutableSegment[] = [];
  let argv: string[] = [];
  let stdin: string | null = null;
  let stdinFile: string | null = null;
  let tok = "";
  let started = false;
  // U30F8 (G6-1): an unquoted delimiter expands the body ($1, $VAR, ${x}, $(...), `...`); 'EOF', "EOF" and \EOF do not.
  // U30F9 (G8-6): EVERY here-document opened on the line, in order -- each body goes to the segment that opened it
  // (`cat <<A; psql <<B` reads A's body for cat and B's for psql; before, the second marker replaced the first).
  const pendingHeredocs: { delim: string; expand: boolean; seg: MutableSegment | null }[] = [];
  let expectHereString = false;
  // U30F8: the commands of $(...), <(...), >(...) and here-document backticks run too -- split as pipelines of their own
  const nested: string[] = [];
  let expectStdinFile = false;
  let skipNext = false;
  const endToken = () => {
    if (started) {
      if (skipNext) skipNext = false;
      else if (expectHereString) {
        stdin = tok; // U30F8 (G6-1): cmd <<< word -- the word is stdin
        expectHereString = false;
      } else if (expectStdinFile) {
        stdinFile = tok;
        expectStdinFile = false;
      } else argv.push(tok);
    }
    tok = "";
    started = false;
  };
  const endSegment = () => {
    endToken();
    if (argv.length || stdin !== null) {
      const seg: MutableSegment = { argv, stdin, stdinFile };
      pipeline.push(seg);
      for (const h of pendingHeredocs) if (h.seg === null) h.seg = seg;
    }
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
    // U30F9 (G8-4): GitHub Actions `${{ expression }}` is one value, whatever the expression holds (before, the first `}`
    // closed it and the second stayed in the token, so `bash -c "${{ inputs.cmd }}"` was no value-program)
    if (s[i + 1] === "{" && s[i + 2] === "{") {
      const end = s.indexOf("}}", i + 3);
      return [dyn(s.slice(i + 3, end < 0 ? s.length : end)), end < 0 ? s.length : end + 2];
    }
    if (s[i + 1] === "(") {
      let depth = 0;
      for (let j = i + 1; j < s.length; j += 1) {
        if (s[j] === "(") depth += 1;
        else if (s[j] === ")") {
          depth -= 1;
          if (depth === 0) {
            if (s[i + 2] !== "(") nested.push(s.slice(i + 2, j));
            return [dyn(""), j + 1];
          }
        }
      }
      if (s[i + 2] !== "(") nested.push(s.slice(i + 2));
      return [dyn(""), s.length];
    }
    if (s[i + 1] === "{") {
      const end = s.indexOf("}", i + 2);
      return [dyn(s.slice(i + 2, end < 0 ? s.length : end)), end < 0 ? s.length : end + 1];
    }
    const m = /^[A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)?/.exec(s.slice(i + 1));
    if (m) return [dyn(m[0].replace(/^env:/i, "")), i + 1 + m[0].length];
    // U30F6 (F5-1): a positional or special parameter ($1..$9, $@, $*, $#, $?, $$, $!, $0, $-) is a value too
    if (/^[0-9@*#?$!-]/.test(s.slice(i + 1, i + 2))) return [dyn(s[i + 1]!), i + 2];
    return null;
  };
  /** U30F8 (G6-1): the body of an unquoted here-document as the shell expands it -- every expansion is a value. */
  const expandBody = (body: string): string => {
    let out = "";
    let j = 0;
    while (j < body.length) {
      const ch = body[j]!;
      if (ch === "\\" && (body[j + 1] === "$" || body[j + 1] === "`" || body[j + 1] === "\\")) {
        out += body[j + 1];
        j += 2;
        continue;
      }
      if (ch === "$") {
        const v = readVariable(body, j);
        if (v) {
          out += v[0];
          j = v[1];
          continue;
        }
      }
      if (ch === "`") {
        const end = body.indexOf("`", j + 1);
        nested.push(body.slice(j + 1, end < 0 ? body.length : end));
        out += dyn("");
        j = end < 0 ? body.length : end + 1;
        continue;
      }
      out += ch;
      j += 1;
    }
    return out;
  };
  /** U30F8 (G6-1): <(...) / >(...) -- process substitution, a file the text does not hold; returns the index after it. */
  const skipParens = (str: string, open: number): number => {
    let depth = 0;
    for (let j = open; j < str.length; j += 1) {
      if (str[j] === "(") depth += 1;
      else if (str[j] === ")") {
        depth -= 1;
        if (depth === 0) return j + 1;
      }
    }
    return str.length;
  };
  /**
   * U30F9 (G8-1): `...` outside a here-document is a command substitution like $(...): its command runs (split as a pipeline
   * of its own) and its output is a value. A backtick with no closing one is text (a PowerShell `n in a string).
   */
  const readBacktick = (str: string, i: number): [string, number] | null => {
    const end = str.indexOf("`", i + 1);
    if (end < 0) return null;
    nested.push(str.slice(i + 1, end));
    return [dyn(""), end + 1];
  };
  /** U30F9: `{{ ... }}` is a template placeholder (Taskfile, Helm, Go templates): a value the text does not hold. */
  const readTemplate = (str: string, i: number): [string, number] | null => {
    if (!str.startsWith("{{", i)) return null;
    const end = str.indexOf("}}", i + 2);
    return [dyn("template"), end < 0 ? str.length : end + 2];
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
        if (s[j] === "`") {
          const b = readBacktick(s, j);
          if (b) {
            tok += b[0];
            j = b[1];
            continue;
          }
        }
        if (s[j] === "$") {
          const v = readVariable(s, j);
          if (v) {
            tok += v[0];
            j = v[1];
            continue;
          }
        }
        if (s[j] === "%" || s[j] === "!") {
          const m = cmdVariable(s.slice(j));
          if (m) {
            tok += dyn(m[1]);
            j += m[0].length;
            continue;
          }
        }
        if (s[j] === "{") {
          const t = readTemplate(s, j);
          if (t) {
            tok += t[0];
            j = t[1];
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
      if (pendingHeredocs.length > 0) {
        // the bodies follow in the order the markers stood; each goes to the segment that opened it
        let consumed = i + 1;
        for (const h of pendingHeredocs.splice(0)) {
          const lines = s.slice(consumed).split("\n");
          const body: string[] = [];
          let found = false;
          for (const line of lines) {
            consumed += line.length + 1;
            if (line.replace(/\r$/, "").trim() === h.delim) {
              found = true;
              break;
            }
            body.push(line.replace(/\r$/, ""));
          }
          const text = h.expand ? expandBody(body.join("\n")) : body.join("\n");
          if (h.seg) h.seg.stdin = text;
          else stdin = text;
          if (!found) {
            consumed = s.length;
            break;
          }
        }
        endPipeline();
        i = Math.min(consumed, s.length);
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
      if (s[i + 1] === "(") {
        tok += dyn("");
        started = true;
        const end = skipParens(s, i + 1);
        nested.push(s.slice(i + 2, Math.max(i + 2, end - 1)));
        i = end;
        continue;
      }
      if (s[i + 1] === "<") {
        if (s[i + 2] === "<") {
          expectHereString = true;
          i += 3;
          continue;
        }
        const m = /^<<-?\s*(\\?)(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/.exec(s.slice(i));
        if (m) {
          pendingHeredocs.push({ delim: m[3]!, expand: m[1] === "" && m[2] === "", seg: null });
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
    if (c === ">" && s[i + 1] === "(") {
      endToken();
      tok += dyn("");
      started = true;
      const end = skipParens(s, i + 1);
      nested.push(s.slice(i + 2, Math.max(i + 2, end - 1)));
      i = end;
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
    if (c === "`") {
      const b = readBacktick(s, i);
      if (b) {
        tok += b[0];
        started = true;
        i = b[1];
        continue;
      }
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
    if (c === "%" || c === "!") {
      const m = cmdVariable(s.slice(i));
      if (m) {
        tok += dyn(m[1]);
        started = true;
        i += m[0].length;
        continue;
      }
    }
    if (c === "{") {
      const t = readTemplate(s, i);
      if (t) {
        tok += t[0];
        started = true;
        i = t[1];
        continue;
      }
    }
    tok += c;
    started = true;
    i += 1;
  }
  endPipeline();
  for (const inner of nested) pipelines.push(...(splitCommandLine(inner) as MutableSegment[][]));
  return pipelines;
}

function toolBaseName(arg: string): string {
  const t = arg.trim().replace(/^["']+|["']+$/g, "");
  const parts = t.split(/[\\/]/);
  return asciiLower(parts[parts.length - 1] ?? "");
}

/**
 * A value of a specification table by OWN key only: a program named `constructor` or `__proto__` must
 * not resolve to Object.prototype members (U30F2 H1; the Python dict and PowerShell Dictionary bindings
 * never did).
 */
function ownEntry<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

/**
 * U30F4REP1: grouping glued to a token is not part of its name. Leading openers `(`, `{`, `@(` and `@{`
 * (any run: `((psql`) and trailing closers `)` / `}` at the absolute end (`psql)`, `psql}`).
 */
function unwrapGrouping(arg: string): string {
  return arg.replace(/^(?:@?[({])+/, "").replace(/[)}]+$/, "");
}

/** The DB/GIS tool an argument names, by file name or by a dynamic value's variable name. */
export function toolOf(arg: string): string | null {
  const spec = classificationSpec().commands;
  // U30G814F4 (F-4): grouping glued to the program is no part of its name -- openers `(psql`, `((psql`, `{psql`,
  // `@(psql` (sh/cmd subshell or group, PowerShell script block / array subexpression) and closers `psql)` / `psql}`
  const unwrapped = unwrapGrouping(arg);
  const hint = dynamicHint(unwrapped);
  const names = Object.keys(spec.tools).sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  if (hint !== null) {
    const h = asciiLower(hint);
    for (const name of names) {
      const bare = name.replace(/\.py$/, "");
      if (spec.tools[name] !== "GDAL" && spec.tools[name] !== "PRISMA" && h.includes(bare)) return spec.tools[name]!;
    }
    return null;
  }
  const base = toolBaseName(unwrapped);
  const direct = ownEntry(spec.tools, base);
  if (direct) return direct;
  for (const suffix of spec.tool_suffixes) {
    const stripped = base.endsWith(suffix) ? ownEntry(spec.tools, base.slice(0, -suffix.length)) : undefined;
    if (stripped) return stripped;
  }
  return null;
}

/** A program's file name, lower-cased, without a tool suffix (.exe, .cmd, ...). */
function programName(arg: string): string {
  let base = toolBaseName(arg);
  for (const suffix of classificationSpec().commands.tool_suffixes) if (base.endsWith(suffix)) base = base.slice(0, -suffix.length);
  return base;
}

function shellWrapper(arg: string): { flags: readonly string[]; restOfLine: boolean } | null {
  const spec = classificationSpec().commands;
  const base = programName(arg);
  const flags = ownEntry(spec.shell_wrappers, base);
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
  /**
   * U30G814 (G8-14): the segment runs with a connection the text does not hold -- an earlier assignment statement of the
   * text, or the env prefix of the enclosing shell / remote shell / program, set a connection variable to such a value.
   */
  readonly connection: boolean;
}

/**
 * U30G814 (G8-14): the environment assignment at argv[i] -- `NAME=value` (an sh env prefix; an argument of env, sudo,
 * cross-env, docker -e; a bare, export, declare or cmd set statement) or PowerShell `$env:NAME=value` / `$env:NAME = value`
 * (the placeholder of `$env:NAME` carries NAME as its hint; the rest of the statement is the value) -- or null.
 */
function envAssignmentAt(argv: readonly string[], i: number): { name: string; value: string; next: number } | null {
  const t = argv[i];
  if (t === undefined) return null;
  const plain = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/.exec(t);
  if (plain) return { name: plain[1]!, value: plain[2]!, next: i + 1 };
  const spec = classificationSpec();
  if (!t.startsWith(`${spec.dynamic_placeholder_open}:`)) return null;
  const end = t.indexOf(spec.dynamic_placeholder_close);
  if (end < 0) return null;
  // (any name: a segment of assignments only is a statement whatever else it assigns -- round 2, fail-closed)
  const name = t.slice(spec.dynamic_placeholder_open.length + 1, end);
  const after = t.slice(end + spec.dynamic_placeholder_close.length);
  if (after.startsWith("=")) {
    const value = after.slice(1);
    return value !== "" ? { name, value, next: i + 1 } : { name, value: argv.slice(i + 1).join(" "), next: argv.length };
  }
  if (after === "" && argv[i + 1] !== undefined && argv[i + 1]!.startsWith("=")) {
    return { name, value: [argv[i + 1]!.slice(1), ...argv.slice(i + 2)].join(" "), next: argv.length };
  }
  return null;
}

/** U30G814 (G8-14): the assignment chooses the connection (case-insensitive: Windows reads its environment so) with a value the text does not hold. */
function dynamicConnection(a: { name: string; value: string } | null): boolean {
  return a !== null && containsDynamic(a.value) && classificationSpec().commands.connection_env_variables.some((v: string) => asciiLower(v) === asciiLower(a.name));
}

/** U30G814 (G8-14): an env prefix of argv[k] -- an assignment among argv[0..k-1] -- chooses the connection dynamically. */
function dynamicConnectionPrefix(argv: readonly string[], k: number): boolean {
  const before = argv.slice(0, k);
  return before.some((_a, n) => dynamicConnection(envAssignmentAt(before, n)));
}

/**
 * U30G814 (G8-14): the segment runs no program and only assigns (after `{` / `(` and an assignment word: export, declare -x,
 * cmd set ...), and one assignment chooses the connection dynamically: every later command of the text runs with it.
 */
function setsDynamicConnection(argv: readonly string[]): boolean {
  const words = classificationSpec().commands.env_assignment_words;
  let i = 0;
  while (argv[i] === "{" || argv[i] === "(") i += 1;
  if (argv[i] !== undefined && words.includes(asciiLower(argv[i]!))) {
    i += 1;
    while (argv[i] !== undefined && argv[i]!.startsWith("-")) i += 1;
  }
  let found = false;
  while (i < argv.length) {
    const a = envAssignmentAt(argv, i);
    if (a === null) return false;
    if (dynamicConnection(a)) found = true;
    i = a.next;
  }
  return found;
}

const GENERATORS = new Set(["SHP2PGSQL", "PG_DUMP", "PG_RESTORE", "OGR2OGR"]);

function readFileOrUnresolved(out: { targets: WriteTarget[]; unresolved: UnresolvedWrite[] }, path: string, options: ClassifierOptions, depth: number): void {
  const text = containsDynamic(path) ? null : (options.readSqlFile?.(path) ?? null);
  if (text === null) {
    out.unresolved.push({ operation: "PSQL_FILE", reason: `SQL file ${path} is not available to the classifier` });
    return;
  }
  merge(out, depth > classificationSpec().sql.max_nesting ? { targets: [], unresolved: [{ operation: "PARSE", reason: "nesting" }] } : analyzeSql(text, options));
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
      return analyzeOgr2ogrArgs(rest, options);
    case "OGRINFO":
      for (const v of flagValues(rest, spec.ogrinfo.sql_flags, true).values) {
        if (v.trim().startsWith("@")) out.unresolved.push({ operation: "DYNAMIC_SQL", reason: "ogrinfo -sql @file" });
        else merge(out, analyzeSql(v, options));
      }
      return out;
    case "PSQL": {
      let hasSql = false;
      for (let i = 0; i < rest.length; i += 1) {
        const a = rest[i]!;
        if (spec.psql.command_flags.includes(a)) {
          hasSql = true;
          if (i + 1 < rest.length) merge(out, analyzeSql(rest[i + 1]!, options));
          else out.unresolved.push({ operation: "PSQL_STDIN", reason: "psql -c without a command" });
          i += 1;
        } else if (a.startsWith("--command=")) {
          hasSql = true;
          merge(out, analyzeSql(a.slice("--command=".length), options));
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
        if (ctx.stdin !== null) merge(out, analyzeSql(ctx.stdin, options));
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
    // U30F3 M-2: destructive database CLI entry points
    // U30F6 (F5-5): pgbench runs the SQL of each -f/--file script (name@weight); its builtin scripts write only pgbench_* tables
    case "PGBENCH": {
      const files = flagValues(rest, spec.pgbench.file_flags).values;
      for (const a of rest) if (asciiLower(a).startsWith("--file=")) files.push(a.slice("--file=".length));
      for (const f of files) readFileOrUnresolved(out, f.replace(/@[0-9]+$/, ""), options, depth);
      return out;
    }
    case "DROPDB":
      out.unresolved.push({ operation: "DROP_DATABASE", reason: "dropdb drops a whole database, every protected relation in it" });
      return out;
    case "LOADER":
      out.unresolved.push({ operation: "COMMAND", reason: "a loader (pgloader, osm2pgsql, qgis_process) writes relations, or runs SQL, that its arguments do not name statically" });
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

/**
 * U30F9 default-deny: whether this invocation of a DB/GIS tool can write a database at all -- decided by the tool's own
 * explicit flags, never by what a value might hold. A pg_dump writes nothing unless it pipes into psql; ogrinfo writes only
 * through -sql and never in read-only mode (-ro); a GDAL raster tool writes a database only through a PG: datasource or a
 * database (or unknown) output format; ogr2ogr only when its output is a database (the ogr2ogr analysis's `database`);
 * prisma only through `migrate` and `db`. Every other tool (psql, usql, pgbench, pg_restore, shp2pgsql, dropdb, loaders) is.
 */
function writeCapable(tool: string, rest: readonly string[], ctx: SegmentContext): boolean {
  const spec = classificationSpec();
  const exemptUnless = ownEntry(spec.commands.non_literal_exempt_tools_unless_piped_to, tool);
  if (exemptUnless !== undefined) return ctx.pipesToTool === exemptUnless;
  if (tool === "OGRINFO") {
    const lower = rest.map((a) => asciiLower(a.trim()));
    return spec.commands.ogrinfo.sql_flags.some((f) => lower.includes(f)) && !spec.commands.ogrinfo.read_only_flags.some((f) => lower.includes(f));
  }
  if (tool === "GDAL") {
    // (the format values are read for a placeholder BEFORE lower-casing: a placeholder is recognised in its own spelling only)
    const given = flagValues(rest, spec.ogr2ogr.format_flags, true).values;
    const formats = given.map((f) => asciiLower(f.trim()));
    const positional = rest.filter((a) => !a.startsWith("-"));
    const destination = positional[positional.length - 1];
    return (
      rest.some(isPgDatasource) ||
      given.some((f) => containsDynamic(f)) ||
      formats.some((f) => spec.ogr2ogr.database_formats.includes(f) || f.includes("postgis")) ||
      // no format named: the tool infers it from the destination -- a destination the text does not hold may be PG:
      (given.length === 0 && destination !== undefined && containsDynamic(destination))
    );
  }
  if (tool === "OGR2OGR") return analyzeOgr2ogrArgs(rest).database;
  if (tool === "PRISMA") {
    const words = rest.filter((a) => !a.startsWith("-")).map(asciiLower);
    return spec.commands.prisma.database_subcommands.includes(words[0] ?? "");
  }
  return true;
}

function analyzeArgvAt(argv: readonly string[], ctx: SegmentContext, options: ClassifierOptions, depth: number): WriteAnalysis {
  const out = emptyAnalysis();
  if (depth > classificationSpec().sql.max_nesting) {
    out.unresolved.push({ operation: "COMMAND", reason: "command nesting deeper than the classifier reads" });
    return out;
  }
  // U30F5 (D-5): a DB tool (or a shell) run by xargs / parallel / find -exec takes arguments from the runner's input
  const runners = classificationSpec().commands.argument_substituting_runners;
  const runnerAt = argv.findIndex((a) => runners.includes(programName(a)));
  const substituted = (k: number, what: string) => {
    if (runnerAt >= 0 && runnerAt < k) out.unresolved.push({ operation: "COMMAND", reason: `${what} run by ${programName(argv[runnerAt]!)} takes arguments from its input` });
  };
  const commands = classificationSpec().commands;
  /**
   * U30F9 default-deny (owner decision 2026-10-03): a DB-capable tool run with ANY value the text does not hold -- in an
   * argument, on its stdin or as its stdin file -- is NON_LITERAL, whatever the other arguments say. The exempt tools
   * (pg_dump) write nothing unless they pipe into the named tool.
   */
  const nonLiteral = (tool: string, program: string, rest: readonly string[], connection: boolean) => {
    if (!writeCapable(tool, rest, ctx)) return;
    if (containsDynamic(program) || rest.some((a) => containsDynamic(a)) || (ctx.stdin !== null && containsDynamic(ctx.stdin)) || (ctx.stdinFile !== null && containsDynamic(ctx.stdinFile))) {
      out.unresolved.push({ operation: "NON_LITERAL", reason: `${tool.toLowerCase()} runs with a value the text does not hold (default-deny: a non-literal program, argument, stdin or stdin file)` });
    } else if (connection) {
      out.unresolved.push({ operation: "NON_LITERAL", reason: `${tool.toLowerCase()} connects where an environment assignment the text does not hold points it (G8-14: a connection variable before the tool)` });
    }
  };
  // U30G814 (G8-14): what argv[k] inherits -- the connection of the text so far, or an env prefix of its own
  const connectionAt = (k: number) => ctx.connection || dynamicConnectionPrefix(argv, k);
  for (let k = 0; k < argv.length; k += 1) {
    const wrapper = shellWrapper(argv[k]!);
    if (wrapper) {
      const at = argv.findIndex((a, n) => n > k && wrapper.flags.includes(asciiLower(a)));
      if (at >= 0 && at + 1 < argv.length) {
        substituted(k, "a shell command");
        const command = wrapper.restOfLine ? argv.slice(at + 1).map(requote).join(" ") : argv[at + 1]!;
        // U30F6 (F5-1): a shell running a command whose program is a value (bash -c "$1", cmd /c %1) runs what the text does not hold
        if (splitCommandLine(command).some((pipeline) => pipeline.some((seg) => seg.argv[0] !== undefined && dynamicHint(seg.argv[0]) !== null))) {
          out.unresolved.push({ operation: "COMMAND", reason: "a shell runs a command the text does not hold" });
        }
        merge(out, analyzeCommandAt(command, options, depth + 1, null, null, connectionAt(k)));
        return out;
      }
      // U30F8 (G6-1): a shell fed a here-document / here-string runs it as its script when it names none
      if (ctx.stdin !== null) {
        if (!argv.slice(k + 1).some((a) => !a.startsWith("-"))) merge(out, analyzeCommandAt(ctx.stdin, options, depth + 1, null, null, connectionAt(k)));
        else if (containsDynamic(ctx.stdin)) out.unresolved.push({ operation: "COMMAND", reason: "a script reads a here-document with values the text does not hold" });
        return out;
      }
      continue;
    }
    // U30F9 (G8-5): a remote shell (ssh) runs the words after its destination as a command line on the other host -- with
    // this segment's stdin -- or, without a command, its stdin as the remote shell's script
    const remote = ownEntry(commands.remote_shells, programName(argv[k]!));
    if (remote) {
      let n = k + 1;
      while (n < argv.length && argv[n]!.startsWith("-") && argv[n] !== "--") {
        if (remote.value_flags.includes(argv[n]!)) n += 1;
        n += 1;
      }
      if (argv[n] === "--") n += 1;
      const words = argv.slice(n + 1);
      if (words.length > 0) {
        substituted(k, "a remote command");
        // (the words are re-quoted: `psql -c "TRUNCATE env.sgu_well"` stays one -c value on the other host too)
        merge(out, analyzeCommandAt(words.map(requote).join(" "), options, depth + 1, ctx.stdin, ctx.stdinFile, connectionAt(k)));
      } else if (ctx.stdin !== null) merge(out, analyzeCommandAt(ctx.stdin, options, depth + 1, null, null, connectionAt(k)));
      else if (ctx.stdinFile !== null) out.unresolved.push({ operation: "COMMAND", reason: "a remote shell reads its script from a file the text does not hold" });
      return out;
    }
    const tool = toolOf(argv[k]!);
    if (tool) {
      substituted(k, tool.toLowerCase());
      nonLiteral(tool, argv[k]!, argv.slice(k + 1), connectionAt(k));
      merge(out, analyzeTool(tool, argv.slice(k + 1), ctx, options, depth));
      return out;
    }
    const name = programName(argv[k]!);
    // U30F9 (G8-12): a code runner of a language no binding reads (ruby, perl, php) given code -- an option (-e, -pe, -r),
    // a script file (a path or a name with an extension), stdin or a stdin file -- runs code the classifier cannot read
    if (commands.unread_code_runners.includes(name)) {
      const given = argv.slice(k + 1).some((a) => a.startsWith("-") || /[\\/]/.test(a) || /\.[A-Za-z0-9]+$/.test(a) || containsDynamic(a));
      if (given || ctx.stdin !== null || ctx.stdinFile !== null) {
        out.unresolved.push({ operation: "COMMAND", reason: `${name} runs code the classifier does not read` });
        return out;
      }
    }
    // U30F8 (G6-1/G6-7): code from a flag value (node -e, python -c) or from an expanded here-document / here-string
    const codeFlags = ownEntry(commands.code_runners, name);
    if (codeFlags) {
      for (let n = k + 1; n < argv.length; n += 1) {
        const lower = asciiLower(argv[n]!);
        const flag = codeFlags.find((f) => lower === f || lower.startsWith(`${f}=`));
        if (flag === undefined) continue;
        const code = lower === flag ? argv[n + 1] : argv[n]!.slice(flag.length + 1);
        if (code !== undefined && containsDynamic(code)) out.unresolved.push({ operation: "COMMAND", reason: `${programName(argv[k]!)} evaluates code the text does not hold` });
        break;
      }
      if (ctx.stdin !== null && containsDynamic(ctx.stdin)) out.unresolved.push({ operation: "COMMAND", reason: `${programName(argv[k]!)} reads a here-document with values the text does not hold` });
      continue;
    }
    if (commands.eval_words.includes(programName(argv[k]!)) && argv.slice(k + 1).some((a) => containsDynamic(a))) {
      out.unresolved.push({ operation: "COMMAND", reason: `${programName(argv[k]!)} evaluates code the text does not hold` });
    }
  }
  // A dynamic or unknown binary whose arguments are those of a GDAL write.
  const flagSet = new Set(argv.map((a) => asciiLower(a.trim())));
  const ogrSpec = classificationSpec().ogr2ogr;
  if (ogrSpec.layer_name_flags.some((f) => flagSet.has(f)) || ogrSpec.sql_flags.some((f) => flagSet.has(f)) || argv.some(isPgDatasource)) {
    nonLiteral("OGR2OGR", argv[0] ?? "", argv.slice(1), ctx.connection);
    merge(out, analyzeOgr2ogrArgs(argv.slice(1), options));
    return out;
  }
  // Arguments that are themselves command lines (a wrapper this table does not know).
  argv.forEach((a, n) => {
    if (/\s/.test(a) && Object.keys(classificationSpec().commands.tools).some((name) => asciiLower(a).includes(name))) {
      merge(out, analyzeCommandAt(a, options, depth + 1, null, null, connectionAt(n)));
    }
  });
  return out;
}

/**
 * `inheritedStdin` (U30F9, G8-5): the stdin a remote shell (ssh) hands its remote command -- the first segment of the first
 * pipeline reads it when the command names no stdin of its own.
 */
function analyzeCommandAt(
  command: string,
  options: ClassifierOptions,
  depth: number,
  inheritedStdin: string | null = null,
  inheritedStdinFile: string | null = null,
  inheritedConnection = false,
): WriteAnalysis {
  const out = emptyAnalysis();
  let first = true;
  // U30G814 (G8-14): a connection chosen by a value the text does not hold -- inherited, or set by an assignment statement
  // earlier in the text (`export PGHOST="$H"; psql ...`, PowerShell `$env:PGDATABASE = $db; psql ...`) -- holds for the rest
  let connection = inheritedConnection;
  for (const pipeline of splitCommandLine(command)) {
    const tools = pipeline.map((seg) => {
      for (const a of seg.argv) {
        const t = toolOf(a);
        if (t) return t;
      }
      return null;
    });
    pipeline.forEach((seg, n) => {
      // U30F8 (G6-7): in a command line the shell expands the program: one that is a value ("$@", exec "$@", $CMD) runs
      // what the text does not hold (an argument vector handed to the gate at run time holds real values)
      const prefix = classificationSpec().commands.program_prefix_words;
      const p = seg.argv.findIndex((a) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(a) && !prefix.includes(asciiLower(a)));
      if (p >= 0 && dynamicHint(seg.argv[p]!) !== null && !toolOf(seg.argv[p]!)) out.unresolved.push({ operation: "COMMAND", reason: "the program is a value the text does not hold" });
      const inherits = first && n === 0 && seg.stdin === null && seg.stdinFile === null;
      const stdin = inherits ? inheritedStdin : seg.stdin;
      const stdinFile = inherits ? inheritedStdinFile : seg.stdinFile;
      merge(out, analyzeArgvAt(seg.argv, { stdin, stdinFile, pipedFromTool: n > 0 ? tools[n - 1]! : null, pipesToTool: tools[n + 1] ?? null, connection }, options, depth));
      if (setsDynamicConnection(seg.argv)) connection = true;
    });
    first = false;
  }
  return out;
}

/** What a command line writes (every pipeline, every segment). */
export function analyzeCommandLine(command: string, options: ClassifierOptions = {}): WriteAnalysis {
  return analyzeCommandAt(command, options, 0);
}

/** What an argument vector (argv[0] = the program) writes. */
export function analyzeCommandArgv(argv: readonly string[], options: ClassifierOptions = {}): WriteAnalysis {
  return analyzeArgvAt(argv, { stdin: null, stdinFile: null, pipedFromTool: null, pipesToTool: null, connection: false }, options, 0);
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
