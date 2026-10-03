/**
 * U30F2 H1 (PRES-05) -- the protected-write CHANNEL inventory: default deny.
 *
 * The U30F inventory looked for destructive KEYWORDS near protected NAMES and missed 23 of the 31
 * verifier canaries (SQL in a variable, a line break, upper case, a .cmd file, a test/ directory, a
 * name from a registry, pg_restore, shp2pgsql, ...). This scanner asks the other question: through
 * which CHANNEL can a file write a database relation, and what does that channel's payload write?
 *
 * Channels (every scanned file, every language):
 *   SQL_CALL   a database client call: pg/node-postgres .query, Prisma $queryRaw/$executeRaw and their
 *              *Unsafe twins (call or tagged template), postgres.js sql.unsafe, knex .raw, pg-promise
 *              methods, psycopg .execute/.executemany/.copy_expert/.copy_from, pandas/geopandas
 *              .to_sql/.to_postgis, ADO.NET .ExecuteNonQuery;
 *   PROCESS    a process call: child_process spawn/exec*, execa, zx $``, Python subprocess/os.system,
 *              PowerShell & / Invoke-Expression / Start-Process, and every command line of a shell,
 *              cmd, Dockerfile, YAML (CI, compose, cloudbuild), TOML or package.json script -- read by
 *              the gate's own command classifier (ogr2ogr, ogrinfo -sql, psql -c/-f/stdin/heredoc,
 *              pg_restore, pg_dump | psql, shp2pgsql, GDAL on PG:, prisma migrate reset/db push/execute,
 *              shell wrappers bash -c / cmd /c / pwsh -Command);
 *   SQL_FILE   a *.sql file (psql -f, prisma migrate, spatial-bootstrap or a script can run it);
 *   SQL_TEXT   EVERY string literal of a scanned source (after folding concatenations, template and
 *              f-string interpolations, here-strings, line continuations): SQL kept in a variable, a
 *              constant, an array or a config value is read where it is written, whichever channel it
 *              later reaches.
 *
 * A payload is read the way the protected relation gate reads it at run time (ProtectedWriteClassifier:
 * tokenised SQL with comments, quoting, case folding and dynamic SQL; the shared protected-relations
 * definition). Each site gets a verdict:
 *   PROTECTED     it statically writes a protected relation (never listable: gate it or retire it);
 *   UNRESOLVABLE  it writes, but its target is not static (TRUNCATE ${table}, psql -f $file);
 *   DYNAMIC       the payload is not in the source (a parameter, a file read at run time, a program
 *                 chosen at run time, a statement whose verb is interpolated).
 * A payload inside a gate call (gatedSql, assertSqlWriteAllowed, assertCommandWriteAllowed,
 * assertOgr2ogrWriteAllowed, assertOgr2ogrCommandAllowed, and the Python/PowerShell twins), or bound to
 * a variable that is passed to one, is refused at run time when protected and is not reported. A
 * payload that is statically ALLOWED (reads, or writes no protected relation) is not reported either.
 *
 * Pure: reads files, runs no process, opens no connection. The policy (what may be listed, the
 * reviewed list and its lock) lives in protectedRelationGateInventory.test.ts and
 * protectedWriteChannels.reviewed.ts.
 */
import fs from "node:fs";
import path from "node:path";
import {
  analyzeCommandArgv,
  analyzeCommandLine,
  analyzeSql,
  judgeWrites,
  splitCommandLine,
  tokenizeSql,
  toolOf,
  type WriteAnalysis,
  type WriteVerdict,
} from "../../packages/spatial-provider-postgis/src/ProtectedWriteClassifier";
import { classificationSpec, containsDynamic, dynamicHint, dynamicPlaceholder } from "../../packages/spatial-provider-postgis/src/ProtectedRelationSpec";
import { PROTECTED_RELATIONS, type ProtectedRelationsDefinition } from "../../packages/spatial-provider-postgis/src/ProtectedRelations";

// =============================================================================================
// Results
// =============================================================================================

export type SiteKind = "SQL_TEXT" | "SQL_CALL" | "PROCESS" | "SQL_FILE";
export type SiteVerdict = "PROTECTED" | "UNRESOLVABLE" | "DYNAMIC";

export interface ChannelSite {
  readonly file: string;
  readonly line: number;
  readonly kind: SiteKind;
  /** The channel: a call name (pg.query, $executeRawUnsafe, spawn, subprocess.run), a tool (psql) or the file kind. */
  readonly channel: string;
  /** The site's source text, whitespace collapsed (the identity a reviewed entry pins). */
  readonly excerpt: string;
  readonly verdict: SiteVerdict;
  /** Protected writes, unresolved operations, or why the payload is dynamic. */
  readonly detail: string;
}

export interface FileScan {
  readonly file: string;
  readonly language: Language;
  /** Sites that are PROTECTED, UNRESOLVABLE or DYNAMIC (gated and ALLOWED ones are only counted). */
  readonly sites: ChannelSite[];
  readonly counts: { channels: number; gated: number; allowed: number; literals: number };
  /**
   * U30F5 (D-1): the files this file's commands run (an interpreter's script, a sourced or directly executed file),
   * with the language they are run as (null: executed directly, by its shebang). The inventory scans each as that
   * language, whatever its extension, and a launched test source is no test source any more.
   */
  readonly launches: Launch[];
}

/** U30F5 (D-1): a file a command runs. `file` is as written (repository-relative or relative to the launcher). */
export interface Launch {
  readonly file: string;
  readonly lang: Language | null;
  /** The command that runs it. */
  readonly via: string;
  /** U30F6 (F5-3): `python -m <file>` -- a module name (dots as slashes): `<file>.py` or `<file>/__main__.py`. */
  readonly module?: boolean;
  /**
   * U30F6 (F5-4): `file` is the static tail of a path whose directory is dynamic ("$DIR/x/y.sh" -> "x/y.sh"): every
   * repository file ending in it may be the one run, and each is scanned as run; none -> an unresolved launch.
   */
  readonly suffix?: boolean;
  /** U30F6 (F5-2/F5-3): `file` is a package a runtime preloads (node -r/--import <specifier>): never a repository file. */
  readonly package?: boolean;
}

export type Language = "js" | "py" | "ps" | "sh" | "cmd" | "sql" | "yaml" | "toml" | "docker" | "json";

export interface ScanOptions {
  readonly definition?: ProtectedRelationsDefinition;
  /** psql -f / prisma db execute --file: read a repository file (repo-relative or relative to the scanned file). */
  readonly readRepoFile?: (repoRelative: string) => string | null;
  /** U30F5 (D-1): scan the file as this language (the one it is launched as), not by its extension. */
  readonly language?: Language;
}

// =============================================================================================
// Which files, which language
// =============================================================================================

/** The language a repository path is scanned as, or null when it is not scanned. */
export function languageOf(rel: string): Language | null {
  const base = rel.split("/").pop()!;
  const lower = base.toLowerCase();
  if (lower === "package.json") return "json";
  if (/^dockerfile(\..+)?$/.test(lower) || lower.endsWith(".dockerfile")) return "docker";
  if (/^(\.vscode|\.claude|\.devcontainer)\//.test(rel) && /\.jsonc?$/.test(lower)) return "json";
  const ext = path.extname(lower);
  switch (ext) {
    case ".ts":
    case ".tsx":
    case ".mts":
    case ".cts":
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "js";
    case ".py":
      return "py";
    case ".ps1":
    case ".psm1":
      return "ps";
    case ".sh":
    case ".bash":
    case ".zsh":
      return "sh";
    case ".bat":
    case ".cmd":
      return "cmd";
    case ".sql":
    case ".psql":
    case ".pgsql":
      return "sql";
    case ".yml":
    case ".yaml":
      return "yaml";
    case ".toml":
      return "toml";
    default:
      return null;
  }
}

// =============================================================================================
// Payload classification (the gate's classifier)
// =============================================================================================

interface TextVerdict {
  readonly verdict: "ALLOWED" | "PROTECTED" | "UNRESOLVABLE";
  readonly detail: string;
}

const ALLOWED: TextVerdict = { verdict: "ALLOWED", detail: "" };

let triggerRe: RegExp | null = null;
function hasTriggerWord(text: string): boolean {
  triggerRe ??= new RegExp(`(^|[^A-Za-z0-9_])(${classificationSpec().sql.trigger_words.join("|")})(?![A-Za-z0-9_])`, "i");
  return triggerRe.test(text);
}

let toolRe: RegExp | null = null;
function mentionsTool(text: string): boolean {
  const spec = classificationSpec().commands;
  const names = [...Object.keys(spec.tools), ...Object.keys(spec.shell_wrappers)].map((n) => n.replace(/[.]/g, "\\."));
  toolRe ??= new RegExp(`(^|[^A-Za-z0-9_])(${names.join("|")})(?![A-Za-z0-9_])`, "i");
  return toolRe.test(text) || containsDynamic(text);
}

function verdictOf(v: WriteVerdict): TextVerdict {
  if (v.verdict === "PROTECTED") return { verdict: "PROTECTED", detail: [...new Set(v.protectedWrites.map((p) => `${p.operation} ${p.relation}`))].sort().join(", ") };
  if (v.verdict === "UNRESOLVABLE") return { verdict: "UNRESOLVABLE", detail: [...new Set(v.unresolved.map((u) => u.operation))].sort().join(", ") };
  return ALLOWED;
}

function worst(a: TextVerdict, b: TextVerdict): TextVerdict {
  const rank = { ALLOWED: 0, UNRESOLVABLE: 1, PROTECTED: 2 } as const;
  if (rank[b.verdict] > rank[a.verdict]) return b;
  if (rank[b.verdict] === rank[a.verdict] && b.verdict !== "ALLOWED" && a.detail !== b.detail) {
    return { verdict: a.verdict, detail: [...new Set([...a.detail.split(", "), ...b.detail.split(", ")])].sort().join(", ") };
  }
  return a;
}

type SqlTokens = ReturnType<typeof tokenizeSql>["tokens"];

/** More than one token: a lone 'UPDATE' or 'TRUNCATE' (an enum value, an HTTP verb) is a word, not a statement. */
function statementLike(tokens: SqlTokens): boolean {
  return tokens.filter((t) => t.t !== "SEMI").length >= 2;
}

/**
 * U30F3 H-1: texts holding the fold-cap mark stand for values the scan did not enumerate. They are judged with
 * the mark read as a dynamic value (an enumerated protected write stays PROTECTED) and are at least
 * UNRESOLVABLE (FOLD_CAP_EXCEEDED): never ALLOWED, never skipped as "not SQL".
 */
function withFoldCap(texts: readonly string[], judge: (texts: string[]) => TextVerdict | null): TextVerdict | null {
  if (!texts.some(hasFoldCap)) return judge([...texts]);
  const stand = dyn("fold_cap");
  const v = judge(texts.map((t) => t.split(foldCapMark()).join(stand)));
  const capped: TextVerdict = { verdict: "UNRESOLVABLE", detail: FOLD_CAP_EXCEEDED };
  return v ? worst(v, capped) : capped;
}

/** A SQL text as the gate reads it, or null when it holds no SQL write vocabulary. */
function classifySqlText(text: string, def: ProtectedRelationsDefinition): TextVerdict | null {
  return withFoldCap([text], ([t]) => classifySqlTextUncapped(t!, def));
}

function classifySqlTextUncapped(text: string, def: ProtectedRelationsDefinition): TextVerdict | null {
  if (!hasTriggerWord(text)) return null;
  const { tokens, error } = tokenizeSql(text);
  if (!error && !statementLike(tokens)) return null;
  return verdictOf(judgeWrites(analyzeSql(text, { ungated: true }), def));
}

/** Statement verbs: a literal whose first token is one of these reads as SQL, not as prose about SQL. */
const SQL_VERBS = new Set([
  "truncate", "drop", "delete", "insert", "update", "merge", "copy", "alter", "create", "refresh", "reassign", "import",
  "execute", "select", "with", "do", "begin", "set", "reset", "grant", "revoke", "comment", "call", "explain", "vacuum",
  "analyze", "analyse", "reindex", "cluster", "lock", "prepare", "start", "commit", "rollback", "savepoint", "release",
  "declare", "values", "table", "listen", "notify", "discard", "load", "checkpoint", "show", "fetch", "move", "close",
  "security", "abort", "end",
]);

/**
 * The literal reads as SQL: its first token is a statement verb, a dynamic value, a parenthesis or a psql
 * meta command. A log line ('[setup] TRUNCATE core.property_unit'), an error message ('Refusing: DROP ...')
 * or a UI label ('Update GCP_SERVICE_URL variable', 'Execute declared proof') is prose, not a statement
 * PostgreSQL would run. Applied to the literal surface only: a channel payload is judged in full.
 */
function sqlShaped(text: string): boolean {
  const { tokens, error } = tokenizeSql(text);
  if (error) {
    const m = /^\s*([A-Za-z_]+)/.exec(text.replace(/^(\s*(--[^\n]*\n|\/\*[\s\S]*?\*\/))*/, ""));
    return m !== null && SQL_VERBS.has(m[1]!.toLowerCase());
  }
  let at = 0;
  // (U30F3 M-2, V28: a statement after a leading `;` is still a statement)
  while (tokens[at]?.t === "DYN" || tokens[at]?.t === "SEMI") at += 1;
  const first = tokens[at];
  if (!first) return false;
  if (first.t === "META") return true;
  if (first.t === "LPAREN") {
    const next = tokens[at + 1];
    // a parenthesised query: (SELECT ...), (WITH ...), (VALUES ...), (TABLE t)
    return next !== undefined && next.t === "WORD" && ["select", "with", "values", "table"].includes(next.v);
  }
  if (first.t !== "WORD" || !SQL_VERBS.has(first.v)) return false;
  if (first.v === "import" && !(tokens[at + 1]?.t === "WORD" && tokens[at + 1]!.v === "foreign")) return false;
  if (first.v === "update" && !tokens.some((t) => t.t === "WORD" && t.v === "set")) return false;
  if (first.v === "execute") {
    const next = tokens[at + 1];
    const after = tokens[at + 2];
    if (!next) return false;
    if (next.t === "STRING" || next.t === "DYN") return true;
    if (next.t !== "WORD") return false;
    return next.v === "format" || !after || after.t === "SEMI" || after.t === "LPAREN" || (after.t === "OP" && after.v === "||") || (after.t === "WORD" && (after.v === "using" || after.v === "into"));
  }
  return true;
}

/**
 * The literal surface: a string that reads as SQL is classified as SQL; a string that is a whole command line
 * (a tool and its arguments, not a bare tool path) counts only when it is PROTECTED -- an unresolvable command
 * is judged where it is run (the exec/spawn/psql channel), not where its text is assembled.
 */
function classifyLiteral(text: string, def: ProtectedRelationsDefinition, readSqlFile: (p: string) => string | null): TextVerdict | null {
  return withFoldCap([text], ([t]) => classifyLiteralUncapped(t!, def, readSqlFile));
}

function classifyLiteralUncapped(text: string, def: ProtectedRelationsDefinition, readSqlFile: (p: string) => string | null): TextVerdict | null {
  let v: TextVerdict | null = null;
  if (hasTriggerWord(text) && sqlShaped(text)) v = classifySqlText(text, def);
  if (mentionsTool(text) && /\s/.test(text.trim())) {
    LITERAL_DEPTH += 1;
    try {
      const c = classifyCommandText(text, def, readSqlFile);
      if (c && c.verdict === "PROTECTED") v = v ? worst(v, c) : c;
    } finally {
      LITERAL_DEPTH -= 1;
    }
  }
  return v;
}

/** A command line as the gate reads it, or null when it names no DB/GIS tool or shell wrapper. */
function classifyCommandText(text: string, def: ProtectedRelationsDefinition, readSqlFile: (p: string) => string | null): TextVerdict | null {
  return withFoldCap([text], ([t]) => classifyCommandTextUncapped(t!, def, readSqlFile));
}

/**
 * U30F3 M-2 (V64): a container command that destroys a volume -- `docker|podman compose ... down -v|--volumes`,
 * `docker volume rm|prune`, `docker system prune --volumes`, `docker [container] rm -v` -- removes every relation
 * the database volume holds. No SQL and no database tool is involved, so the gate never sees it: the inventory
 * judges it UNRESOLVABLE (VOLUME_DESTROY).
 */
function destroysVolume(argv: readonly string[]): boolean {
  const p = argv.findIndex((a) => /^(docker|podman|docker-compose|podman-compose)$/.test(programBase(a)));
  if (p < 0) return false;
  const rest = argv.slice(p + 1).map((a) => a.toLowerCase());
  const has = (...xs: string[]) => xs.some((x) => rest.includes(x));
  const volumesFlag = rest.some((a) => a === "-v" || a === "--volumes" || a.startsWith("--volumes="));
  const compose = /-compose$/.test(programBase(argv[p]!)) || has("compose");
  if (compose && has("down") && volumesFlag) return true;
  const vi = rest.indexOf("volume");
  if (vi >= 0 && ["rm", "remove", "prune"].includes(rest[vi + 1] ?? "")) return true;
  const si = rest.indexOf("system");
  if (si >= 0 && rest[si + 1] === "prune" && volumesFlag) return true;
  const ri = rest.findIndex((a) => a === "rm");
  return ri >= 0 && (ri === 0 || rest[ri - 1] === "container") && volumesFlag;
}

const VOLUME_DESTROY: TextVerdict = { verdict: "UNRESOLVABLE", detail: "VOLUME_DESTROY" };

function classifyCommandTextUncapped(text: string, def: ProtectedRelationsDefinition, readSqlFile: (p: string) => string | null): TextVerdict | null {
  // U30F5 (D-1/D-2): what the command runs besides DB tools -- launched files (recorded) and inline code (scanned)
  const extra = commandExtrasVerdict(splitCommandLine(text).flat().map((seg) => seg.argv), text, def, readSqlFile);
  const gate = classifyCommandTextGate(text, def, readSqlFile);
  return extra ? (gate ? worst(gate, extra) : extra) : gate;
}

function classifyCommandTextGate(text: string, def: ProtectedRelationsDefinition, readSqlFile: (p: string) => string | null): TextVerdict | null {
  if (/\b(docker|podman)/i.test(text) && splitCommandLine(text).flat().some((seg) => destroysVolume(seg.argv))) return VOLUME_DESTROY;
  if (!mentionsTool(text)) return null;
  const v = verdictOf(judgeWrites(analyzeCommandLine(text, { readSqlFile, ungated: true }), def));
  if (v.verdict === "ALLOWED") return v;
  // every segment that names a tool only looks it up (`which psql && echo ok`)
  const segments = splitCommandLine(text).flat().filter((seg) => seg.argv.some((a) => toolOf(a)));
  if (segments.length > 0 && segments.every((seg) => lookupOnly(seg.argv))) return ALLOWED;
  return v;
}

function classifyArgv(argv: readonly string[], def: ProtectedRelationsDefinition, readSqlFile: (p: string) => string | null): TextVerdict {
  return (
    withFoldCap(argv, (a) => {
      const gate = destroysVolume(a) ? VOLUME_DESTROY : lookupOnly(a) ? ALLOWED : verdictOf(judgeWrites(analyzeCommandArgv(a, { readSqlFile, ungated: true }), def));
      // U30F5 (D-1/D-2): launched files and inline code of the argument vector
      const extra = commandExtrasVerdict([a], a.join(" "), def, readSqlFile);
      return extra ? worst(gate, extra) : gate;
    }) ?? ALLOWED
  );
}

// =============================================================================================
// U30F5 (D-1/D-2): what a command runs that the scan must read too
// =============================================================================================

/** Interpreters by the language they run a script as. */
const NODE_LIKE = new Set(["node", "nodejs", "tsx", "ts-node", "ts-node-esm", "bun", "deno", "vite-node", "esno", "esr", "babel-node", "sucrase-node", "swc-node"]);
const PYTHON_LIKE = /^(python[0-9.]*|py|pypy[0-9.]*)$/;
const SH_LIKE = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
const PS_LIKE = new Set(["pwsh", "powershell"]);
/** Package runners: the program they run is their first positional argument (npm/pnpm/yarn only after exec/x/dlx). */
const PKG_EXEC = new Set(["npx", "bunx", "pnpx"]);
const PKG_MANAGERS = new Set(["npm", "pnpm", "yarn"]);
const SUB_RUNNERS = new Set(["uv", "pipx", "poetry", "pdm", "hatch", "rye"]);
const ENV_RUNNERS = new Set(["dotenv", "cross-env", "env", "env-cmd"]);
const NODE_VALUE_FLAGS = new Set(["-r", "--require", "--import", "--loader", "--experimental-loader", "--preload", "-C", "--conditions", "--env-file", "--input-type", "--title", "--tsconfig"]);
/** U30F6 (F5-2): flags whose value is a module run before the script (node/tsx/ts-node -r, --import, --loader; bun --preload). */
const NODE_PRELOAD_FLAGS = new Set(["-r", "--require", "--import", "--loader", "--experimental-loader", "--preload"]);
/** Runtimes where -r means something else (deno: --reload; vite-node: --root). */
const NODE_PRELOAD_EXCEPT = new Set(["deno", "vite-node"]);
const NODE_INLINE_FLAGS = new Set(["-e", "--eval", "-p", "--print"]);
const PY_VALUE_FLAGS = new Set(["-W", "-X", "--check-hash-based-pycs"]);
const PKG_VALUE_FLAGS = new Set(["-p", "--package", "-c", "--call", "--prefix", "-w", "--workspace", "--filter", "-C", "--dir", "--cwd", "--with", "--python", "--project"]);
const PS_VALUE_FLAGS = /^-(executionpolicy|ep|workingdirectory|wd|configurationname|outputformat|of|inputformat|if|windowstyle|settingsfile|encodedarguments)$/;

/** A static argument that names a file (a path or a name with an extension), not a flag, URL or package. */
function namesFile(a: string): boolean {
  return a !== "" && !containsDynamic(a) && !a.startsWith("-") && !/^[a-z][a-z0-9+.-]*:\/\//i.test(a) && (/[\\/]/.test(a) || /\.[A-Za-z0-9]+$/.test(a));
}

function asLaunchPath(a: string): string {
  return a.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * U30F6 (F5-4): the static path after a path's last dynamic part when that part is whole directories
 * ("$DIR/x/y.sh" -> "x/y.sh", "$ROOT/../a/b.ps1" -> "a/b.ps1"); null when the file name itself is not in the source.
 */
function staticTail(a: string): string | null {
  const close = classificationSpec().dynamic_placeholder_close;
  const tail = a.slice(a.lastIndexOf(close) + close.length).replace(/\\/g, "/");
  if (!/^\/[^/]/.test(tail)) return null;
  const norm = path.posix.normalize(tail.slice(1)).replace(/^(\.\.\/)+/, "");
  return norm === "" || norm === "." || norm === ".." || norm.endsWith("/") ? null : norm;
}

/** A path into node_modules is a package's code (B3), not a repository file. */
const PACKAGE_PATH = /(^|[\\/])node_modules[\\/]/;
/** `node <...>/node_modules/tsx/dist/cli.mjs x` is `tsx x`; `node <...>/node_modules/.bin/<name> x` is `<name> x`. */
const PACKAGE_CLI = /(?:^|[\\/])node_modules[\\/](?:tsx[\\/]dist[\\/]cli\.m?js|\.bin[\\/]([A-Za-z0-9_.-]+))$/;

let launcherDirRe: RegExp | null = null;
/**
 * U30F6 (F5-4): a launch path under the launcher's own directory as PowerShell writes it (`$PSScriptRoot\x`, and
 * `Join-Path $PSScriptRoot 'x'`, which folds to the same) reads as `./x`: it resolves from the launcher's directory.
 * (The shell and cmd forms -- `$(dirname "$0")`, `%~dp0` -- are read so by anchorLauncherDir before the line is split.)
 */
function anchoredPath(a: string): string {
  if (!containsDynamic(a)) return a;
  if (!launcherDirRe) {
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const spec = classificationSpec();
    launcherDirRe = new RegExp(`^${esc(spec.dynamic_placeholder_open)}:PSScriptRoot${esc(spec.dynamic_placeholder_close)}(?:[\\\\/]|$)`, "i");
  }
  return a.replace(launcherDirRe, "./");
}

/**
 * U30F6 (F5-4): the launcher's directory written the usual shell ways -- `$(dirname "$0")`, `$(dirname
 * "${BASH_SOURCE[0]}")`, `$(cd "$(dirname "$0")" && pwd)`, `$(realpath "...")`, `${0%/*}` -- and cmd `%~dp0`, read as
 * `.`: a path built on it resolves from the launcher's directory. Every other dynamic part of a launch path stays
 * dynamic (judged DYNAMIC where it is run).
 */
export function anchorLauncherDir(text: string, lang: "sh" | "cmd"): string {
  if (lang === "cmd") return text.replace(/%~dp0\\?/gi, "./");
  if (!/\$\(|`|\$\{(?:0|BASH_SOURCE)/.test(text)) return text;
  const self = String.raw`(?:"\$0"|\$0|"\$\{0\}"|\$\{0\}|"\$\{BASH_SOURCE(?:\[0\])?\}"|\$\{BASH_SOURCE(?:\[0\])?\}|"\$BASH_SOURCE"|\$BASH_SOURCE)`;
  const dirname = new RegExp(String.raw`\$\(\s*dirname\s+(?:--\s+)?${self}\s*\)|\x60\s*dirname\s+(?:--\s+)?${self}\s*\x60`, "g");
  const staticArg = String.raw`(?:"([^"$\x60\\]*)"|([^\s"'$\x60;&|()<>]+))`;
  const cdPwd = new RegExp(String.raw`\$\(\s*cd\s+(?:--\s+)?${staticArg}\s*(?:(?:&>|>|2>)\s*\/dev\/null\s*)?&&\s*pwd(?:\s+-P)?\s*\)`, "g");
  const realpath = new RegExp(String.raw`\$\(\s*(?:realpath|readlink\s+-f)\s+${staticArg}\s*\)`, "g");
  let out = text;
  for (let guard = 0; guard < 4; guard += 1) {
    const before = out;
    out = out
      .replace(dirname, ".")
      .replace(/\$\{(?:0|BASH_SOURCE(?:\[0\])?)%\/\*\}/g, ".")
      .replace(cdPwd, (_m, q: string | undefined, b: string | undefined) => q ?? b ?? ".")
      .replace(realpath, (_m, q: string | undefined, b: string | undefined) => q ?? b ?? ".");
    if (out === before) break;
  }
  return out;
}

/** The first positional argument of `rest` from `from` on (flags and their values skipped), or -1. */
function firstPositional(rest: readonly string[], valueFlags: ReadonlySet<string>, from = 0): number {
  for (let i = from; i < rest.length; i += 1) {
    const a = rest[i]!;
    if (a === "--") continue;
    if (a.startsWith("-")) {
      if (valueFlags.has(a.split("=")[0]!) && !a.includes("=")) i += 1;
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(a)) continue;
    return i;
  }
  return -1;
}

interface CommandRuns {
  readonly launches: { file: string; lang: Language | null; module?: boolean; suffix?: boolean; package?: boolean }[];
  readonly inline: { lang: "js" | "py" | "ps"; code: string }[];
  /** U30F6 (F5-4): why a file it runs (a script, a sourced or preloaded file, the program itself) is at a path the source does not hold. */
  readonly dynamic: string[];
}

/**
 * U30F5 (D-1/D-2): the files one argument vector runs (an interpreter's script, a sourced file, a file executed
 * directly) and the code it evaluates inline (node -e / --eval / --print, deno eval, python -c, pwsh -Command), through
 * package runners (npx, npm exec, uv run, ...), environment wrappers and shell wrappers (bash -c, cmd /c: their command).
 * U30F6: a module a node-like runtime preloads (-r/--require/--import/--loader/--experimental-loader/--preload of a
 * file path) is run too (F5-2); a launch path the source does not hold -- after the launcher's own directory is read
 * ($PSScriptRoot here; $(dirname "$0"), %~dp0 in anchorLauncherDir) -- is reported in `dynamic` (F5-4).
 */
export function commandRuns(argv: readonly string[], depth = 0): CommandRuns {
  const out: CommandRuns = { launches: [], inline: [], dynamic: [] };
  if (depth > 4) return out;
  const p = programIndex(argv);
  if (p < 0) return out;
  const program = argv[p]!;
  // a program whose own name is chosen at run time is judged DYNAMIC by argvDynamic; a static name in a dynamic
  // directory ("$VENV/bin/python") is still that program
  if (programKind(program) === "DYNAMIC") return out;
  const base = interpreterOf(program) ?? programBase(program);
  const rest = argv.slice(p + 1);
  const add = (r: CommandRuns) => {
    out.launches.push(...r.launches);
    out.inline.push(...r.inline);
    out.dynamic.push(...r.dynamic);
  };
  const line = (command: string) => {
    for (const pipeline of splitCommandLine(command)) for (const seg of pipeline) add(commandRuns(seg.argv, depth + 1));
  };
  const code = (lang: "js" | "py" | "ps", value: string | undefined) => {
    if (value !== undefined && !containsDynamic(value)) out.inline.push({ lang, code: value });
  };
  /** A file the command runs as `lang` (null: executed directly): a launch, or DYNAMIC when its path is not in the source. */
  const launch = (raw: string, lang: Language | null, what: string) => {
    const a = anchoredPath(raw);
    if (PACKAGE_PATH.test(a)) return; // a package's code (B3)
    if (!containsDynamic(a)) {
      if (namesFile(a)) out.launches.push({ file: asLaunchPath(a), lang });
      return;
    }
    // a dynamic directory with a static file: resolved against the repository's files (F5-4); a dynamic name: DYNAMIC
    const tail = staticTail(a);
    if (tail !== null) out.launches.push({ file: tail, lang, suffix: true });
    else out.dynamic.push(`${what} at a path the source does not hold`);
  };
  if (NODE_LIKE.has(base)) {
    for (let i = 0; i < rest.length; i += 1) {
      const a = rest[i]!;
      if (a === "--") continue;
      if (a === "-") return out; // the script is stdin (a here-document the scan reads as text)
      const flag = a.split("=")[0]!;
      if (NODE_INLINE_FLAGS.has(flag)) {
        code("js", a.includes("=") ? a.slice(a.indexOf("=") + 1) : rest[i + 1]);
        return out;
      }
      if (a.startsWith("-")) {
        // U30F6 (F5-2): a preloaded module given as a file path runs before the script; a bare specifier
        // (ts-node/register, dotenv/config, tsx) is a package's code (B3)
        if (NODE_PRELOAD_FLAGS.has(flag) && !NODE_PRELOAD_EXCEPT.has(base)) {
          const value = a.includes("=") ? a.slice(a.indexOf("=") + 1) : rest[i + 1];
          if (value !== undefined) {
            const v = anchoredPath(value).replace(/^file:\/\/\/?(?=[A-Za-z]:|\/)/i, "");
            // a file path (or a path the source does not hold) is a launch; a bare specifier is a package's module --
            // unknown package code is no safe entry either: an unresolved launch, reviewed or failed (F5-3)
            if (/^(\.{1,2}[\\/]|[\\/]|[A-Za-z]:[\\/])/.test(v) || containsDynamic(v)) launch(v, "js", `${base} preloads a module`);
            else if (v !== "") out.launches.push({ file: v, lang: "js", package: true });
          }
        }
        if (NODE_VALUE_FLAGS.has(flag) && !a.includes("=")) i += 1;
        continue;
      }
      if ((base === "tsx" && a === "watch") || ((base === "bun" || base === "deno") && a === "run")) continue;
      if (base === "deno" && a === "eval") {
        code("js", rest[i + 1]);
        return out;
      }
      const cli = PACKAGE_CLI.exec(a);
      if (cli) {
        add(commandRuns([cli[1] ?? "tsx", ...rest.slice(i + 1)], depth + 1));
        return out;
      }
      launch(a, "js", `${base} runs a script`);
      return out;
    }
    return out;
  }
  if (PYTHON_LIKE.test(base)) {
    for (let i = 0; i < rest.length; i += 1) {
      const a = rest[i]!;
      if (a === "-c") {
        code("py", rest[i + 1]);
        return out;
      }
      if (a === "-") return out; // the script is stdin
      if (a === "-m") {
        const mod = rest[i + 1];
        if (mod !== undefined && containsDynamic(mod)) out.dynamic.push(`${base} -m runs a module the source does not hold`);
        else if (mod !== undefined && /^[A-Za-z_][A-Za-z0-9_.]*$/.test(mod)) out.launches.push({ file: mod.replace(/\./g, "/"), lang: "py", module: true });
        return out;
      }
      if (a.startsWith("-")) {
        if (PY_VALUE_FLAGS.has(a)) i += 1;
        continue;
      }
      launch(a, "py", `${base} runs a script`);
      return out;
    }
    return out;
  }
  if (SH_LIKE.has(base) || base === "source" || base === ".") {
    for (let i = 0; i < rest.length; i += 1) {
      const a = rest[i]!;
      if (a === "-c" && SH_LIKE.has(base)) {
        if (rest[i + 1] !== undefined) line(rest[i + 1]!);
        return out;
      }
      if ((a === "-s" || a === "-") && SH_LIKE.has(base)) return out; // the script is stdin
      if (a.startsWith("-") || a.startsWith("+")) {
        if (a === "-o" || a === "+o") i += 1;
        continue;
      }
      launch(a, "sh", SH_LIKE.has(base) ? `${base} runs a script` : `${base} reads a file`);
      return out;
    }
    return out;
  }
  if (PS_LIKE.has(base)) {
    for (let i = 0; i < rest.length; i += 1) {
      const a = rest[i]!.toLowerCase();
      if (a === "-file" || a === "-f") {
        if (rest[i + 1] !== undefined) launch(rest[i + 1]!, "ps", `${base} -File runs a script`);
        return out;
      }
      if (a === "-command" || a === "-c") {
        code("ps", rest.slice(i + 1).join(" ") || undefined);
        return out;
      }
      if (a.startsWith("-")) {
        if (PS_VALUE_FLAGS.test(a)) i += 1;
        continue;
      }
      launch(rest[i]!, "ps", `${base} runs a script`);
      return out;
    }
    return out;
  }
  if (base === "cmd") {
    const at = rest.findIndex((a) => /^\/[ck]$/i.test(a));
    if (at >= 0) line(rest.slice(at + 1).join(" "));
    return out;
  }
  if (PKG_EXEC.has(base)) {
    const i = firstPositional(rest, PKG_VALUE_FLAGS);
    if (i >= 0) add(commandRuns(rest.slice(i), depth + 1));
    return out;
  }
  if (PKG_MANAGERS.has(base)) {
    const i = firstPositional(rest, PKG_VALUE_FLAGS);
    if (i >= 0 && /^(exec|x|dlx)$/.test(rest[i]!)) {
      const j = firstPositional(rest, PKG_VALUE_FLAGS, i + 1);
      if (j >= 0) add(commandRuns(rest.slice(j), depth + 1));
    }
    return out;
  }
  if (SUB_RUNNERS.has(base)) {
    const i = firstPositional(rest, PKG_VALUE_FLAGS);
    if (i >= 0 && rest[i] === "run") {
      const j = firstPositional(rest, PKG_VALUE_FLAGS, i + 1);
      if (j >= 0 && /\.py$/i.test(rest[j]!)) launch(rest[j]!, "py", `${base} run runs a script`);
      else if (j >= 0) add(commandRuns(rest.slice(j), depth + 1));
    }
    return out;
  }
  if (ENV_RUNNERS.has(base)) {
    const dd = rest.indexOf("--");
    const i = dd >= 0 ? dd + 1 : firstPositional(rest, new Set(["-e", "-f", "-c", "-v", "--env", "--file"]));
    if (i >= 0 && i < rest.length) add(commandRuns(rest.slice(i), depth + 1));
    return out;
  }
  // a program that is itself a repository file, executed directly (by its shebang) -- U30F6 (F5-4): in a directory
  // the source does not hold, DYNAMIC (a DB/GIS tool there is judged as that tool)
  const direct = anchoredPath(program);
  if (/[\\/]/.test(direct) && !toolOf(direct)) launch(direct, null, `${base} is executed`);
  return out;
}

/** U30F5: launches recorded by the scan of the current file (module state, set by scanFile). */
let LAUNCH_COLLECTOR: Launch[] | null = null;
/** U30F5: the literal surface classifies a string that mentions a tool -- it runs nothing, so it launches nothing. */
let LITERAL_DEPTH = 0;
/** U30F5: inline code inside inline code is read this deep. */
let INLINE_DEPTH = 0;

/**
 * U30F5 (D-1/D-2): the launches of the command's argument vectors are recorded; its inline code is scanned as the
 * language it is (node -e: JS, python -c: Python, pwsh -Command: PowerShell) and judged like any file -- a DYNAMIC site
 * there makes the command UNRESOLVABLE.
 */
function commandExtrasVerdict(argvs: readonly (readonly string[])[], via: string, def: ProtectedRelationsDefinition, readSqlFile: (p: string) => string | null): TextVerdict | null {
  if (LITERAL_DEPTH > 0) return null;
  let v: TextVerdict | null = null;
  for (const argv of argvs) {
    const runs = commandRuns(argv);
    for (const l of runs.launches) {
      if (LAUNCH_COLLECTOR && !LAUNCH_COLLECTOR.some((x) => x.file === l.file && x.lang === l.lang)) LAUNCH_COLLECTOR.push({ ...l, via: norm(via) });
    }
    for (const inl of runs.inline) {
      const r = inlineVerdict(inl.code, inl.lang, def, readSqlFile);
      if (r) v = v ? worst(v, r) : r;
    }
  }
  return v;
}

function inlineVerdict(code: string, lang: "js" | "py" | "ps", def: ProtectedRelationsDefinition, readSqlFile: (p: string) => string | null): TextVerdict | null {
  if (INLINE_DEPTH >= 2) return { verdict: "UNRESOLVABLE", detail: `inline ${lang} code nested deeper than the scan reads` };
  INLINE_DEPTH += 1;
  try {
    const sites = scanEmbedded(code, lang, def, readSqlFile);
    let v: TextVerdict | null = null;
    for (const s of sites) {
      const one: TextVerdict = { verdict: s.verdict === "PROTECTED" ? "PROTECTED" : "UNRESOLVABLE", detail: `inline ${lang}: ${s.detail}` };
      v = v ? worst(v, one) : one;
    }
    return v;
  } finally {
    INLINE_DEPTH -= 1;
  }
}

/** U30F5 (D-2): the sites of code embedded in a command or a CI step, scanned as its language. */
function scanEmbedded(code: string, lang: Language, def: ProtectedRelationsDefinition, readSqlFile: (p: string) => string | null): Omit<ChannelSite, "file">[] {
  const sites: Omit<ChannelSite, "file">[] = [];
  const sub: SiteSink = { counts: { channels: 0, gated: 0, allowed: 0, literals: 0 }, add: (s) => sites.push(s) };
  const src = code.replace(/\r\n/g, "\n");
  if (lang === "js") scanJs(src, sub, def, readSqlFile);
  else if (lang === "py") scanPy(src, sub, def, readSqlFile);
  else if (lang === "ps") scanPs(src, sub, def, readSqlFile);
  else if (lang === "cmd") scanCommandScript(src, "cmd", sub, def, readSqlFile, {});
  else scanCommandScript(src, "sh", sub, def, readSqlFile, {});
  return sites;
}

/** The argv only looks a tool up (which/where/command -v/Get-Command), also inside `docker exec <container>`. */
function lookupOnly(argv: readonly string[]): boolean {
  let a = argv;
  for (let guard = 0; guard < 3; guard += 1) {
    const p = a.findIndex((x) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(x));
    if (p < 0) return false;
    const base = a[p]!.replace(/^["']+|["']+$/g, "").split(/[\\/]/).pop()!.toLowerCase().replace(/\.exe$/, "");
    if (LOOKUP_PROGRAMS.has(base)) return true;
    if (base === "docker" && a[p + 1] === "exec") {
      let i = p + 2;
      while (i < a.length && a[i]!.startsWith("-")) i += /^-(u|e|w|-user|-env|-workdir)$/.test(a[i]!) ? 2 : 1;
      a = a.slice(i + 1);
      continue;
    }
    return false;
  }
  return false;
}

/** A statement of the text starts with a dynamic value: its verb (what it does) is not in the source. */
function sqlVerbDynamic(textIn: string): boolean {
  // U30F3 H-1: values past the fold cap are judged UNRESOLVABLE (FOLD_CAP_EXCEEDED), not DYNAMIC -- so an
  // enumerated PROTECTED value of the same payload is never masked by a DYNAMIC verdict
  const text = hasFoldCap(textIn) ? textIn.split(foldCapMark()).join("") : textIn;
  const { tokens, error } = tokenizeSql(text);
  if (error) return false;
  let atStart = true;
  let any = false;
  for (const t of tokens) {
    if (t.t === "SEMI") {
      atStart = true;
      continue;
    }
    any = true;
    if (atStart && t.t === "DYN") return true;
    atStart = false;
  }
  return !any && containsDynamic(text);
}

/** A table value by OWN key only (`toString`, `constructor` are not channels). */
function own<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

function norm(s: string, max = 200): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

const dyn = (hint = ""): string => dynamicPlaceholder(hint);

/** A program value that is node itself (process.execPath) runs a scanned script, not a DB tool. */
function isNodeProgram(text: string): boolean {
  return interpreterOf(text) !== null;
}

/** The running interpreter (process.execPath = node, sys.executable = python), which runs a scanned script. */
function interpreterOf(text: string): "node" | "python" | null {
  const hint = dynamicHint(text);
  if (hint === null) return null;
  if (/^(process\.execPath|process\.argv0|process\.argv\.0)$/.test(hint)) return "node";
  if (/^sys\.executable$/.test(hint)) return "python";
  return null;
}

/** The last path segment of a program value, lower-cased, tool suffix (.exe, .cmd, ...) removed. */
function programBase(text: string): string {
  let b = text.trim().replace(/^["']+|["']+$/g, "").split(/[\\/]/).pop()!.toLowerCase();
  for (const suffix of classificationSpec().commands.tool_suffixes) if (b.endsWith(suffix)) b = b.slice(0, -suffix.length);
  return b;
}

/**
 * What a program value is: a known DB/GIS tool (by name, by path, or by a dynamic value's variable name), a
 * shell wrapper, a static other program, or DYNAMIC (chosen at run time). A path whose directory is dynamic
 * but whose file name is static (`$venv\Scripts\python.exe`) is judged by its file name.
 */
function programKind(text: string): "TOOL" | "SHELL" | "STATIC_OTHER" | "DYNAMIC" {
  if (toolOf(text)) return "TOOL";
  const base = programBase(text);
  // the placeholder is case-sensitive: judge dynamics on the file name as written, not lower-cased
  const rawBase = text.trim().replace(/^["']+|["']+$/g, "").split(/[\\/]/).pop()!;
  if (Object.prototype.hasOwnProperty.call(classificationSpec().commands.shell_wrappers, base) && !containsDynamic(rawBase)) return "SHELL";
  if (isNodeProgram(text)) return "STATIC_OTHER";
  if (containsDynamic(rawBase) || base === "") return "DYNAMIC";
  return "STATIC_OTHER";
}

/** Package runners and interpreters: they run the script or module named by their first positional argument. */
const RUNNERS = new Set(["npx", "npm", "pnpm", "yarn", "bunx", "bun", "tsx", "ts-node", "node", "python", "python3", "py", "uv", "pipx", "deno", "dotenv", "cross-env"]);
/** Runner flags that take a value. */
const RUNNER_VALUE_FLAGS = new Set(["-r", "--require", "--import", "--loader", "-e", "--eval", "-c", "-m", "--env-file", "-p", "--package", "--prefix", "-w", "--workspace", "--filter"]);
/** Words that open a shell construct, not a program. */
const SHELL_KEYWORDS = new Set(["then", "else", "elif", "fi", "do", "done", "!", "{", "}", "(", ")", "time", "export", "local", "readonly", "declare", "sudo", "exec", "nohup", "env", "call", "start", "function"]);
/** Programs that only LOOK UP a tool (`which psql`, `command -v ogr2ogr`): the tool is an argument, not run. */
const LOOKUP_PROGRAMS = new Set(["which", "where", "whereis", "type", "command", "get-command", "hash"]);

/** The index of the program in a segment's argv (assignments, keywords and option-like words skipped), or -1. */
function programIndex(argv: readonly string[]): number {
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (/^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(a)) continue; // VAR=value prefix / assignment
    if (SHELL_KEYWORDS.has(a.toLowerCase())) continue;
    if (a.startsWith("-") || a.startsWith("/") && /^\/[a-z]$/i.test(a)) return -1; // an option where a program would stand: a continuation
    if (/[(){}]$|^[(){}]/.test(a) || a.endsWith(";;")) return -1; // a case pattern, a subshell, a block
    return i;
  }
  return -1;
}

/**
 * Why an argument vector runs something the source does not determine, or null. Follows shell wrappers
 * (bash -c, cmd /c, pwsh -Command: the command they run), runners (npx/node/tsx/python: the script they
 * run) and `docker exec <container>`.
 */
function argvDynamic(argv: readonly string[], depth = 0): string | null {
  if (depth > 4) return "command nesting deeper than the scan reads";
  const p = programIndex(argv);
  if (p < 0) return null;
  const program = argv[p]!;
  const kind = programKind(program);
  if (kind === "DYNAMIC") return "the program is chosen at run time";
  // U30F6 (F5-4): a file it runs (a script, a sourced or preloaded file, the program itself) at a path the source does not hold
  const launchedAt = commandRuns(argv, depth).dynamic[0];
  if (launchedAt !== undefined) return launchedAt;
  const base = interpreterOf(program) ?? programBase(program);
  const rest = argv.slice(p + 1);
  const spread = rest.some((a) => (dynamicHint(a) ?? "").startsWith("..."));
  // (a runner is judged by its script below: a spread after a static script is that script's arguments)
  if (spread && (kind === "TOOL" || kind === "SHELL" || RUNS_OTHERS.has(base))) return `${base} with arguments spread from a value the source does not hold`;
  if (kind === "SHELL") {
    const flags = own(classificationSpec().commands.shell_wrappers, base) ?? [];
    const at = rest.findIndex((a) => flags.includes(a.toLowerCase()));
    if (at < 0) {
      const script = rest.find((a) => !a.startsWith("-"));
      return script !== undefined && dynamicHint(script) !== null ? `${base} runs a script the source does not hold` : null;
    }
    const restOfLine = classificationSpec().commands.shell_wrappers_rest_of_line.includes(base);
    const command = restOfLine ? rest.slice(at + 1).join(" ") : rest[at + 1];
    if (command === undefined || dynamicHint(command) !== null) return `${base} runs a command the source does not hold`;
    for (const pipeline of splitCommandLine(command)) {
      for (const seg of pipeline) {
        const r = argvDynamic(seg.argv, depth + 1);
        if (r) return r;
      }
    }
    return null;
  }
  if (base === "docker" && (rest[0] === "exec" || rest[0] === "run")) {
    let i = 1;
    while (i < rest.length && rest[i]!.startsWith("-")) i += /^-(u|e|w|-user|-env|-workdir|v|-volume|-name|-network|p)$/.test(rest[i]!) ? 2 : 1;
    if (i >= rest.length) return null;
    if (dynamicHint(rest[i]!) !== null && rest[0] === "run") return "docker runs an image the source does not hold";
    return argvDynamic(rest.slice(i + 1), depth + 1);
  }
  if (RUNNERS.has(base)) {
    for (let i = 0; i < rest.length; i += 1) {
      const a = rest[i]!;
      if (a === "--") continue;
      if (a === "-") return null; // the script is stdin (a here-document the scan reads as text)
      if (a.startsWith("-")) {
        const flag = a.split("=")[0]!;
        if (RUNNER_VALUE_FLAGS.has(flag) && !a.includes("=")) {
          const value = rest[i + 1];
          if (flag === "-e" || flag === "--eval" || flag === "-c" || flag === "-p") {
            return value !== undefined && dynamicHint(value) !== null ? `${base} evaluates code the source does not hold` : null;
          }
          i += 1;
        }
        continue;
      }
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(a)) continue; // cross-env FOO=bar
      if (dynamicHint(a) !== null) return `${base} runs a script the source does not hold`;
      if (RUNNERS.has(programBase(a)) || programKind(a) === "SHELL") return argvDynamic(rest.slice(i), depth + 1);
      return null; // a static script, module or package binary (scanned itself, or classified as a tool)
    }
    return null;
  }
  return null;
}

/** Why a command line runs something the source does not determine, or null. */
function commandDynamic(text: string): string | null {
  for (const pipeline of splitCommandLine(text)) {
    for (const seg of pipeline) {
      const r = argvDynamic(seg.argv);
      if (r) return r;
    }
  }
  return null;
}

/** An argument as command-line text the classifier's splitter reads back unchanged. */
function requote(a: string): string {
  if (a !== "" && !/[\s"'`$\\|&;<>()]/.test(a)) return a;
  let out = "";
  for (const c of a) out += c === '"' || c === "\\" || c === "`" || c === "$" ? `\\${c}` : c;
  return `"${out}"`;
}

/** An argument vector run with `stdin` text (spawnSync input:, subprocess input=): read as a here-document. */
function classifyArgvWithStdin(argv: readonly string[], stdin: string, def: ProtectedRelationsDefinition, readSqlFile: (p: string) => string | null): TextVerdict {
  const marker = "WU30F2_STDIN_EOF";
  return (
    withFoldCap([...argv, stdin], (parts) => {
      const command = `${parts.slice(0, -1).map(requote).join(" ")} <<'${marker}'\n${parts[parts.length - 1]}\n${marker}`;
      return verdictOf(judgeWrites(analyzeCommandLine(command, { readSqlFile, ungated: true }), def));
    }) ?? ALLOWED
  );
}

/**
 * Replace the dynamic values a preceding relation gate checked (assertUngovernedDestructiveWriteAllowed(...,
 * relation: x), assert_ungoverned_write_allowed(..., x), Assert-UngovernedWriteAllowed -Relation $x) by an
 * unprotected stand-in name. When the payload then reads ALLOWED, its only non-static targets are values the
 * gate refuses at run time when protected.
 */
function substituteGated(text: string, checked: readonly string[]): string {
  let out = text;
  checked.forEach((placeholder, n) => {
    out = out.split(placeholder).join(`gate_checked_relation_${n}`);
  });
  return out;
}

const RUNS_OTHERS = new Set(["docker", "ssh", "kubectl", "wsl", "xargs"]);

// =============================================================================================
// A small expression model shared by the JS, Python and PowerShell readers
// =============================================================================================

/** A source token. `str`: a string literal whose value is static text with dynamic placeholders. */
interface Tok {
  readonly k: "str" | "id" | "num" | "p" | "nl" | "re";
  readonly v: string;
  readonly pos: number;
  readonly end: number;
  readonly line: number;
  /** A newline separates this token from the previous one. */
  readonly nl: boolean;
  /** str: interpolated parts (template literal, f-string, "..." in PowerShell): text or expression tokens. */
  readonly parts?: readonly (string | { readonly src: string; readonly toks: Tok[] })[];
  /** str: a JS template literal. */
  readonly template?: boolean;
}

interface FoldContext {
  readonly src: string;
  readonly bindings: Map<string, Tok[][]>;
  /** Interpolations of a tagged SQL template are bind parameters, not SQL text. */
  readonly paramTemplates?: boolean;
  readonly lang: "js" | "py" | "ps";
  /** A repository file's text (readFileSync / read_text of a static repository path), or null. */
  readonly readRepoFile?: (p: string) => string | null;
  /**
   * JS/TS function scopes: a name resolves only to bindings visible where it is used, and a parameter of an
   * enclosing function shadows a same-named binding elsewhere in the file (`function run(sql) { pool.query(sql) }`
   * is DYNAMIC even when another function declares `const sql = 'SELECT 1'`). Python and PowerShell resolve by
   * name in the whole file.
   */
  readonly scopes?: readonly JsScope[];
}

interface JsScope {
  readonly id: number;
  readonly from: number;
  readonly to: number;
  readonly params: ReadonlySet<string>;
}

/** Every function scope of the token lists: parameter list through body, with the parameter names. */
function jsScopes(lists: readonly Tok[][]): JsScope[] {
  const out: JsScope[] = [];
  const bodyEnd = (list: readonly Tok[], at: number): number => {
    if (list[at]?.v === "{") return list[matchClose(list, at)]!.end;
    const e = jsExprEnd(list, at);
    return list[Math.max(at, e - 1)]?.end ?? list[at]?.end ?? 0;
  };
  for (const list of lists) {
    for (let k = 0; k < list.length; k += 1) {
      const t = list[k]!;
      if (t.k === "id" && list[k + 1]?.v === "=>" && list[k - 1]?.v !== ".") {
        out.push({ id: out.length, from: t.pos, to: bodyEnd(list, k + 2), params: new Set([t.v]) });
        continue;
      }
      if (t.k !== "p" || t.v !== "(") continue;
      const close = matchClose(list, k);
      let after = close + 1;
      if (list[after]?.v === ":") {
        let depth = 0;
        for (after += 1; after < list.length; after += 1) {
          const x = list[after]!;
          if (depth === 0 && (x.v === "=>" || x.v === "{")) break;
          // `{ query(sql: string): Promise<T> };` -- a method signature in a type, not a function
          if (depth <= 0 && (x.v === ";" || x.v === "}" || x.v === "," || x.v === ")")) break;
          if (isOpen(x) || x.v === "<") depth += 1;
          else if (isClose(x) || x.v === ">") depth -= 1;
        }
      }
      const prev = list[k - 1];
      const isArrow = list[after]?.v === "=>";
      const isBlock = list[after]?.v === "{" && !(prev?.k === "id" && /^(if|for|while|switch|with|return|typeof|await)$/.test(prev.v));
      if (!isArrow && !isBlock) continue;
      // over-approximated: every identifier of the parameter list (destructuring, types) shadows
      const params = new Set(list.slice(k + 1, close).filter((x) => x.k === "id").map((x) => x.v));
      out.push({ id: out.length, from: t.pos, to: bodyEnd(list, isArrow ? after + 1 : after), params });
    }
  }
  return out;
}

/** The scopes holding `pos`, innermost first. */
function scopesAt(scopes: readonly JsScope[], pos: number): JsScope[] {
  return scopes.filter((sc) => pos >= sc.from && pos < sc.to).sort((a, b) => a.to - a.from - (b.to - b.from));
}

/**
 * The bindings of `key` (a name, `elem:name`, `name.push`) visible at `refPos`, and whether a parameter of a
 * function enclosing `refPos` (inside the binding's own scope) shadows them.
 */
function visibleBindings(ctx: FoldContext, key: string, name: string, refPos: number): { bindings: Tok[][]; shadowed: boolean } {
  const all = ctx.bindings.get(key) ?? [];
  if (!ctx.scopes || refPos < 0) return { bindings: all, shadowed: false };
  const around = scopesAt(ctx.scopes, refPos);
  const visible: Tok[][] = [];
  let shadowed = false;
  for (const b of all) {
    const declPos = b[0]?.pos ?? -1;
    const declScope = scopesAt(ctx.scopes, declPos)[0] ?? null;
    if (declScope !== null && !around.includes(declScope)) continue; // declared in a function that does not enclose the use
    const inner = declScope === null ? around : around.slice(0, around.indexOf(declScope));
    if (inner.some((sc) => sc.params.has(name))) {
      shadowed = true;
      continue;
    }
    visible.push(b);
  }
  if (visible.length === 0 && around.some((sc) => sc.params.has(name))) shadowed = true;
  return { bindings: visible, shadowed };
}

function scopeKey(ctx: FoldContext, refPos: number): string {
  if (!ctx.scopes || refPos < 0) return "*";
  return String(scopesAt(ctx.scopes, refPos)[0]?.id ?? "top");
}

/**
 * U30F3 H-1 (U30F2-VERIFICATION H-1): the fold cap FAILS CLOSED. The cap bounds the work of folding an
 * expression into its possible values; it never decides what is judged. An expression with more possible
 * values than FOLD_MAX_TEXTS keeps the values it has enumerated and gains the fold-cap mark, a value that stands
 * for "values this scan did not enumerate". A text holding the mark is at least UNRESOLVABLE
 * (FOLD_CAP_EXCEEDED) on every surface and channel -- a site that needs a reviewed entry, never ALLOWED and
 * never dropped -- and stays PROTECTED when one of the enumerated values is. (Before U30F3 the 17th value and
 * later were discarded silently: a loop over 17 static tables hid the protected 17th, and the cap hid an
 * ungated CREATE of env.sgu_well / env.sgu_landslide_feature in scripts/import/import-sgu-risk-layers.ts.)
 */
export const FOLD_MAX_TEXTS = 1024;
const MAX_TEXTS = FOLD_MAX_TEXTS;
const MAX_DEPTH = 24;

/** The detail (operation) a site gets for values the fold did not enumerate. */
export const FOLD_CAP_EXCEEDED = "FOLD_CAP_EXCEEDED";
let foldCapMarkText: string | null = null;
/** A dynamic placeholder no source expression can produce (a hint never holds '#'). */
export function foldCapMark(): string {
  foldCapMarkText ??= `${classificationSpec().dynamic_placeholder_open}:#${FOLD_CAP_EXCEEDED}${classificationSpec().dynamic_placeholder_close}`;
  return foldCapMarkText;
}
function hasFoldCap(text: string): boolean {
  return text.includes(foldCapMark());
}

/** Distinct values, at most FOLD_MAX_TEXTS of them; past the cap (or any value already past it) the mark. */
function capTexts(values: Iterable<string>): string[] {
  const out = new Set<string>();
  let exceeded = false;
  for (const v of values) {
    if (hasFoldCap(v)) exceeded = true;
    else if (!out.has(v)) {
      if (out.size >= MAX_TEXTS) exceeded = true;
      else out.add(v);
    }
  }
  return exceeded ? [...out, foldCapMark()] : [...out];
}

/**
 * Folds of a name are memoised per file (per binding map): every literal that interpolates the same variable
 * reuses one result, and a name whose fold is in progress (`x = x + '...'`) reads as dynamic.
 */
const FOLD_MEMO = new WeakMap<Map<string, Tok[][]>, Map<string, Folded | null>>();
const FOLD_ACTIVE = new WeakMap<Map<string, Tok[][]>, Set<string>>();

function memoised<T extends Folded | null>(ctx: FoldContext, key: string, cycle: T, compute: () => T): T {
  let memo = FOLD_MEMO.get(ctx.bindings);
  if (!memo) FOLD_MEMO.set(ctx.bindings, (memo = new Map()));
  let active = FOLD_ACTIVE.get(ctx.bindings);
  if (!active) FOLD_ACTIVE.set(ctx.bindings, (active = new Set()));
  const k = `${ctx.paramTemplates ? "P" : "-"}${key}`;
  if (memo.has(k)) return memo.get(k) as T;
  if (active.has(k)) return cycle;
  active.add(k);
  try {
    const value = compute();
    memo.set(k, value);
    return value;
  } finally {
    active.delete(k);
  }
}

/** Every concatenation x + y (distinct), capped fail-closed: a combination past the cap or with a capped side is the mark. */
function product(a: readonly string[], b: readonly string[]): string[] {
  const out = new Set<string>();
  let exceeded = false;
  outer: for (const x of a) {
    for (const y of b) {
      if (hasFoldCap(x) || hasFoldCap(y)) {
        exceeded = true;
        continue;
      }
      const v = x + y;
      if (out.has(v)) continue;
      if (out.size >= MAX_TEXTS) {
        exceeded = true;
        break outer;
      }
      out.add(v);
    }
  }
  return exceeded ? [...out, foldCapMark()] : [...out];
}

function hintOf(toks: readonly Tok[], src: string): string {
  if (toks.length === 0) return "";
  return src.slice(toks[0]!.pos, toks[toks.length - 1]!.end).replace(/\s+/g, "");
}

function isOpen(t: Tok | undefined): boolean {
  return t?.k === "p" && (t.v === "(" || t.v === "[" || t.v === "{" || t.v === "@(" || t.v === "@{" || t.v === "$(");
}
function isClose(t: Tok | undefined): boolean {
  return t?.k === "p" && (t.v === ")" || t.v === "]" || t.v === "}");
}

/** Index of the bracket closing the one at i. */
function matchClose(toks: readonly Tok[], i: number): number {
  let depth = 0;
  for (let j = i; j < toks.length; j += 1) {
    if (isOpen(toks[j])) depth += 1;
    else if (isClose(toks[j])) {
      depth -= 1;
      if (depth === 0) return j;
    }
  }
  return toks.length - 1;
}

/** Split tokens at depth-0 separators. */
function splitTop(toks: readonly Tok[], isSep: (t: Tok) => boolean): Tok[][] {
  const out: Tok[][] = [];
  let cur: Tok[] = [];
  let depth = 0;
  for (const t of toks) {
    if (isOpen(t)) depth += 1;
    if (isClose(t)) depth -= 1;
    if (depth === 0 && isSep(t)) {
      out.push(cur);
      cur = [];
    } else cur.push(t);
  }
  out.push(cur);
  return out;
}

/** Index of the first depth-0 token matching, or -1. */
function topIndex(toks: readonly Tok[], match: (t: Tok) => boolean): number {
  let depth = 0;
  for (let i = 0; i < toks.length; i += 1) {
    const t = toks[i]!;
    if (isOpen(t)) depth += 1;
    else if (isClose(t)) depth -= 1;
    else if (depth === 0 && match(t)) return i;
  }
  return -1;
}

function stripParens(toks: Tok[]): Tok[] {
  let t = toks;
  while (t.length >= 2 && t[0]!.k === "p" && t[0]!.v === "(" && matchClose(t, 0) === t.length - 1) t = t.slice(1, -1);
  return t;
}

/** The static text of a string token, its interpolations folded (a single static text) or placeholders. */
function strText(t: Tok, ctx: FoldContext, depth: number): string {
  return strTexts(t, ctx, depth)[0]!;
}

/**
 * Every text a string token can hold: each interpolation folded (an expression with several static values --
 * a loop over a constant list, a ternary -- multiplies the texts; one the source does not determine becomes
 * the dynamic placeholder named after the expression).
 */
function strTexts(t: Tok, ctx: FoldContext, depth: number): string[] {
  if (!t.parts) return [t.v];
  let out = [""];
  for (const part of t.parts) {
    if (typeof part === "string") {
      out = out.map((o) => o + part);
      continue;
    }
    if (ctx.paramTemplates && !/\braw\s*\(|\bRaw\b|\bunsafe\b/i.test(part.src)) {
      out = out.map((o) => `${o}$1`);
      continue;
    }
    const folded = depth < MAX_DEPTH ? foldExpr(part.toks, ctx, depth + 1) : null;
    // (U30F3 H-1: values past the fold cap stay as the mark, so the enumerated values are still judged)
    const usable = folded !== null && folded.texts.length > 0 && folded.texts.every((x) => hasFoldCap(x) || !containsDynamic(x) || (x !== dynamicPlaceholder("") && dynamicHint(x) === null && folded.literal));
    out = product(out, usable ? folded!.texts : [dyn(part.src.replace(/\s+/g, ""))]);
  }
  return out;
}

interface Folded {
  /** Possible texts (string values with placeholders for what the source does not determine). */
  readonly texts: string[];
  /** Some part of the value is not a literal at all (a parameter, a call result). */
  readonly dynamic: boolean;
  /** The value holds at least one literal. */
  readonly literal: boolean;
}

const CONCAT = new Set(["+"]);

/** Fold an expression into its possible string values. */
function foldExpr(toksIn: readonly Tok[], ctx: FoldContext, depth = 0): Folded {
  const toks = stripParens(toksIn.filter((t) => t.k !== "nl"));
  if (toks.length === 0) return { texts: [dyn("")], dynamic: true, literal: false };
  // a ? b : c  /  b if c else d
  if (ctx.lang === "py") {
    const ifs = splitTop(toks, (t) => t.k === "id" && t.v === "if");
    if (ifs.length === 2) {
      const elses = splitTop(ifs[1]!, (t) => t.k === "id" && t.v === "else");
      if (elses.length === 2) return union(foldExpr(ifs[0]!, ctx, depth), foldExpr(elses[1]!, ctx, depth));
    }
  } else if (ctx.lang === "js") {
    const qi = topIndex(toks, (t) => t.k === "p" && t.v === "?");
    if (qi > 0) {
      let level = 0;
      let nested = 0;
      for (let i = qi + 1; i < toks.length; i += 1) {
        const t = toks[i]!;
        if (isOpen(t)) level += 1;
        else if (isClose(t)) level -= 1;
        else if (level === 0 && t.k === "p" && t.v === "?") nested += 1;
        else if (level === 0 && t.k === "p" && t.v === ":") {
          if (nested === 0) return union(foldExpr(toks.slice(qi + 1, i), ctx, depth), foldExpr(toks.slice(i + 1), ctx, depth));
          nested -= 1;
        }
      }
    }
    // a ?? b / a || b: either value
    const alt = splitTop(toks, (t) => t.k === "p" && (t.v === "??" || t.v === "||"));
    if (alt.length >= 2) return alt.map((a) => foldExpr(a, ctx, depth)).reduce(union);
  }
  const pieces = splitTop(toks, (t) => t.k === "p" && CONCAT.has(t.v));
  if (pieces.length > 1) {
    let texts = [""];
    let dynamic = false;
    let literal = false;
    for (const p of pieces) {
      const f = foldPiece(p, ctx, depth);
      texts = product(texts, f.texts);
      dynamic ||= f.dynamic;
      literal ||= f.literal;
    }
    return { texts, dynamic, literal };
  }
  return foldPiece(toks, ctx, depth);
}

function union(a: Folded, b: Folded): Folded {
  return { texts: capTexts([...a.texts, ...b.texts]), dynamic: a.dynamic || b.dynamic, literal: a.literal || b.literal };
}

function foldPiece(toksIn: readonly Tok[], ctx: FoldContext, depth: number): Folded {
  const toks = stripParens([...toksIn]);
  if (toks.length === 0) return { texts: [""], dynamic: false, literal: false };
  // adjacent string literals (Python implicit concatenation)
  if (toks.every((t) => t.k === "str")) {
    return { texts: toks.map((t) => strTexts(t, ctx, depth)).reduce((acc, x) => product(acc, x), [""]), dynamic: false, literal: true };
  }
  const first = toks[0]!;
  // 'x' % args / 'x'.format(...) / "x" -f $a: the template text (placeholders fail closed in the classifier)
  if (first.k === "str" && toks.length > 1) {
    const second = toks[1]!;
    if ((second.k === "p" && (second.v === "%" || second.v === ".")) || (second.k === "id" && second.v.toLowerCase() === "-f")) {
      if (!(second.v === "." && toks[2]?.k === "id" && toks[2]!.v === "join")) return { texts: strTexts(first, ctx, depth), dynamic: false, literal: true };
    }
  }
  // Prisma.sql`...` / sql`...`: a tagged SQL template (interpolations are bind parameters)
  if (ctx.lang === "js" && toks.length >= 2 && toks[toks.length - 1]!.k === "str" && toks[toks.length - 1]!.template) {
    const tag = toks.slice(0, -1).map((t) => t.v).join("");
    if (/^(Prisma\.sql|sql|\$queryRaw|\$executeRaw)$/.test(tag)) return { texts: strTexts(toks[toks.length - 1]!, { ...ctx, paramTemplates: true }, depth), dynamic: false, literal: true };
  }
  // Join-Path $a 'b' (PowerShell): the joined path (a dynamic directory keeps a static file name)
  if (ctx.lang === "ps" && toks[0]?.k === "id" && toks[0]!.v.toLowerCase() === "join-path") {
    let texts = [""];
    let first = true;
    for (let i = 1; i < toks.length; i += 1) {
      const t = toks[i]!;
      if (t.k === "id" && t.v.startsWith("-")) continue;
      let group: Tok[] = [t];
      if (isOpen(t)) {
        const close = matchClose(toks, i);
        group = toks.slice(i, close + 1);
        i = close;
      }
      const f = foldExpr(group, ctx, depth + 1);
      texts = product(texts, (f.texts.length ? f.texts : [dyn("")]).map((x) => (first ? x : `\\${x}`)));
      first = false;
    }
    return { texts, dynamic: false, literal: true };
  }
  // this.x / self.x / cls.x: the class member's binding
  if (toks.length === 3 && toks[0]!.k === "id" && /^(this|self|cls)$/.test(toks[0]!.v) && toks[1]!.v === "." && toks[2]!.k === "id") {
    return foldIdentifier(toks[2]!.v, ctx, depth, toks[2]!.pos);
  }
  // obj['k'] / cfg["table"]: the key of a dict / object literal
  if (toks.length === 4 && toks[0]!.k === "id" && toks[1]!.v === "[" && toks[2]!.k === "str" && !toks[2]!.parts && toks[3]!.v === "]") {
    const member = foldMember(toks[0]!.v, toks[2]!.v, ctx, depth, toks[0]!.pos);
    if (member) return member;
  }
  // obj.prop where obj is an object literal (or a loop over object literals)
  if (toks.length === 3 && toks[0]!.k === "id" && (toks[1]!.v === "." || toks[1]!.v === "?.") && toks[2]!.k === "id") {
    const member = foldMember(toks[0]!.v, toks[2]!.v, ctx, depth, toks[0]!.pos);
    if (member) return member;
  }
  // path.join(...) / path.resolve(...) / join(...) / os.path.join(...) / Path(...): joined path segments
  const call = callOf(toks);
  // fileURLToPath(new URL('./x.ts', import.meta.url)) / pathToFileURL(x) / path.normalize(x): the path itself
  if (call && /^(fileURLToPath|url\.fileURLToPath|pathToFileURL|path\.normalize|normalize|URL)$/.test(call.name) && call.args[0]) {
    return foldExpr(call.args[0], ctx, depth + 1);
  }
  if (call && /^((path|pathMod|nodePath|posix|win32|path\.posix|os\.path)\.(join|resolve)|join|resolve|Path|pathlib\.Path|str|String)$/.test(call.name)) {
    let texts = [""];
    call.args.forEach((arg, n) => {
      const f = foldExpr(arg, ctx, depth + 1);
      texts = product(texts, (f.texts.length ? f.texts : [dyn("")]).map((x) => (n === 0 ? x : `/${x}`)));
    });
    return { texts, dynamic: false, literal: call.args.length > 0 };
  }
  // readFileSync(<repository path>) / readFile / read_text: the file's text when the path is a repository file
  if (call && ctx.readRepoFile && /^(readFileSync|fs\.readFileSync|readFile|fs\.readFile|fsp\.readFile|fs\.promises\.readFile)$/.test(call.name) && call.args[0]) {
    const read = readRepositoryText(foldExpr(call.args[0], ctx, depth + 1).texts, ctx.readRepoFile);
    if (read !== null) return { texts: read, dynamic: false, literal: true };
  }
  if (ctx.lang === "py") {
    // a / 'b' (pathlib): the joined path
    const slash = splitTop(toks, (t) => t.k === "p" && t.v === "/");
    if (slash.length > 1 && slash.some((x) => x.length === 1 && x[0]!.k === "str")) {
      let texts = [""];
      slash.forEach((x, n) => {
        const f = foldExpr(x, ctx, depth + 1);
        texts = product(texts, (f.texts.length ? f.texts : [dyn("")]).map((y) => (n === 0 ? y : `/${y}`)));
      });
      return { texts, dynamic: false, literal: true };
    }
  }
  // ' '.join([...]) (Python) / [...].join(' ') (JS) / [...] -join ' ' (PowerShell)
  const joined = foldJoin(toks, ctx, depth);
  if (joined) return joined;
  if (toks.length === 1) {
    const t = toks[0]!;
    if (t.k === "str") return { texts: strTexts(t, ctx, depth), dynamic: false, literal: true };
    // PowerShell: a bare word (gcloud, tar.exe, -Force) is literal text; only $name is a variable
    if (ctx.lang === "ps" && t.k === "id" && !t.v.startsWith("$")) return { texts: [t.v], dynamic: false, literal: true };
    if (t.k === "id" || (ctx.lang === "ps" && t.v.startsWith("$"))) return foldIdentifier(t.v, ctx, depth, ctx.scopes ? t.pos : -1);
    if (t.k === "num") return { texts: [t.v], dynamic: false, literal: true };
  }
  // String(x) / str(x) / `${x}`.trim() and other calls: dynamic, named after the expression
  return { texts: [dyn(hintOf(toks, ctx.src))], dynamic: true, literal: toks.some((t) => t.k === "str") };
}

/** `name(args)` / `a.b.name(args)` / `new Name(args)` spanning all of `toks`, or null. */
function callOf(toks: readonly Tok[]): { name: string; args: Tok[][] } | null {
  let t = toks;
  if (t[0]?.k === "id" && (t[0]!.v === "new" || t[0]!.v === "await")) t = t.slice(1);
  let i = 0;
  const parts: string[] = [];
  while (i < t.length && (t[i]!.k === "id" || (t[i]!.k === "p" && t[i]!.v === "." && parts.length > 0))) {
    if (t[i]!.k === "id") parts.push(t[i]!.v);
    i += 1;
  }
  if (parts.length === 0 || t[i]?.v !== "(" || matchClose(t, i) !== t.length - 1) return null;
  const inner = t.slice(i + 1, -1);
  const args = inner.length === 0 ? [] : splitTop(inner, (x) => x.k === "p" && x.v === ",").map((a) => a.filter((x) => x.k !== "nl")).filter((a) => a.length > 0);
  return { name: parts.join("."), args };
}

/** The text of a repository file named by a folded path (a dynamic prefix such as process.cwd() or __dirname is dropped). */
function readRepositoryText(paths: readonly string[], read: (p: string) => string | null): string[] | null {
  const open = classificationSpec().dynamic_placeholder_open;
  const close = classificationSpec().dynamic_placeholder_close;
  const out: string[] = [];
  for (const raw of paths) {
    let p = raw.replace(/\\/g, "/");
    while (p.startsWith(open)) {
      const end = p.indexOf(close);
      if (end < 0) return null;
      p = p.slice(end + close.length).replace(/^\/+/, "");
      p = p.replace(/^(\.\.\/)+/, "");
    }
    if (containsDynamic(p) || p === "") return null;
    const text = read(p.replace(/^\.\//, ""));
    if (text === null) return null;
    out.push(text);
  }
  return out.length > 0 ? out : null;
}

function foldIdentifier(name: string, ctx: FoldContext, depth: number, refPos = -1): Folded {
  return memoised<Folded>(ctx, `id:${name}@${scopeKey(ctx, refPos)}`, { texts: [dyn(name)], dynamic: true, literal: false }, () => foldIdentifierUncached(name, ctx, depth, refPos));
}

function foldIdentifierUncached(name: string, ctx: FoldContext, depth: number, refPos: number): Folded {
  const unknown: Folded = { texts: [dyn(name)], dynamic: true, literal: false };
  const elems = visibleBindings(ctx, `elem:${name}`, name, refPos);
  if (elems.bindings.length > 0 && depth < MAX_DEPTH) {
    const all: Folded[] = [];
    for (const iterable of elems.bindings) {
      const els = elementToks(iterable, ctx, depth + 1);
      if (els === null || els.length === 0) return unknown;
      for (const el of els) all.push(foldExpr(el, ctx, depth + 1));
    }
    return all.reduce(union);
  }
  const bound = visibleBindings(ctx, name, name, refPos);
  if (bound.shadowed || elems.shadowed || bound.bindings.length === 0 || depth >= MAX_DEPTH) return unknown;
  const all = bound.bindings.map((b) => foldExpr(b, ctx, depth + 1));
  const folded = all.reduce(union);
  // a value that is wholly opaque keeps the variable's own name as its hint (OGRINFO_PATH names its tool)
  return { ...folded, texts: folded.texts.map((x) => (dynamicHint(x) !== null && !hasFoldCap(x) ? dyn(name) : x)) };
}

/** The element expressions of an iterable: an array literal, or an identifier bound to array literals (with pushes). */
function elementToks(toks: readonly Tok[], ctx: FoldContext, depth: number): Tok[][] | null {
  if (depth > MAX_DEPTH) return null;
  const t = stripParens(toks.filter((x) => x.k !== "nl"));
  if (t.length >= 2 && isOpen(t[0]) && (t[0]!.v === "[" || t[0]!.v === "@(") && matchClose(t, 0) === t.length - 1) {
    const inner = t.slice(1, -1);
    const out: Tok[][] = [];
    for (const el of splitTop(inner, (x) => x.k === "p" && x.v === ",")) {
      const e = el.filter((x) => x.k !== "nl");
      if (e.length === 0) continue;
      if (e[0]!.k === "p" && e[0]!.v === "...") {
        const spread = elementToks(e.slice(1), ctx, depth + 1);
        if (spread === null) return null;
        out.push(...spread);
        continue;
      }
      out.push(e);
    }
    return out;
  }
  // `X as const`, `X satisfies T`
  const asAt = t.findIndex((x) => x.k === "id" && (x.v === "as" || x.v === "satisfies"));
  if (asAt > 0) return elementToks(t.slice(0, asAt), ctx, depth);
  if (t.length === 1 && t[0]!.k === "id") {
    const bound = visibleBindings(ctx, t[0]!.v, t[0]!.v, t[0]!.pos);
    if (bound.shadowed || bound.bindings.length === 0) return null;
    const out: Tok[][] = [];
    for (const b of bound.bindings) {
      const els = elementToks(b, ctx, depth + 1);
      if (els === null) return null;
      out.push(...els);
    }
    for (const pushed of visibleBindings(ctx, `${t[0]!.v}.push`, t[0]!.v, t[0]!.pos).bindings) out.push(...splitTop(pushed, (x) => x.k === "p" && x.v === ",").filter((e) => e.length > 0));
    return out;
  }
  return null;
}

/** The value expression of `prop` in an object literal `{ ... }` (`prop: v`, `'prop': v`, shorthand `prop`), or null. */
function propertyToks(obj: readonly Tok[], prop: string): Tok[] | null {
  if (obj[0]?.v !== "{" || matchClose(obj, 0) !== obj.length - 1) return null;
  for (const entry of splitTop(obj.slice(1, -1), (x) => x.k === "p" && x.v === ",")) {
    const e = entry.filter((x) => x.k !== "nl");
    if (e.length === 1 && e[0]!.k === "id" && e[0]!.v === prop) return e;
    if (e.length >= 3 && (e[0]!.k === "id" || e[0]!.k === "str") && e[0]!.v === prop && e[1]!.v === ":") return e.slice(2);
  }
  return null;
}

/** `obj.prop` where obj is bound to object literals (or loops over them): the property's values, or null. */
function foldMember(objName: string, prop: string, ctx: FoldContext, depth: number, refPos = -1): Folded | null {
  return memoised<Folded | null>(ctx, `member:${objName}.${prop}@${scopeKey(ctx, refPos)}`, null, () => foldMemberUncached(objName, prop, ctx, depth, refPos));
}

function foldMemberUncached(objName: string, prop: string, ctx: FoldContext, depth: number, refPos: number): Folded | null {
  if (depth > MAX_DEPTH) return null;
  const objects: Tok[][] = [];
  const direct = visibleBindings(ctx, objName, objName, refPos);
  const loops = visibleBindings(ctx, `elem:${objName}`, objName, refPos);
  if (direct.shadowed || loops.shadowed) return null;
  for (const b of direct.bindings) {
    const o = stripParens(b.filter((x) => x.k !== "nl"));
    if (o[0]?.v !== "{") return null;
    objects.push(o);
  }
  for (const iterable of loops.bindings) {
    const els = elementToks(iterable, ctx, depth + 1);
    if (els === null) return null;
    for (const el of els) {
      const o = stripParens(el);
      if (o[0]?.v !== "{") return null;
      objects.push(o);
    }
  }
  if (objects.length === 0) return null;
  const folds: Folded[] = [];
  for (const o of objects) {
    const value = propertyToks(o, prop);
    if (value === null) return null;
    folds.push(foldExpr(value, ctx, depth + 1));
  }
  return folds.reduce(union);
}

/** Array elements of `[...]` / `@(...)`, one text each (an element with several values is dynamic), or null. */
function arrayElements(toks: readonly Tok[], ctx: FoldContext, depth: number): string[] | null {
  const alts = arrayAlternatives(toks, ctx, depth);
  return alts === null ? null : alts.map((a) => (a.length === 1 ? a[0]! : dyn("")));
}

/**
 * Array elements of `[...]` / `@(...)` with every value each can hold (`first ? '-overwrite' : '-append'`, a
 * loop variable over a constant list); spreads resolved through bindings and later pushes. Null when the array
 * is not in the source.
 */
function arrayAlternatives(toks: readonly Tok[], ctx: FoldContext, depth: number): string[][] | null {
  const t = stripParens([...toks]);
  if (t.length >= 2 && isOpen(t[0]) && (t[0]!.v === "[" || t[0]!.v === "@(") && matchClose(t, 0) === t.length - 1) {
    const inner = t.slice(1, -1);
    if (inner.length === 0) return [];
    const out: string[][] = [];
    for (const el of splitTop(inner, (x) => x.k === "p" && x.v === ",")) {
      const e = el.filter((x) => x.k !== "nl");
      if (e.length === 0) continue;
      if (e[0]!.k === "p" && e[0]!.v === "..." && e.length === 2 && e[1]!.k === "id") {
        const spread = resolveArrayAlternatives(e[1]!.v, ctx, depth + 1, e[1]!.pos);
        if (spread) out.push(...spread);
        else out.push([dyn(`...${e[1]!.v}`)]);
        continue;
      }
      if (e[0]!.k === "p" && (e[0]!.v === "..." || e[0]!.v === "*")) {
        out.push([dyn(hintOf(e, ctx.src))]);
        continue;
      }
      const f = foldExpr(e, ctx, depth + 1);
      out.push(f.texts.length > 0 ? f.texts : [dyn(hintOf(e, ctx.src))]);
    }
    return out;
  }
  if (t.length === 1 && (t[0]!.k === "id" || t[0]!.v.startsWith("$"))) return resolveArrayAlternatives(t[0]!.v, ctx, depth + 1, t[0]!.pos);
  return null;
}

/** The elements an identifier bound to an array literal holds (with later .push / += appends). */
function resolveArray(name: string, ctx: FoldContext, depth: number): string[] | null {
  const alts = resolveArrayAlternatives(name, ctx, depth);
  return alts === null ? null : alts.map((a) => (a.length === 1 ? a[0]! : dyn(name)));
}

function resolveArrayAlternatives(name: string, ctx: FoldContext, depth: number, refPos = -1): string[][] | null {
  if (depth > MAX_DEPTH) return null;
  const visible = visibleBindings(ctx, name, name, refPos);
  if (visible.shadowed || visible.bindings.length === 0) return null;
  // several array bindings of one name in scope: their elements in sequence would be wrong; unknown
  if (visible.bindings.length > 1) return null;
  const out = arrayAlternatives(visible.bindings[0]!, ctx, depth);
  if (!out) return null;
  for (const pushed of visibleBindings(ctx, `${name}.push`, name, refPos).bindings) {
    for (const el of splitTop(pushed, (x) => x.k === "p" && x.v === ",")) {
      const e = el.filter((x) => x.k !== "nl");
      if (e.length === 0) continue;
      const f = foldExpr(e, ctx, depth + 1);
      out.push(f.texts.length > 0 ? f.texts : [dyn(hintOf(e, ctx.src))]);
    }
  }
  return out;
}

/** Every argument vector the alternatives make (capped: past the cap an element is dynamic, which fails closed). */
function argvCombos(alts: readonly string[][], cap = 64): string[][] {
  const work = alts.map((a) => [...a]);
  const size = () => work.reduce((n, a) => n * a.length, 1);
  while (size() > cap) {
    let widest = 0;
    work.forEach((a, n) => {
      if (a.length > work[widest]!.length) widest = n;
    });
    work[widest] = [dyn("")];
  }
  let out: string[][] = [[]];
  for (const a of work) out = out.flatMap((prefix) => a.map((x) => [...prefix, x]));
  return out;
}

function foldJoin(toks: readonly Tok[], ctx: FoldContext, depth: number): Folded | null {
  // JS: <array>.join(sep)
  const n = toks.length;
  if (n >= 5 && toks[n - 1]!.v === ")" && ctx.lang === "js") {
    const open = toks.findIndex((t, i) => i > 0 && t.v === "(" && toks[i - 1]!.v === "join" && toks[i - 2]?.v === "." && matchClose(toks, i) === n - 1);
    if (open > 2) {
      const els = arrayElements(toks.slice(0, open - 2), ctx, depth);
      const sepToks = toks.slice(open + 1, n - 1);
      const sep = sepToks.length === 0 ? "," : sepToks.length === 1 && sepToks[0]!.k === "str" ? strText(sepToks[0]!, ctx, depth) : " ";
      if (els) return { texts: [els.join(sep)], dynamic: false, literal: true };
    }
  }
  // Python: 'sep'.join(<list>)
  if (ctx.lang === "py" && n >= 4 && toks[0]!.k === "str" && toks[1]!.v === "." && toks[2]!.v === "join" && toks[3]!.v === "(" && matchClose(toks, 3) === n - 1) {
    const els = arrayElements(toks.slice(4, n - 1), ctx, depth);
    if (els) return { texts: [els.join(strText(toks[0]!, ctx, depth))], dynamic: false, literal: true };
  }
  // PowerShell: <array> -join 'sep'
  if (ctx.lang === "ps") {
    const at = toks.findIndex((t) => t.k === "id" && t.v.toLowerCase() === "-join");
    if (at > 0) {
      const els = arrayElements(toks.slice(0, at), ctx, depth);
      const sepTok = toks[at + 1];
      if (els) return { texts: [els.join(sepTok?.k === "str" ? strText(sepTok, ctx, depth) : " ")], dynamic: false, literal: true };
    }
  }
  return null;
}

// =============================================================================================
// JavaScript / TypeScript reader
// =============================================================================================

const JS_REGEX_AFTER = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);
const JS_PUNCT = ["===", "!==", "**=", "...", "<<=", ">>=", ">>>", "??=", "||=", "&&=", "?.", "=>", "==", "!=", "<=", ">=", "&&", "||", "??", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<", ">>", "**"];

function isIdStart(c: string): boolean {
  return /[A-Za-z_$]/.test(c) || c.charCodeAt(0) > 0x7f;
}
function isIdPart(c: string): boolean {
  return /[A-Za-z0-9_$]/.test(c) || (c.length > 0 && c.charCodeAt(0) > 0x7f && c !== " " && c !== " " && c !== " " && c !== "﻿");
}

function decodeJsEscape(src: string, j: number): [string, number] {
  const n = src[j + 1] ?? "";
  const simple: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", "0": "\0" };
  if (simple[n] !== undefined && !(n === "0" && /[0-9]/.test(src[j + 2] ?? ""))) return [simple[n]!, j + 2];
  if (n === "x" && /^[0-9a-fA-F]{2}$/.test(src.slice(j + 2, j + 4))) return [String.fromCharCode(parseInt(src.slice(j + 2, j + 4), 16)), j + 4];
  if (n === "u") {
    if (src[j + 2] === "{") {
      const close = src.indexOf("}", j + 3);
      const cp = parseInt(src.slice(j + 3, close), 16);
      if (close > 0 && Number.isFinite(cp) && cp <= 0x10ffff) return [String.fromCodePoint(cp), close + 1];
    } else if (/^[0-9a-fA-F]{4}$/.test(src.slice(j + 2, j + 6))) return [String.fromCharCode(parseInt(src.slice(j + 2, j + 6), 16)), j + 6];
  }
  if (n === "\r" && src[j + 2] === "\n") return ["", j + 3];
  if (n === "\n" || n === " " || n === " ") return ["", j + 2];
  return [n, j + 2];
}

interface LexState {
  i: number;
  line: number;
}

function countNewlines(s: string): number {
  let n = 0;
  for (const c of s) if (c === "\n") n += 1;
  return n;
}

function lexJs(src: string): Tok[] {
  return lexJsUntil(src, { i: 0, line: 1 }, false);
}

/** Tokens until the end, or (inTemplate) until the `}` that closes a `${`. */
function lexJsUntil(src: string, st: LexState, inTemplate: boolean): Tok[] {
  const toks: Tok[] = [];
  let nl = false;
  let braces = 0;
  const push = (t: Omit<Tok, "nl">) => {
    toks.push({ ...t, nl });
    nl = false;
  };
  while (st.i < src.length) {
    const i = st.i;
    const c = src[i]!;
    if (c === "\n") {
      st.line += 1;
      nl = true;
      st.i += 1;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r" || c === "\f" || c === "\v" || c === " " || c === "﻿" || c === " " || c === " ") {
      st.i += 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      const e = src.indexOf("\n", i);
      st.i = e < 0 ? src.length : e;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const e = src.indexOf("*/", i + 2);
      const stop = e < 0 ? src.length : e + 2;
      const n = countNewlines(src.slice(i, stop));
      if (n > 0) nl = true;
      st.line += n;
      st.i = stop;
      continue;
    }
    if (inTemplate) {
      if (c === "{") braces += 1;
      else if (c === "}") {
        if (braces === 0) {
          st.i += 1;
          return toks;
        }
        braces -= 1;
      }
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let v = "";
      let ok = false;
      let lines = 0;
      while (j < src.length) {
        const d = src[j]!;
        if (d === c) {
          ok = true;
          break;
        }
        if (d === "\n") break;
        if (d === "\\") {
          if (src[j + 1] === "\n" || (src[j + 1] === "\r" && src[j + 2] === "\n")) lines += 1;
          const [val, nj] = decodeJsEscape(src, j);
          v += val;
          j = nj;
          continue;
        }
        v += d;
        j += 1;
      }
      if (ok) {
        push({ k: "str", v, pos: i, end: j + 1, line: st.line });
        st.line += lines;
        st.i = j + 1;
      } else {
        push({ k: "p", v: c, pos: i, end: i + 1, line: st.line }); // JSX text, not a string
        st.i = i + 1;
      }
      continue;
    }
    if (c === "`") {
      const line = st.line;
      const parts: (string | { src: string; toks: Tok[] })[] = [];
      let cooked = "";
      let j = i + 1;
      while (j < src.length) {
        const d = src[j]!;
        if (d === "\\") {
          if (src[j + 1] === "\n") st.line += 1;
          const [val, nj] = decodeJsEscape(src, j);
          cooked += val;
          j = nj;
          continue;
        }
        if (d === "`") break;
        if (d === "$" && src[j + 1] === "{") {
          parts.push(cooked);
          cooked = "";
          const inner: LexState = { i: j + 2, line: st.line };
          const innerToks = lexJsUntil(src, inner, true);
          parts.push({ src: src.slice(j + 2, inner.i - 1), toks: innerToks });
          st.line = inner.line;
          j = inner.i;
          continue;
        }
        if (d === "\n") st.line += 1;
        cooked += d;
        j += 1;
      }
      parts.push(cooked);
      const end = Math.min(j + 1, src.length);
      push({ k: "str", v: parts.filter((p) => typeof p === "string").join(""), pos: i, end, line, parts, template: true });
      st.i = end;
      continue;
    }
    if (c === "/") {
      const prev = toks[toks.length - 1];
      const regexOk = !prev || (prev.k === "id" ? JS_REGEX_AFTER.has(prev.v) : prev.k === "p" ? ![")", "]", "++", "--"].includes(prev.v) : false);
      if (regexOk) {
        let j = i + 1;
        let inClass = false;
        let ok = false;
        while (j < src.length) {
          const d = src[j]!;
          if (d === "\n") break;
          if (d === "\\") {
            j += 2;
            continue;
          }
          if (d === "[") inClass = true;
          else if (d === "]") inClass = false;
          else if (d === "/" && !inClass) {
            ok = true;
            break;
          }
          j += 1;
        }
        if (ok && j > i + 1) {
          j += 1;
          while (j < src.length && /[a-z]/i.test(src[j]!)) j += 1;
          push({ k: "re", v: src.slice(i, j), pos: i, end: j, line: st.line });
          st.i = j;
          continue;
        }
      }
    }
    if (isIdStart(c)) {
      let j = i + 1;
      while (j < src.length && isIdPart(src[j]!)) j += 1;
      push({ k: "id", v: src.slice(i, j), pos: i, end: j, line: st.line });
      st.i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < src.length && /[0-9A-Za-z_.]/.test(src[j]!)) j += 1;
      push({ k: "num", v: src.slice(i, j), pos: i, end: j, line: st.line });
      st.i = j;
      continue;
    }
    const op = JS_PUNCT.find((o) => src.startsWith(o, i)) ?? c;
    push({ k: "p", v: op, pos: i, end: i + op.length, line: st.line });
    st.i = i + op.length;
  }
  return toks;
}

/** Every token list: the file's and every template interpolation's. */
function allLists(toks: Tok[]): Tok[][] {
  const out: Tok[][] = [toks];
  for (const t of toks) for (const p of t.parts ?? []) if (typeof p !== "string") out.push(...allLists(p.toks));
  return out;
}

const JS_CONTINUE_AFTER = new Set(["+", "-", "*", "/", "%", "?", ":", ".", "?.", "||", "&&", "??", "=", "==", "===", "!=", "!==", "<", ">", "<=", ">=", "&", "|", "^", ",", "(", "[", "{", "=>", "+=", "**"]);
const JS_CONTINUE_BEFORE = new Set(["+", "-", "*", "/", "%", "?", ":", ".", "?.", "||", "&&", "??", ")", "]", "}", "==", "===", "!=", "!==", ">", "<", ">=", "<=", "**"]);

/** Exclusive end of the expression starting at `start`. */
function jsExprEnd(list: readonly Tok[], start: number): number {
  let depth = 0;
  for (let k = start; k < list.length; k += 1) {
    const t = list[k]!;
    if (depth === 0 && k > start && t.nl) {
      const prev = list[k - 1]!;
      const continues = (prev.k === "p" && JS_CONTINUE_AFTER.has(prev.v)) || (t.k === "p" && JS_CONTINUE_BEFORE.has(t.v));
      if (!continues) return k;
    }
    if (isOpen(t)) depth += 1;
    else if (isClose(t)) {
      if (depth === 0) return k;
      depth -= 1;
    } else if (depth === 0 && t.k === "p" && (t.v === ";" || t.v === ",")) return k;
  }
  return list.length;
}

function addBinding(map: Map<string, Tok[][]>, name: string, toks: Tok[]): void {
  const list = map.get(name) ?? [];
  list.push(toks);
  map.set(name, list);
}

/** const/let/var X = ..., X = ..., X += ..., class fields, X.push(...). Destructuring is not followed. */
function jsBindings(lists: Tok[][]): { map: Map<string, Tok[][]>; ranges: { name: string; from: number; to: number }[] } {
  const map = new Map<string, Tok[][]>();
  const ranges: { name: string; from: number; to: number }[] = [];
  for (const list of lists) {
    for (let k = 0; k < list.length; k += 1) {
      const t = list[k]!;
      if (t.k !== "id") continue;
      const prev = list[k - 1];
      if (prev && prev.k === "p" && (prev.v === "." || prev.v === "?.")) {
        // X.push(a, b)
        if (t.v === "push" && list[k + 1]?.v === "(" && list[k - 2]?.k === "id") {
          const close = matchClose(list, k + 1);
          addBinding(map, `${list[k - 2]!.v}.push`, list.slice(k + 2, close));
        }
        continue;
      }
      // for (const x of <iterable>) / for (const x in <object>): x is each element
      if (prev?.k === "id" && (prev.v === "const" || prev.v === "let" || prev.v === "var") && list[k - 2]?.v === "(" && list[k - 3]?.v === "for" && list[k + 1]?.k === "id" && list[k + 1]!.v === "of") {
        const close = matchClose(list, k - 2);
        addBinding(map, `elem:${t.v}`, list.slice(k + 2, close));
        continue;
      }
      let m = k + 1;
      if ((prev?.k === "id" && (prev.v === "const" || prev.v === "let" || prev.v === "var")) && list[m]?.v === ":") {
        // a type annotation: skip to the '=' at depth 0
        let depth = 0;
        for (m += 1; m < list.length; m += 1) {
          const x = list[m]!;
          if (isOpen(x) || x.v === "<") depth += 1;
          else if (isClose(x) || x.v === ">") depth -= 1;
          else if (depth <= 0 && (x.v === "=" || x.v === ";" || x.nl)) break;
        }
      }
      const op = list[m];
      if (op?.k === "p" && (op.v === "=" || op.v === "+=" || op.v === "??=" || op.v === "||=")) {
        const end = jsExprEnd(list, m + 1);
        const expr = list.slice(m + 1, end);
        if (expr.length === 0) continue;
        addBinding(map, t.v, expr);
        ranges.push({ name: t.v, from: expr[0]!.pos, to: expr[expr.length - 1]!.end });
        // const execAsync = promisify(exec): an alias of a process function
        if (expr.length >= 4 && /^(promisify|util)$/.test(expr[0]!.v)) {
          const inner = expr.filter((x) => x.k === "id").map((x) => x.v);
          const fn = inner.find((x) => own(JS_PROCESS, x) !== undefined);
          if (fn) addBinding(map, `alias:${t.v}`, [{ ...expr[0]!, k: "id", v: fn }]);
        }
      }
    }
  }
  return { map, ranges };
}

/** Calls whose string arguments are messages (logs, errors, assertions), never statements that run. */
const MESSAGE_CALL = /^(console\.(log|info|warn|error|debug|trace)|log|logger\.\w+|this\.log|this\.logger\.\w+|logInfo|logWarn|logError|warn|info|debug|print|logging\.\w+|\w*Error|\w*Exception|reject|fail|Write-Host|Write-Output|Write-Warning|Write-Error|Write-Verbose|Write-Information)$/;

interface CallRange {
  readonly name: string;
  readonly from: number;
  readonly to: number;
  /** Source ranges of the arguments, in order. */
  readonly args: readonly { from: number; to: number }[];
}

/** Every `name(...)` / `a.b.name(...)` / `new Name(...)` call of the token lists, with argument ranges. */
function callIndex(lists: readonly Tok[][], src: string): CallRange[] {
  const out: CallRange[] = [];
  for (const list of lists) {
    for (let k = 0; k < list.length; k += 1) {
      const t = list[k]!;
      if (t.k !== "id" || list[k + 1]?.v !== "(") continue;
      const parts = [t.v];
      for (let j = k - 1; j >= 1 && list[j]!.v === "." && list[j - 1]!.k === "id"; j -= 2) parts.unshift(list[j - 1]!.v);
      const close = matchClose(list, k + 1);
      const args = argsOf(list, k + 1).filter((a) => a.length > 0).map((a) => ({ from: a[0]!.pos, to: a[a.length - 1]!.end }));
      out.push({ name: parts.join("."), from: list[k + 1]!.pos, to: list[close]!.end, args });
    }
  }
  void src;
  return out;
}

/** The innermost call whose argument list holds `pos`, with the argument's index. */
function innermostCall(calls: readonly CallRange[], pos: number): { name: string; argIndex: number } | null {
  let best: CallRange | null = null;
  for (const c of calls) if (pos > c.from && pos < c.to && (!best || c.to - c.from < best.to - best.from)) best = c;
  if (!best) return null;
  const argIndex = best.args.findIndex((a) => pos >= a.from && pos < a.to);
  return { name: best.name.split(".").pop()!, argIndex };
}

/**
 * Same-file functions that gate one of their parameters (`function run(sql) { ... gatedSql(caller, sql) }`):
 * name -> the indexes of those parameters. A literal passed there is checked by the gate at run time.
 */
function jsGatedParameters(lists: readonly Tok[][], gating: Gating): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  for (const list of lists) {
    for (let k = 0; k < list.length; k += 1) {
      const t = list[k]!;
      let name: string | null = null;
      let open = -1;
      if (t.k === "id" && t.v === "function" && list[k + 1]?.k === "id" && list[k + 2]?.v === "(") {
        name = list[k + 1]!.v;
        open = k + 2;
      } else if (t.k === "id" && (t.v === "const" || t.v === "let") && list[k + 1]?.k === "id" && list[k + 2]?.v === "=") {
        let j = k + 3;
        if (list[j]?.v === "async") j += 1;
        if (list[j]?.v === "(") {
          const close = matchClose(list, j);
          if (list[close + 1]?.v === "=>" || (list[close + 1]?.v === ":" && list.slice(close + 1, close + 12).some((x) => x.v === "=>"))) {
            name = list[k + 1]!.v;
            open = j;
          }
        }
      }
      if (name === null || open < 0) continue;
      const close = matchClose(list, open);
      const params = argsOf(list, open).map((a) => (a[0]?.k === "id" ? a[0]!.v : ""));
      // the body: the next { ... } after the parameter list
      let b = close + 1;
      while (b < list.length && list[b]!.v !== "{" && list[b]!.v !== ";") b += 1;
      if (list[b]?.v !== "{") continue;
      const end = matchClose(list, b);
      const from = list[b]!.pos;
      const to = list[end]!.end;
      const gated = new Set<number>();
      params.forEach((param, n) => {
        if (!param || !gating.ids.has(param)) return;
        const inBody = list.slice(b, end).some((x, m) => x.k === "id" && x.v === param && gating.ranges.some((r) => r.from >= from && r.to <= to && list[b + m]!.pos >= r.from && list[b + m]!.pos < r.to));
        if (inBody) gated.add(n);
      });
      if (gated.size) out.set(name, gated);
    }
  }
  return out;
}

/** String methods whose argument is a needle or a pattern, not a statement. */
const STRING_INSPECTION = new Set(["includes", "startsWith", "endsWith", "indexOf", "lastIndexOf", "match", "matchAll", "search", "split", "test", "localeCompare"]);

const JS_GATES = new Set(["gatedSql", "assertSqlWriteAllowed", "assertCommandWriteAllowed", "assertOgr2ogrCommandAllowed", "assertOgr2ogrWriteAllowed"]);
/** Relation gates: the named relation is checked; a statement whose only dynamic target is that value is gated. */
const JS_RELATION_GATES = new Set(["assertUngovernedDestructiveWriteAllowed"]);

/** A receiver that names a database handle (`db`, `pool`, `dbClient`, `prismaTx`), not `bankIdBreaker`. */
const DB_RECEIVER = /^(?:[a-z][A-Za-z0-9_]*)?(?:db|Db|DB|pool|Pool|client|Client|conn|Conn|connection|Connection|trx|Trx|tx|Tx|pg|Pg|knex|Knex|sql|Sql|cursor|Cursor|database|Database|prisma|Prisma)$/;

/** SQL methods: name -> receiver rule. */
const JS_SQL: Record<string, "any" | "db"> = {
  query: "any",
  queryArray: "any",
  queryObject: "any",
  $queryRaw: "any",
  $executeRaw: "any",
  $queryRawUnsafe: "any",
  $executeRawUnsafe: "any",
  unsafe: "db",
  raw: "db",
  execute: "db",
  none: "db",
  any: "db",
  one: "db",
  many: "db",
  oneOrNone: "db",
  manyOrNone: "db",
  multi: "db",
  result: "db",
};

/** Process functions: name -> payload shape. */
const JS_PROCESS: Record<string, "argv" | "cmd"> = {
  spawn: "argv",
  spawnSync: "argv",
  execFile: "argv",
  execFileSync: "argv",
  exec: "cmd",
  execSync: "cmd",
  execa: "argv",
  execaSync: "argv",
  execaCommand: "cmd",
  execaCommandSync: "cmd",
};

interface Gating {
  /** Source ranges of gate-call arguments. */
  readonly ranges: { from: number; to: number }[];
  /** Identifiers passed to a gate call. */
  readonly ids: Set<string>;
  /** Relation expressions checked by a relation gate (normalised source), with the position of the check. */
  readonly relations: { expr: string; pos: number }[];
}

function inRanges(pos: number, ranges: readonly { from: number; to: number }[]): boolean {
  return ranges.some((r) => pos >= r.from && pos < r.to);
}

function jsGating(lists: Tok[][], src: string): Gating {
  const ranges: { from: number; to: number }[] = [];
  const ids = new Set<string>();
  const relations: { expr: string; pos: number }[] = [];
  for (const list of lists) {
    list.forEach((t, k) => {
      if (t.k !== "id" || list[k + 1]?.v !== "(") return;
      const close = matchClose(list, k + 1);
      const args = list.slice(k + 2, close);
      if (JS_GATES.has(t.v)) {
        ranges.push({ from: list[k + 1]!.pos, to: list[close]!.end });
        for (const a of args) if (a.k === "id") ids.add(a.v);
        // { caller, args } shorthand and { sql: x } / { command: x } / { argv: x }
      }
      if (JS_RELATION_GATES.has(t.v)) {
        const rel = args.findIndex((a) => a.k === "id" && a.v === "relation" && args[args.indexOf(a) + 1]?.v === ":");
        if (rel >= 0) {
          const end = jsExprEnd(args, rel + 2);
          relations.push({ expr: hintOf(args.slice(rel + 2, end), src), pos: t.pos });
        }
      }
    });
  }
  return { ranges, ids, relations };
}

/** A literal whose only non-static write targets are values a preceding relation gate checked. */
function relationGated(text: string, gating: Gating, pos: number, def: ProtectedRelationsDefinition, classify: (t: string) => TextVerdict | null): boolean {
  const checked = gating.relations.filter((r) => r.pos < pos).map((r) => dyn(r.expr));
  if (checked.length === 0) return false;
  let replaced = text;
  checked.forEach((placeholder, n) => {
    replaced = replaced.split(placeholder).join(`gate_checked_relation_${n}`);
  });
  if (replaced === text) return false;
  const v = classify(replaced);
  void def;
  return v === null || v.verdict === "ALLOWED";
}

/** The receiver identifier of a member call at index k (`a.b.query(` -> b), or null. */
function receiverOf(list: readonly Tok[], k: number): string | null {
  const dot = list[k - 1];
  if (!dot || dot.k !== "p" || (dot.v !== "." && dot.v !== "?.")) return null;
  const r = list[k - 2];
  if (r?.k === "id") return r.v;
  return "";
}

function argsOf(list: readonly Tok[], open: number): Tok[][] {
  const close = matchClose(list, open);
  const inner = list.slice(open + 1, close);
  if (inner.length === 0) return [];
  return splitTop(inner, (t) => t.k === "p" && t.v === ",").map((a) => a.filter((x) => x.k !== "nl"));
}

interface SiteSink {
  add(site: Omit<ChannelSite, "file">): void;
  counts: { channels: number; gated: number; allowed: number; literals: number };
}

function excerptOf(src: string, from: number, to: number): string {
  return norm(src.slice(from, to));
}

// =============================================================================================
// U30F3 M-2 (owner decision 2026-10-02): a channel is recognised by its MODULE, and what the scan does not
// follow fails closed. Unknown or dynamic write channels never pass silently: they are DYNAMIC sites that need
// a reviewed entry (or a gate, or retirement).
// =============================================================================================

/** JS/TS database and process clients whose calls the scan does not read: any import/require of one is DYNAMIC. */
const JS_UNREAD_MODULES = new Set([
  "knex", "pg-promise", "postgres", "slonik", "sequelize", "typeorm", "kysely", "drizzle-orm", "objection", "massive", "pg-native",
  "pg-cursor", "pg-query-stream", "mysql", "mysql2", "postgrator", "node-pg-migrate", "db-migrate", "umzug", "@databases/pg",
  "shelljs", "cross-spawn", "node-pty", "tinyexec", "nano-spawn", "@npmcli/promise-spawn", "child-process-promise", "await-spawn", "spawn-sync",
  // U30F4 (B1): node:vm runs code the scan does not read -- any import of it fails closed
  "vm",
  // U30F5 (D-6): process runners whose renamed functions and values the scan does not follow
  "zx", "execa",
]);
const JS_UNREAD_MODULE_SCOPES = ["@slonik/", "@mikro-orm/", "@databases/"];
/** Modules whose process functions the scan reads -- but only in the forms it follows. */
const JS_PROCESS_MODULES = new Set(["child_process"]);
/** Prisma raw SQL functions: never used as a value (a call or a tagged template only). */
const JS_RAW_SQL_FUNCTIONS = new Set(["$executeRawUnsafe", "$queryRawUnsafe", "$executeRaw", "$queryRaw"]);

/**
 * U30F3 M-2: the index after a TypeScript type-argument list starting at `at` (`$queryRawUnsafe<Row[]>(...)`,
 * `pool.query<T>(...)`), or -1 when `at` does not open one. A call with type arguments is the same channel.
 */
function skipTypeArgs(list: readonly Tok[], at: number): number {
  if (list[at]?.v !== "<") return -1;
  let depth = 0;
  for (let k = at; k < list.length && k < at + 400; k += 1) {
    const v = list[k]!.v;
    if (list[k]!.k === "p") {
      if (v === "<") depth += 1;
      else if (v === ">") depth -= 1;
      else if (v === ">>") depth -= 2;
      else if (v === ">>>") depth -= 3;
      else if (v === "&&" || v === "||") return -1;
    }
    if (depth <= 0) return k + 1;
  }
  return -1;
}

/** The index of the `(` (or template) that calls the identifier at k, type arguments skipped, or -1. */
function callOpenAt(list: readonly Tok[], k: number): number {
  const next = list[k + 1];
  if (next?.v === "(" || (next?.k === "str" && next.template && !next.nl)) return k + 1;
  const after = skipTypeArgs(list, k + 1);
  const n = after > 0 ? list[after] : undefined;
  return n && (n.v === "(" || (n.k === "str" && n.template && !n.nl)) ? after : -1;
}

/** The package a module specifier names (`node:` dropped, `@scope/name`, no subpath). */
function moduleBase(spec: string): string {
  const s = spec.replace(/^node:/, "");
  const parts = s.split("/");
  return s.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

function unreadJsModule(mod: string): boolean {
  return JS_UNREAD_MODULES.has(mod) || JS_UNREAD_MODULE_SCOPES.some((p) => mod.startsWith(p));
}

interface JsModuleSurface {
  /** Identifiers bound to the child_process module itself (default / namespace import, `= require(...)`). */
  readonly processBindings: ReadonlySet<string>;
  /** Renamed process functions (`execSync as run`, `{ execSync: run }`): local name -> function. */
  readonly aliases: ReadonlyMap<string, string>;
}

/**
 * U30F3 M-2: every module reference of a JS/TS file. A database/process client the scan does not read, a module
 * named at run time, child_process loaded or bound in a form the scan does not follow, re-exported, its module object used other
 * than `X.<process function>(...)`, a process function used as a value, eval / new Function / vm over code the
 * source does not hold, and a Prisma raw SQL function used as a value are DYNAMIC sites. Returns what the channel
 * loop must follow: the bindings of the child_process module and the renamed process functions.
 */
function jsModuleSurface(lists: readonly Tok[][], src: string, sink: SiteSink, foldStatic: (arg: readonly Tok[]) => string | null): JsModuleSurface {
  const processBindings = new Set<string>();
  const aliases = new Map<string, string>();
  const processNames = new Set<string>(); // process functions imported by their own name
  const declared = new Set<number>(); // positions of the binding names themselves
  const site = (from: number, to: number, line: number, kind: SiteKind, channel: string, detail: string) =>
    sink.add({ line, kind, channel, excerpt: excerptOf(src, from, to), verdict: "DYNAMIC", detail });
  const unread = (mod: string) => `${mod}: a database, process or code-running module whose calls the scan does not read (U30F3 M-2 / U30F4: fail-closed)`;
  const staticLiteral = (arg: readonly Tok[] | undefined) => arg !== undefined && arg.length === 1 && arg[0]!.k === "str" && !arg[0]!.parts;

  for (const list of lists) {
    for (let k = 0; k < list.length; k += 1) {
      const t = list[k]!;
      // require(<x>) / import(<x>)
      if (t.k === "id" && (t.v === "require" || (t.v === "import" && list[k - 1]?.v !== ".")) && list[k + 1]?.v === "(") {
        const close = matchClose(list, k + 1);
        const arg = argsOf(list, k + 1)[0];
        // a module name in a same-file constant is as static as a literal
        const spec = arg === undefined ? null : staticLiteral(arg) ? arg[0]!.v : foldStatic(arg);
        if (spec === null) {
          site(t.pos, list[close]!.end, t.line, "PROCESS", `${t.v}()`, "loads a module named at run time: the channels it opens are not in the source");
          continue;
        }
        const mod = moduleBase(spec);
        if (unreadJsModule(mod)) {
          site(t.pos, list[close]!.end, t.line, "PROCESS", `${t.v} ${mod}`, unread(mod));
          continue;
        }
        if (!JS_PROCESS_MODULES.has(mod)) continue;
        // require('child_process').fn(...) is judged by the channel loop
        if (t.v === "require" && list[close + 1]?.v === "." && list[close + 2]?.k === "id" && list[close + 3]?.v === "(" && own(JS_PROCESS, list[close + 2]!.v)) continue;
        // const X = require(...) / const { a, b: c } = [await] require(...) | await import(...)
        let eq = list[k - 1]?.v === "await" ? k - 2 : k - 1;
        if (list[eq]?.v !== "=") eq = -1;
        if (eq > 0 && list[eq - 1]?.k === "id" && /^(const|let|var)$/.test(list[eq - 2]?.v ?? "")) {
          processBindings.add(list[eq - 1]!.v);
          declared.add(list[eq - 1]!.pos);
          continue;
        }
        if (eq > 0 && list[eq - 1]?.v === "}") {
          let open = eq - 1;
          let depth = 0;
          for (; open >= 0; open -= 1) {
            if (list[open]!.v === "}") depth += 1;
            else if (list[open]!.v === "{") {
              depth -= 1;
              if (depth === 0) break;
            }
          }
          for (const spec of splitTop(list.slice(open + 1, eq - 1), (x) => x.k === "p" && x.v === ",")) {
            const s = spec.filter((x) => x.k !== "nl");
            if (s.length === 1 && s[0]!.k === "id") {
              if (own(JS_PROCESS, s[0]!.v)) processNames.add(s[0]!.v);
              declared.add(s[0]!.pos);
            } else if (s.length === 3 && s[0]!.k === "id" && s[1]!.v === ":" && s[2]!.k === "id") {
              if (own(JS_PROCESS, s[0]!.v)) aliases.set(s[2]!.v, s[0]!.v);
              declared.add(s[2]!.pos);
            } else site(t.pos, list[close]!.end, t.line, "PROCESS", `${t.v} ${mod}`, "child_process destructured in a way the scan does not follow");
          }
          continue;
        }
        site(t.pos, list[close]!.end, t.line, "PROCESS", `${t.v} ${mod}`, "child_process bound in a way the scan does not follow");
        continue;
      }
      // import ... from 'm' / export ... from 'm' / import 'm'
      if (t.k !== "str" || t.parts) continue;
      const prev = list[k - 1];
      if (!(prev?.k === "id" && (prev.v === "from" || prev.v === "import"))) continue;
      let s = k - 1;
      if (prev.v === "from") while (s >= 0 && !(list[s]!.k === "id" && (list[s]!.v === "import" || list[s]!.v === "export"))) s -= 1;
      if (s < 0) continue;
      const head = list[s]!;
      const clause = prev.v === "from" ? list.slice(s + 1, k - 1) : [];
      const typeOnly = clause[0]?.k === "id" && clause[0]!.v === "type";
      const mod = moduleBase(t.v);
      if (unreadJsModule(mod)) {
        if (!typeOnly) site(head.pos, t.end, head.line, "PROCESS", `import ${mod}`, unread(mod));
        continue;
      }
      if (!JS_PROCESS_MODULES.has(mod) || typeOnly) continue;
      if (head.v === "export") {
        site(head.pos, t.end, head.line, "PROCESS", `export ${mod}`, "child_process re-exported: its functions are called under another module's name");
        continue;
      }
      for (let c = 0; c < clause.length; c += 1) {
        const x = clause[c]!;
        if (x.k === "p" && x.v === "*" && clause[c + 1]?.v === "as" && clause[c + 2]?.k === "id") {
          processBindings.add(clause[c + 2]!.v);
          declared.add(clause[c + 2]!.pos);
          c += 2;
        } else if (x.k === "p" && x.v === "{") {
          const close = matchClose(clause, c);
          for (const spec of splitTop(clause.slice(c + 1, close), (y) => y.k === "p" && y.v === ",")) {
            const sp = spec.filter((y) => y.k !== "nl" && !(y.k === "id" && y.v === "type"));
            if (sp.length === 1 && sp[0]!.k === "id") {
              if (own(JS_PROCESS, sp[0]!.v)) processNames.add(sp[0]!.v);
              declared.add(sp[0]!.pos);
            } else if (sp.length === 3 && sp[1]!.v === "as" && sp[2]!.k === "id") {
              if (own(JS_PROCESS, sp[0]!.v)) aliases.set(sp[2]!.v, sp[0]!.v);
              declared.add(sp[2]!.pos);
            }
          }
          c = close;
        } else if (x.k === "id" && x.v !== "type" && (clause[c + 1] === undefined || clause[c + 1]!.v === ",")) {
          processBindings.add(x.v); // default import
          declared.add(x.pos);
        }
      }
    }
  }

  // uses: the module object only as `X.<process function>(` (or a Capitalised type), a process function only called
  for (const list of lists) {
    for (let k = 0; k < list.length; k += 1) {
      const t = list[k]!;
      if (t.k !== "id" || declared.has(t.pos)) continue;
      const prev = list[k - 1];
      const afterDot = prev?.k === "p" && (prev.v === "." || prev.v === "?.");
      if (!afterDot && processBindings.has(t.v) && !(prev?.k === "id" && prev.v === "typeof")) {
        const dot = list[k + 1];
        const member = list[k + 2];
        const followed = dot?.v === "." && member?.k === "id" && (/^[A-Z]/.test(member.v) || (own(JS_PROCESS, member.v) !== undefined && list[k + 3]?.v === "("));
        if (!followed) site(t.pos, (member ?? t).end, t.line, "PROCESS", `child_process ${t.v}`, "the child_process module used other than X.<process function>(...): its calls are not followed");
        continue;
      }
      if (!afterDot && (processNames.has(t.v) || aliases.has(t.v)) && list[k + 1]?.v !== "(") {
        // promisify(exec) is followed through its alias binding (jsBindings)
        const call = list[k - 1]?.v === "(" && /^(promisify|util)$/.test(list[k - 2]?.v ?? "");
        if (!call) site(t.pos, t.end, t.line, "PROCESS", t.v, "a process function used as a value: where it is called is not followed");
        continue;
      }
      // eval / Function / new Function / vm.* (U30F4: always -- even a literal is code the scan does not read)
      const evalLike = (!afterDot && (t.v === "eval" || t.v === "Function")) || (afterDot && list[k - 2]?.v === "vm" && /^(runInNewContext|runInThisContext|runInContext|compileFunction|Script)$/.test(t.v));
      if (evalLike && list[k + 1]?.v === "(") {
        const close = matchClose(list, k + 1);
        site(t.pos, list[close]!.end, t.line, "PROCESS", t.v, "evaluates code the scan does not read");
        continue;
      }
      // U30F4 (B1): eval used as a value -- (0, eval)(x), Reflect.apply(eval, ...), const e = eval (an object key eval: is not)
      if (!afterDot && t.v === "eval" && list[k + 1]?.v !== ":") {
        site(t.pos, t.end, t.line, "PROCESS", "eval", "eval used as a value: where it is called is not followed");
        continue;
      }
      // U30F4 (B1): a function called through reflection, a global looked up by a computed name
      if (afterDot && (t.v === "apply" || t.v === "construct") && list[k - 2]?.v === "Reflect" && list[k + 1]?.v === "(") {
        site(list[k - 2]!.pos, list[matchClose(list, k + 1)]!.end, t.line, "PROCESS", `Reflect.${t.v}`, "a function called through reflection: what it runs is not followed");
        continue;
      }
      if (!afterDot && /^(globalThis|global|window|self)$/.test(t.v) && list[k + 1]?.v === "[") {
        site(t.pos, list[matchClose(list, k + 1)]!.end, t.line, "PROCESS", `${t.v}[]`, "a global looked up by a computed name: what it runs is not followed");
        continue;
      }
      // U30F4 (B1): new Worker(code, { eval: true }) -- or options the source does not hold -- runs code, not a file
      if (!afterDot && t.v === "Worker" && list[k + 1]?.v === "(") {
        const close = matchClose(list, k + 1);
        const opts = argsOf(list, k + 1)[1];
        const evalOption = opts !== undefined && (opts[0]?.v !== "{" || opts.some((x, n) => x.k === "id" && x.v === "eval" && opts[n + 1]?.v === ":" && opts[n + 2]?.v !== "false"));
        if (evalOption) site(t.pos, list[close]!.end, t.line, "PROCESS", "Worker", "a worker that evaluates code (eval option, or options the source does not hold)");
        continue;
      }
      // prisma.$executeRawUnsafe used as a value (bound, passed, assigned) is a channel the loop does not see
      if (afterDot && JS_RAW_SQL_FUNCTIONS.has(t.v) && callOpenAt(list, k) < 0 && list[k - 3]?.v !== "typeof") {
        site(t.pos, t.end, t.line, "SQL_CALL", t.v, "a raw SQL function used as a value: where it is called is not followed");
      }
    }
  }
  return { processBindings, aliases };
}

function scanJs(src: string, sink: SiteSink, def: ProtectedRelationsDefinition, readSqlFile: (p: string) => string | null, readRepo?: (p: string) => string | null): void {
  const toks = lexJs(src);
  const lists = allLists(toks);
  const { map: bindings, ranges: bindingRanges } = jsBindings(lists);
  const gating = jsGating(lists, src);
  const ctx: FoldContext = { src, bindings, lang: "js", readRepoFile: readRepo, scopes: jsScopes(lists) };
  const classifySql = (t: string) => classifySqlText(t, def);
  const surface = jsModuleSurface(lists, src, sink, (arg) => {
    const f = foldExpr(arg, ctx, 0);
    return !f.dynamic && f.texts.length === 1 && !containsDynamic(f.texts[0]!) ? f.texts[0]! : null;
  });

  const calls = callIndex(lists, src);
  const gatedParams = jsGatedParameters(lists, gating);
  const literalGated = (pos: number) => {
    if (inRanges(pos, gating.ranges) || bindingRanges.some((r) => pos >= r.from && pos < r.to && gating.ids.has(r.name))) return true;
    const call = innermostCall(calls, pos);
    return call !== null && (gatedParams.get(call.name)?.has(call.argIndex) ?? false);
  };
  const inMessage = (pos: number) => {
    const call = innermostCall(calls, pos);
    return call !== null && MESSAGE_CALL.test(call.name);
  };

  // ---- the literal surface: every string literal (concatenations folded) ----
  const seen = new Set<number>();
  for (const list of lists) {
    for (let k = 0; k < list.length; k += 1) {
      const t = list[k]!;
      if (t.k !== "str" || seen.has(t.pos)) continue;
      // a literal starts a concatenation chain: fold the chain
      let end = k + 1;
      while (end + 1 < list.length && list[end]!.k === "p" && list[end]!.v === "+" && (list[end + 1]!.k === "str" || list[end + 1]!.k === "id")) end += 2;
      const prevPlus = list[k - 1]?.k === "p" && list[k - 1]!.v === "+";
      const chainStart = prevPlus && list[k - 2]?.k === "id" ? k - 2 : k;
      for (let n = chainStart; n < end; n += 1) if (list[n]!.k === "str") seen.add(list[n]!.pos);
      // block.includes('DROP INDEX "env_'): text searched for, not SQL that is run; console.log('...'): a message
      if (list[chainStart - 1]?.v === "(" && list[chainStart - 2]?.k === "id" && STRING_INSPECTION.has(list[chainStart - 2]!.v) && list[chainStart - 3]?.v === ".") continue;
      if (inMessage(t.pos)) continue;
      const tagged = list[k - 1]?.k === "id" && /^(\$queryRaw|\$executeRaw|sql)$/.test(list[k - 1]!.v) && t.template;
      const folded = foldExpr(list.slice(chainStart, end), { ...ctx, paramTemplates: tagged }, 0);
      sink.counts.literals += 1;
      for (const text of folded.texts) {
        const v = classifyLiteral(text, def, readSqlFile);
        if (!v || v.verdict === "ALLOWED") continue;
        if (literalGated(t.pos)) {
          sink.counts.gated += 1;
          continue;
        }
        if (v.verdict === "UNRESOLVABLE" && relationGated(text, gating, t.pos, def, classifySql)) {
          sink.counts.gated += 1;
          continue;
        }
        sink.add({ line: t.line, kind: "SQL_TEXT", channel: "literal", excerpt: excerptOf(src, list[chainStart]!.pos, list[end - 1]!.end), verdict: v.verdict, detail: v.detail });
        break;
      }
    }
  }

  // ---- channel calls ----
  const aliasOf = (name: string): string | null => {
    const a = bindings.get(`alias:${name}`);
    return a && a[0] && a[0][0] ? a[0][0].v : null;
  };
  const checkedBefore = (pos: number): string[] => gating.relations.filter((r) => r.pos < pos).map((r) => dyn(r.expr));
  for (const list of lists) {
    for (let k = 0; k < list.length; k += 1) {
      const t = list[k]!;
      if (t.k !== "id") continue;
      // (U30F3 M-2: `$queryRawUnsafe<Row[]>(sql)` / `pool.query<T>(sql)` -- type arguments skipped -- is the same channel)
      const open = callOpenAt(list, k);
      if (open < 0) continue;
      const next = list[open];
      const receiver = receiverOf(list, k);
      // tagged templates: $queryRaw`...`, sql`...`, $`...` (zx)
      if (next?.k === "str" && next.template && !next.nl) {
        if (/^(\$queryRaw|\$executeRaw)$/.test(t.v) || (t.v === "sql" && receiver === null)) {
          sink.counts.channels += 1;
          judgeFoldedSql({ texts: strTexts(next, { ...ctx, paramTemplates: true }, 0), dynamic: false, literal: true }, t.line, t.v, excerptOf(src, t.pos, next.end), t.pos);
          continue;
        }
        if (/^(\$queryRawUnsafe|\$executeRawUnsafe)$/.test(t.v)) {
          sink.counts.channels += 1;
          judgeFoldedSql({ texts: strTexts(next, ctx, 0), dynamic: false, literal: true }, t.line, t.v, excerptOf(src, t.pos, next.end), t.pos);
          continue;
        }
        if (t.v === "$" && receiver === null) {
          sink.counts.channels += 1;
          judgeCommand(strTexts(next, ctx, 0), t.line, "zx $``", excerptOf(src, t.pos, next.end), t.pos, null);
          continue;
        }
      }
      if (next?.k !== "p" || next.v !== "(") continue;
      const prevTok = list[k - 1];
      if (prevTok?.k === "id" && ["function", "async", "get", "set", "static", "public", "private", "protected"].includes(prevTok.v)) continue; // a declaration
      const closeIdx = matchClose(list, open);
      const after = list[closeIdx + 1];
      const args = argsOf(list, open);
      // a declaration: `query(sql: string): Promise<T> {`, an interface member, an object method shorthand
      if (receiver === null && (after?.v === "{" || after?.v === ":" || args.some((a) => a.length >= 2 && a[0]!.k === "id" && (a[1]!.v === ":" || a[1]!.v === "?")))) continue;
      const callStart = receiver ? (list[k - 2]?.pos ?? t.pos) : t.pos;
      const excerpt = excerptOf(src, callStart, list[closeIdx]!.end);

      const sqlRule = own(JS_SQL, t.v);
      if (sqlRule && (sqlRule === "any" || (receiver !== null && receiver !== "" && DB_RECEIVER.test(receiver)))) {
        if (t.v === "raw" && receiver !== null && /^(Prisma|String)$/.test(receiver)) continue;
        if (t.v === "query" && receiver !== null && /^(permissions|navigator|router|URLSearchParams|req|request|qs|querystring)$/.test(receiver)) continue;
        const channel = `${receiver ? `${receiver}.` : ""}${t.v}`;
        judgeSqlPayload(args[0] ?? [], t.line, channel, excerpt, t.v === "$queryRaw" || t.v === "$executeRaw", t.pos);
        continue;
      }
      // (U30F3 M-2: a renamed import is followed, and a binding of the child_process module is a process receiver)
      const procName = own(JS_PROCESS, t.v) ? t.v : (aliasOf(t.v) ?? (receiver === null ? (surface.aliases.get(t.v) ?? null) : null));
      if (procName && own(JS_PROCESS, procName)) {
        const moduleReceiver = receiver !== null && surface.processBindings.has(receiver);
        if (procName === "exec" && receiver !== null && !moduleReceiver && !/^(child_process|childProcess|cp|proc|child)$/.test(receiver)) continue;
        if (receiver !== null && procName !== "exec" && !moduleReceiver && !/^(child_process|childProcess|cp|proc|child|execa)$/.test(receiver) && receiver !== "") continue;
        sink.counts.channels += 1;
        const channel = `${receiver ? `${receiver}.` : ""}${t.v}`;
        if (own(JS_PROCESS, procName) === "cmd") judgeCmdPayload(args, t.line, channel, excerpt, t.pos);
        else judgeArgvPayload(args, t.line, channel, excerpt, t.pos);
      }
    }
  }

  function payloadGated(arg: readonly Tok[]): boolean {
    const a = stripParens(arg.filter((x) => x.k !== "nl"));
    if (a.length === 0) return false;
    if (a[0]!.k === "id" && JS_GATES.has(a[0]!.v) && a[1]?.v === "(") return true;
    if (a[0]!.k === "id" && a[0]!.v === "await" && a[1]?.k === "id" && JS_GATES.has(a[1]!.v)) return true;
    if (a.length === 1 && a[0]!.k === "id" && gating.ids.has(a[0]!.v)) return true;
    // args[0] / args.slice(1) where `args` itself went through the gate (assertOgr2ogrWriteAllowed({ args: args.slice(1) }))
    if (a[0]!.k === "id" && gating.ids.has(a[0]!.v) && (a[1]?.v === "[" || a[1]?.v === ".")) return true;
    return false;
  }

  /** The `input:` option of a process call (its stdin), folded, or null. */
  function stdinOf(args: readonly Tok[][]): string[] | null {
    for (const a of args) {
      if (a[0]?.v !== "{") continue;
      const at = a.findIndex((x, n) => x.k === "id" && x.v === "input" && a[n + 1]?.v === ":");
      if (at >= 0) return foldExpr(a.slice(at + 2, jsExprEnd(a, at + 2)), ctx, 0).texts;
    }
    return null;
  }

  function judgeSqlPayload(arg: readonly Tok[], line: number, channel: string, excerpt: string, params: boolean, pos: number): void {
    let a = stripParens(arg.filter((x) => x.k !== "nl"));
    if (a.length === 1 && a[0]!.k === "id") {
      const bound = visibleBindings(ctx, a[0]!.v, a[0]!.v, a[0]!.pos);
      if (!bound.shadowed && bound.bindings.length > 0 && bound.bindings.every((b) => b[0]?.v === "{")) a = bound.bindings[0]!;
    }
    // node-postgres QueryConfig { text, values } / { sql }; any other object is a query API, not SQL
    if (a[0]?.k === "p" && a[0]!.v === "{") {
      // U30F4 (B2): the SQL of a QueryConfig -- a `text:`/`sql:` key (also quoted) or a shorthand { text } (that binding).
      // A spread, a computed key, or a text/sql getter or method is a config the source does not hold: DYNAMIC, even
      // beside a static text (a later spread overrides it). An object with none of these names no SQL.
      let depth = 0;
      let sqlAt = -1;
      let shorthand: Tok | null = null;
      let unheld = false;
      const sqlName = (x: Tok | undefined) => x !== undefined && (x.k === "id" || (x.k === "str" && !x.parts)) && (x.v === "text" || x.v === "sql");
      for (let n = 0; n < a.length; n++) {
        const x = a[n]!;
        const p = x.k === "p" ? x.v : null;
        if (p === "{" || p === "(" || p === "[") {
          if (depth === 1 && p === "[" && (a[n - 1]?.v === "{" || a[n - 1]?.v === ",")) unheld = true;
          depth += 1;
          continue;
        }
        if (p === "}" || p === ")" || p === "]") {
          depth -= 1;
          continue;
        }
        if (depth !== 1) continue;
        if (p === "...") unheld = true;
        const prev = a[n - 1];
        const keyAt = prev?.k === "p" && (prev.v === "{" || prev.v === ",");
        const modifierAt = (prev?.k === "id" && /^(get|set|async)$/.test(prev.v)) || (prev?.k === "p" && prev.v === "*");
        if (!sqlName(x) || !(keyAt || modifierAt)) continue;
        const next = a[n + 1];
        if (keyAt && next?.k === "p" && next.v === ":") sqlAt = n;
        else if (keyAt && x.k === "id" && next?.k === "p" && (next.v === "," || next.v === "}")) shorthand = x;
        else unheld = true;
      }
      if (unheld) {
        sink.counts.channels += 1;
        sink.add({ line, kind: "SQL_CALL", channel, excerpt, verdict: "DYNAMIC", detail: "a query config the source does not hold (a spread, a computed key, or a text getter or method)" });
        return;
      }
      if (sqlAt >= 0) a = a.slice(sqlAt + 2, jsExprEnd(a, sqlAt + 2));
      else if (shorthand) a = [shorthand];
      else return;
    }
    sink.counts.channels += 1;
    if (payloadGated(a)) {
      sink.counts.gated += 1;
      return;
    }
    // copyFrom(sql) / copyTo(sql) (pg-copy-streams): the COPY statement
    const copyCall = callOf(a);
    if (copyCall && /^(copyFrom|copyTo)$/.test(copyCall.name) && copyCall.args[0]) a = stripParens(copyCall.args[0]);
    if (payloadGated(a)) {
      sink.counts.gated += 1;
      return;
    }
    const folded = foldExpr(a, { ...ctx, paramTemplates: params }, 0);
    judgeFoldedSql(folded, line, channel, excerpt, pos);
  }

  function judgeFoldedSql(folded: Folded, line: number, channel: string, excerpt: string, pos: number): void {
    if (folded.texts.some((x) => sqlVerbDynamic(x)) || !folded.literal) {
      sink.add({ line, kind: "SQL_CALL", channel, excerpt, verdict: "DYNAMIC", detail: "the SQL text (or its verb) is not in the source" });
      return;
    }
    let v: TextVerdict = ALLOWED;
    let gatedHit = false;
    for (const text of folded.texts) {
      const c = classifySqlText(text, def) ?? ALLOWED;
      if (c.verdict === "UNRESOLVABLE") {
        const s = substituteGated(text, checkedBefore(pos));
        if (s !== text && (classifySqlText(s, def) ?? ALLOWED).verdict === "ALLOWED") {
          gatedHit = true;
          continue;
        }
      }
      v = worst(v, c);
    }
    if (v.verdict !== "ALLOWED") sink.add({ line, kind: "SQL_CALL", channel, excerpt, verdict: v.verdict, detail: v.detail });
    else if (gatedHit) sink.counts.gated += 1;
    else sink.counts.allowed += 1;
  }

  function judgeCommand(texts: readonly string[], line: number, channel: string, excerpt: string, pos: number, stdin: string[] | null): void {
    let v: TextVerdict = ALLOWED;
    let gatedHit = false;
    let dynamicWhy: string | null = null;
    for (const text of texts) {
      const variants = stdin ? stdin.map((s) => `${text} <<'WU30F2_STDIN_EOF'\n${s}\nWU30F2_STDIN_EOF`) : [text];
      for (const command of variants) {
        const c = classifyCommandText(command, def, readSqlFile) ?? ALLOWED;
        if (c.verdict === "UNRESOLVABLE") {
          const s = substituteGated(command, checkedBefore(pos));
          if (s !== command && (classifyCommandText(s, def, readSqlFile) ?? ALLOWED).verdict === "ALLOWED") {
            gatedHit = true;
            continue;
          }
        }
        v = worst(v, c);
      }
      dynamicWhy ??= commandDynamic(text);
    }
    if (v.verdict !== "ALLOWED") sink.add({ line, kind: "PROCESS", channel, excerpt, verdict: v.verdict, detail: v.detail });
    else if (dynamicWhy) sink.add({ line, kind: "PROCESS", channel, excerpt, verdict: "DYNAMIC", detail: dynamicWhy });
    else if (gatedHit) sink.counts.gated += 1;
    else sink.counts.allowed += 1;
  }

  function judgeCmdPayload(args: readonly Tok[][], line: number, channel: string, excerpt: string, pos: number): void {
    const arg = args[0] ?? [];
    if (payloadGated(arg)) {
      sink.counts.gated += 1;
      return;
    }
    const folded = foldExpr(arg, ctx, 0);
    if (!folded.literal) {
      sink.add({ line, kind: "PROCESS", channel, excerpt, verdict: "DYNAMIC", detail: "the command line is not in the source" });
      return;
    }
    judgeCommand(folded.texts, line, channel, excerpt, pos, stdinOf(args.slice(1)));
  }

  function judgeArgvPayload(args: readonly Tok[][], line: number, channel: string, excerpt: string, pos: number): void {
    const programArg = args[0] ?? [];
    const argvArg = args[1] && args[1][0]?.v !== "{" ? args[1] : null;
    const options = args.slice(1).find((a) => a[0]?.v === "{") ?? [];
    if ((argvArg && payloadGated(argvArg)) || payloadGated(programArg)) {
      sink.counts.gated += 1;
      return;
    }
    const programs = foldExpr(programArg, ctx, 0).texts;
    const alts = argvArg === null ? [] : arrayAlternatives(argvArg, ctx, 0);
    const argvs = alts === null ? null : argvCombos(alts);
    const shell = options.some((x, n) => x.v === "shell" && options[n + 1]?.v === ":" && options[n + 2]?.v !== "false");
    const stdin = stdinOf(args.slice(1));
    if (shell) {
      if (argvs === null) {
        sink.add({ line, kind: "PROCESS", channel, excerpt, verdict: "DYNAMIC", detail: "shell command with arguments that are not in the source" });
        return;
      }
      judgeCommand(programs.flatMap((p) => argvs.map((argv) => [p, ...argv].join(" "))), line, channel, excerpt, pos, stdin);
      return;
    }
    let v: TextVerdict = ALLOWED;
    let gatedHit = false;
    let dynamicWhy: string | null = null;
    for (const [program, argv] of programs.flatMap((p) => (argvs === null ? [[p, null] as const] : argvs.map((a) => [p, a] as const)))) {
      if (argv === null) {
        const kind = programKind(program);
        if (kind === "DYNAMIC") dynamicWhy ??= "the program is chosen at run time";
        else if (kind === "TOOL" || kind === "SHELL" || RUNNERS.has(programBase(program)) || RUNS_OTHERS.has(programBase(program))) dynamicWhy ??= `${programBase(program)} with arguments that are not in the source`;
        continue;
      }
      const full = [program, ...argv];
      const verdicts = stdin ? stdin.map((s) => classifyArgvWithStdin(full, s, def, readSqlFile)) : [classifyArgv(full, def, readSqlFile)];
      for (const c of verdicts) {
        if (c.verdict === "UNRESOLVABLE") {
          const checked = checkedBefore(pos);
          const sub = full.map((a) => substituteGated(a, checked));
          if (sub.some((a, n) => a !== full[n]) && classifyArgv(sub, def, readSqlFile).verdict === "ALLOWED") {
            gatedHit = true;
            continue;
          }
        }
        v = worst(v, c);
      }
      dynamicWhy ??= argvDynamic(full);
    }
    if (v.verdict !== "ALLOWED") sink.add({ line, kind: "PROCESS", channel, excerpt, verdict: v.verdict, detail: v.detail });
    else if (dynamicWhy) sink.add({ line, kind: "PROCESS", channel, excerpt, verdict: "DYNAMIC", detail: dynamicWhy });
    else if (gatedHit) sink.counts.gated += 1;
    else sink.counts.allowed += 1;
  }
}

// =============================================================================================
// Python reader
// =============================================================================================

function lexPy(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  let line = 1;
  let depth = 0;
  let nl = false;
  const push = (t: Omit<Tok, "nl">) => {
    toks.push({ ...t, nl });
    nl = false;
  };
  while (i < src.length) {
    const c = src[i]!;
    if (c === "\n") {
      if (depth === 0) push({ k: "nl", v: "\n", pos: i, end: i + 1, line });
      else nl = true;
      line += 1;
      i += 1;
      continue;
    }
    if (c === "\\" && (src[i + 1] === "\n" || (src[i + 1] === "\r" && src[i + 2] === "\n"))) {
      i += src[i + 1] === "\r" ? 3 : 2;
      line += 1;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r" || c === "\f") {
      i += 1;
      continue;
    }
    if (c === "#") {
      while (i < src.length && src[i] !== "\n") i += 1;
      continue;
    }
    const pm = /^([rRbBuUfF]{0,2})('''|"""|'|")/.exec(src.slice(i, i + 5));
    if (pm && (pm[1] === "" || isIdStart(src[i]!))) {
      const prefix = pm[1]!.toLowerCase();
      const q = pm[2]!;
      const raw = prefix.includes("r");
      const f = prefix.includes("f");
      let j = i + pm[0].length;
      const startLine = line;
      const parts: (string | { src: string; toks: Tok[] })[] = [];
      let cur = "";
      let closed = false;
      while (j < src.length) {
        if (src.startsWith(q, j)) {
          closed = true;
          j += q.length;
          break;
        }
        const d = src[j]!;
        if (d === "\n") {
          if (q.length === 1) break;
          line += 1;
        }
        if (d === "\\" && !raw) {
          const [val, nj] = decodeJsEscape(src, j);
          cur += val;
          j = nj;
          continue;
        }
        if (d === "\\" && raw) {
          cur += src.slice(j, j + 2);
          j += 2;
          continue;
        }
        if (f && d === "{") {
          if (src[j + 1] === "{") {
            cur += "{";
            j += 2;
            continue;
          }
          let k = j + 1;
          let b = 1;
          while (k < src.length && b > 0) {
            if (src[k] === "{") b += 1;
            else if (src[k] === "}") b -= 1;
            else if (src[k] === "'" || src[k] === '"') {
              const e = src.indexOf(src[k]!, k + 1);
              if (e > 0) k = e;
            }
            if (b > 0) k += 1;
          }
          const exprSrc = src.slice(j + 1, k).replace(/(![rsa])?(:[^}]*)?$/, "");
          parts.push(cur);
          cur = "";
          // positions shifted to the file (scope lookups compare them with function ranges)
          const shift = j + 1;
          parts.push({ src: exprSrc, toks: lexPy(exprSrc).filter((x) => x.k !== "nl").map((x) => ({ ...x, pos: x.pos + shift, end: x.end + shift })) });
          j = k + 1;
          continue;
        }
        if (f && d === "}" && src[j + 1] === "}") {
          cur += "}";
          j += 2;
          continue;
        }
        cur += d;
        j += 1;
      }
      parts.push(cur);
      if (closed) {
        push({ k: "str", v: parts.filter((p) => typeof p === "string").join(""), pos: i, end: j, line: startLine, parts: f ? parts : undefined });
        i = j;
        continue;
      }
    }
    if (isIdStart(c)) {
      let j = i + 1;
      while (j < src.length && isIdPart(src[j]!)) j += 1;
      push({ k: "id", v: src.slice(i, j), pos: i, end: j, line });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[0-9A-Za-z_.]/.test(src[j]!)) j += 1;
      push({ k: "num", v: src.slice(i, j), pos: i, end: j, line });
      i = j;
      continue;
    }
    if ("([{".includes(c)) depth += 1;
    if (")]}".includes(c)) depth = Math.max(0, depth - 1);
    const op = ["**", "//", "==", "!=", "<=", ">=", "+=", "-=", "->", ":="].find((o) => src.startsWith(o, i)) ?? c;
    push({ k: "p", v: op, pos: i, end: i + op.length, line });
    i += op.length;
  }
  return toks;
}

/** Python function scopes: `def name(params):` through the last line indented deeper than the def. */
function pyScopes(src: string, toks: readonly Tok[]): JsScope[] {
  const out: JsScope[] = [];
  const col = (pos: number) => pos - (src.lastIndexOf("\n", pos - 1) + 1);
  for (let k = 0; k < toks.length; k += 1) {
    const t = toks[k]!;
    if (t.k !== "id" || t.v !== "def" || toks[k + 1]?.k !== "id" || toks[k + 2]?.v !== "(") continue;
    const close = matchClose(toks, k + 2);
    const params = new Set(toks.slice(k + 3, close).filter((x) => x.k === "id").map((x) => x.v));
    const defCol = col(t.pos);
    let end = src.length;
    for (let m = close + 1; m < toks.length; m += 1) {
      if (toks[m]!.k !== "nl") continue;
      const next = toks[m + 1];
      if (next && next.k !== "nl" && col(next.pos) <= defCol) {
        end = next.pos;
        break;
      }
    }
    out.push({ id: out.length, from: toks[k + 2]!.pos, to: end, params });
  }
  return out;
}

function pyStatementEnd(list: readonly Tok[], start: number): number {
  for (let k = start; k < list.length; k += 1) if (list[k]!.k === "nl" || (list[k]!.k === "p" && list[k]!.v === ";")) return k;
  return list.length;
}

const PY_GATES = new Set(["gated_sql", "assert_command_write_allowed", "assert_ogr2ogr_write_allowed"]);
const PY_RELATION_GATES = new Set(["assert_ungoverned_write_allowed"]);
const PY_SQL_METHODS = new Set(["execute", "executemany", "executescript", "copy_expert", "copy_from", "copy", "exec_driver_sql"]);
const PY_PROCESS: Record<string, "auto"> = { run: "auto", call: "auto", check_call: "auto", check_output: "auto", Popen: "auto", getoutput: "auto", getstatusoutput: "auto", system: "auto", popen: "auto" };

/** U30F3 M-2: Python database and process clients whose calls the scan does not read: any import of one is DYNAMIC. */
const PY_UNREAD_MODULES = new Set([
  "pg8000", "postgresql", "aiopg", "databases", "records", "dataset", "peewee", "pony", "duckdb", "sqlmodel", "tortoise",
  "sh", "plumbum", "pexpect", "ptyprocess", "pty", "fabric", "invoke", "paramiko", "asyncssh", "commands", "popen2",
  // U30F5 (D-6): GDAL for Python (the ogr2ogr family: VectorTranslate, write_dataframe, a PG: layer) and polars write_database
  "osgeo", "gdal", "ogr", "pyogrio", "fiona", "rasterio", "polars",
]);
/** Modules whose channels the scan reads (by method or function name): followed through `as` renames; `*` is not followed. */
const PY_READ_MODULES = new Set(["subprocess", "os", "psycopg2", "psycopg", "asyncpg", "sqlalchemy", "asyncio", "importlib", "pandas"]);
/**
 * U30F4 (B2): methods that execute their first argument as SQL in a client the file imports (asyncpg fetch*, prepare,
 * cursor, copy_from_query; SQLAlchemy scalar(s); psycopg 3 stream; pandas read_sql*). Judged like execute().
 */
const PY_MODULE_SQL_METHODS: Readonly<Record<string, readonly string[]>> = {
  asyncpg: ["fetch", "fetchrow", "fetchval", "fetchmany", "prepare", "cursor", "copy_from_query"],
  sqlalchemy: ["scalar", "scalars"],
  psycopg: ["stream"],
  pandas: ["read_sql", "read_sql_query"],
};
/** `.copy(x)` receivers that copy files or objects, not SQL. */
const PY_COPY_NOT_SQL = /^(shutil|copy|np|numpy|torch|tf|pd|pandas|deepcopy)$/;

interface PyModuleSurface {
  /** `import subprocess as sp`: sp -> subprocess. */
  readonly moduleAliases: ReadonlyMap<string, string>;
  /** `from subprocess import run as r`: r -> { module: subprocess, fn: run } (also unrenamed names). */
  readonly fnImports: ReadonlyMap<string, { readonly module: string; readonly fn: string }>;
  /** U30F4: the top-level name of every module the file imports. */
  readonly imported: ReadonlySet<string>;
}

/**
 * U30F3 M-2: every import of a Python file. A database/process client the scan does not read and a `*` import of a
 * read module are DYNAMIC sites; `as` renames of read modules and their functions are returned for the channel loop.
 */
function pyModuleSurface(toks: readonly Tok[], src: string, sink: SiteSink): PyModuleSurface {
  const moduleAliases = new Map<string, string>();
  const fnImports = new Map<string, { module: string; fn: string }>();
  const imported = new Set<string>();
  /** `a.b.c` (or a relative `.a`) starting at `from`: identifiers joined by dots, never two identifiers in a row. */
  const dotted = (from: number): { name: string; end: number } => {
    let k = from;
    let name = "";
    let wantId = true;
    while (toks[k]) {
      const x = toks[k]!;
      if (x.k === "p" && x.v === ".") wantId = true;
      else if (x.k === "id" && wantId) wantId = false;
      else break;
      name += x.v;
      k += 1;
    }
    return { name, end: k };
  };
  const statementEnd = (from: number): number => {
    let k = from;
    let depth = 0;
    for (; k < toks.length; k += 1) {
      const x = toks[k]!;
      if (isOpen(x)) depth += 1;
      else if (isClose(x)) depth -= 1;
      else if (depth <= 0 && (x.k === "nl" || (x.k === "p" && x.v === ";"))) break;
    }
    return k;
  };
  const top = (m: string) => m.split(".")[0]!;
  for (let k = 0; k < toks.length; k += 1) {
    const t = toks[k]!;
    const prev = toks[k - 1];
    if (t.k !== "id" || !(t.v === "import" || t.v === "from") || !(!prev || prev.k === "nl" || (prev.k === "p" && prev.v === ";"))) continue;
    const end = statementEnd(k);
    const stmt = toks.slice(k, end);
    const excerpt = excerptOf(src, t.pos, toks[end - 1]!.end);
    const flag = (m: string, why: string) => sink.add({ line: t.line, kind: "PROCESS", channel: `import ${m}`, excerpt, verdict: "DYNAMIC", detail: why });
    if (t.v === "import") {
      for (const part of splitTop(stmt.slice(1), (x) => x.k === "p" && x.v === ",")) {
        const d = dotted(k + 1 + stmt.slice(1).indexOf(part[0]!));
        const m = d.name;
        imported.add(top(m));
        if (PY_UNREAD_MODULES.has(top(m))) flag(m, `${m}: a database or process client whose calls the scan does not read (U30F3 M-2: fail-closed)`);
        const asAt = part.findIndex((x) => x.k === "id" && x.v === "as");
        if (asAt >= 0 && part[asAt + 1]?.k === "id" && PY_READ_MODULES.has(top(m))) moduleAliases.set(part[asAt + 1]!.v, m);
      }
      continue;
    }
    // from <module> import <names> | *
    const d = dotted(k + 1);
    const m = d.name;
    if (toks[d.end]?.v !== "import") continue;
    imported.add(top(m));
    if (PY_UNREAD_MODULES.has(top(m))) {
      flag(m, `${m}: a database or process client whose calls the scan does not read (U30F3 M-2: fail-closed)`);
      continue;
    }
    if (!PY_READ_MODULES.has(top(m))) continue;
    const names = stmt.slice(d.end - k + 1).filter((x) => !(x.k === "p" && (x.v === "(" || x.v === ")")));
    if (names.some((x) => x.k === "p" && x.v === "*")) {
      flag(m, `from ${m} import *: the names it brings in are not followed`);
      continue;
    }
    for (const part of splitTop(names, (x) => x.k === "p" && x.v === ",")) {
      const p = part.filter((x) => x.k !== "nl");
      if (p.length === 1 && p[0]!.k === "id") fnImports.set(p[0]!.v, { module: m, fn: p[0]!.v });
      else if (p.length === 3 && p[1]!.v === "as" && p[0]!.k === "id" && p[2]!.k === "id") fnImports.set(p[2]!.v, { module: m, fn: p[0]!.v });
    }
  }
  return { moduleAliases, fnImports, imported };
}

function scanPy(src: string, sink: SiteSink, def: ProtectedRelationsDefinition, readSqlFile: (p: string) => string | null, readRepo?: (p: string) => string | null): void {
  const toks = lexPy(src);
  const bindings = new Map<string, Tok[][]>();
  const bindingRanges: { name: string; from: number; to: number }[] = [];
  for (let k = 0; k < toks.length; k += 1) {
    const t = toks[k]!;
    const prev = toks[k - 1];
    const atStatement = !prev || prev.k === "nl" || (prev.k === "p" && prev.v === ";");
    if (t.k === "id" && atStatement) {
      let m = k + 1;
      if (toks[m]?.v === ":") while (m < toks.length && toks[m]!.v !== "=" && toks[m]!.k !== "nl") m += 1;
      if (toks[m]?.k === "p" && (toks[m]!.v === "=" || toks[m]!.v === "+=")) {
        const end = pyStatementEnd(toks, m + 1);
        const expr = toks.slice(m + 1, end);
        if (expr.length) {
          addBinding(bindings, t.v, expr);
          bindingRanges.push({ name: t.v, from: expr[0]!.pos, to: expr[expr.length - 1]!.end });
        }
      }
    }
    // for X in <iterable>:  X is each element
    if (t.k === "id" && t.v === "for" && atStatement && toks[k + 1]?.k === "id" && toks[k + 2]?.k === "id" && toks[k + 2]!.v === "in") {
      let colon = k + 3;
      let depth = 0;
      for (; colon < toks.length; colon += 1) {
        const x = toks[colon]!;
        if (isOpen(x)) depth += 1;
        else if (isClose(x)) depth -= 1;
        else if (depth === 0 && (x.v === ":" || x.k === "nl")) break;
      }
      addBinding(bindings, `elem:${toks[k + 1]!.v}`, toks.slice(k + 3, colon));
    }
    // X.append(a) / X.extend([...]) / X += [...]
    if (t.k === "id" && toks[k + 1]?.v === "." && (toks[k + 2]?.v === "append" || toks[k + 2]?.v === "extend") && toks[k + 3]?.v === "(") {
      const close = matchClose(toks, k + 3);
      const inner = toks.slice(k + 4, close);
      if (toks[k + 2]!.v === "append") addBinding(bindings, `${t.v}.push`, inner);
      else {
        const els = inner[0]?.v === "[" ? inner.slice(1, -1) : null;
        if (els) addBinding(bindings, `${t.v}.push`, els);
        else addBinding(bindings, `${t.v}.push`, [{ ...inner[0]!, k: "p", v: "*" }, ...inner]);
      }
    }
  }
  const ctx: FoldContext = { src, bindings, lang: "py", readRepoFile: readRepo, scopes: pyScopes(src, toks) };
  const ranges: { from: number; to: number }[] = [];
  const gatedIds = new Set<string>();
  const relations: { expr: string; pos: number }[] = [];
  toks.forEach((t, k) => {
    if (t.k !== "id" || toks[k + 1]?.v !== "(") return;
    const close = matchClose(toks, k + 1);
    if (PY_GATES.has(t.v)) {
      ranges.push({ from: toks[k + 1]!.pos, to: toks[close]!.end });
      for (const a of toks.slice(k + 2, close)) if (a.k === "id") gatedIds.add(a.v);
    }
    if (PY_RELATION_GATES.has(t.v)) {
      const args = argsOf(toks, k + 1);
      const rel = args[2];
      if (rel) {
        const f = foldExpr(rel, ctx, 0);
        relations.push({ expr: f.texts.length === 1 && containsDynamic(f.texts[0]!) ? f.texts[0]! : hintOf(rel, src), pos: t.pos });
      }
    }
  });
  const gating: Gating = { ranges, ids: gatedIds, relations: [] };
  const pyCalls = callIndex([toks], src);
  const literalGated = (pos: number) => inRanges(pos, ranges) || bindingRanges.some((r) => pos >= r.from && pos < r.to && gatedIds.has(r.name));
  const relationGatedPy = (text: string, pos: number): boolean => {
    const checked = relations.filter((r) => r.pos < pos).map((r) => r.expr);
    let replaced = text;
    checked.forEach((expr, n) => {
      const placeholder = containsDynamic(expr) ? expr : dyn(expr);
      replaced = replaced.split(placeholder).join(`gate_checked_relation_${n}`);
    });
    if (replaced === text) return false;
    const v = classifySqlText(replaced, def);
    return v === null || v.verdict === "ALLOWED";
  };
  void gating;

  // literal surface
  const seen = new Set<number>();
  for (let k = 0; k < toks.length; k += 1) {
    const t = toks[k]!;
    if (t.k !== "str" || seen.has(t.pos)) continue;
    let end = k + 1;
    for (;;) {
      if (toks[end]?.k === "str") end += 1;
      else if (toks[end]?.k === "p" && toks[end]!.v === "+" && (toks[end + 1]?.k === "str" || toks[end + 1]?.k === "id")) end += 2;
      else break;
    }
    for (let n = k; n < end; n += 1) if (toks[n]!.k === "str") seen.add(toks[n]!.pos);
    const folded = foldExpr(toks.slice(k, end), ctx, 0);
    sink.counts.literals += 1;
    const pyCall = innermostCall(pyCalls, t.pos);
    if (pyCall && MESSAGE_CALL.test(pyCall.name)) continue;
    if (toks[k - 1]?.k === "id" && toks[k - 1]!.v === "raise") continue;
    for (const text of folded.texts) {
      const v = classifyLiteral(text, def, readSqlFile);
      if (!v || v.verdict === "ALLOWED") continue;
      if (literalGated(t.pos) || (v.verdict === "UNRESOLVABLE" && relationGatedPy(text, t.pos))) {
        sink.counts.gated += 1;
        continue;
      }
      sink.add({ line: t.line, kind: "SQL_TEXT", channel: "literal", excerpt: excerptOf(src, t.pos, toks[end - 1]!.end), verdict: v.verdict, detail: v.detail });
      break;
    }
  }

  // channels
  const checkedBefore = (pos: number): string[] => relations.filter((r) => r.pos < pos).map((r) => (containsDynamic(r.expr) ? r.expr : dyn(r.expr)));
  const pySurface = pyModuleSurface(toks, src, sink);
  const SENSITIVE_PY = /^(subprocess|os|psycopg2|psycopg|asyncpg|sqlalchemy|asyncio|importlib)$/;

  /** One SQL payload (a SQL channel's argument), judged as the gate judges it. */
  function judgePySql(arg: readonly Tok[], line: number, channel: string, excerpt: string, pos: number): void {
    sink.counts.channels += 1;
    if (inRanges(arg[0]?.pos ?? -1, ranges) || (arg.length >= 1 && arg[0]!.k === "id" && PY_GATES.has(arg[0]!.v)) || (arg.length === 1 && gatedIds.has(arg[0]!.v))) {
      sink.counts.gated += 1;
      return;
    }
    // text('...') (SQLAlchemy)
    const inner = arg.length >= 3 && arg[0]!.v === "text" && arg[1]!.v === "(" ? arg.slice(2, -1) : arg;
    const folded = foldExpr(inner, ctx, 0);
    if (!folded.literal || folded.texts.some((x) => sqlVerbDynamic(x))) {
      sink.add({ line, kind: "SQL_CALL", channel, excerpt, verdict: "DYNAMIC", detail: "the SQL text (or its verb) is not in the source" });
      return;
    }
    let v: TextVerdict = ALLOWED;
    let gatedHit = false;
    for (const text of folded.texts) {
      const c = classifySqlText(text, def) ?? ALLOWED;
      if (c.verdict === "UNRESOLVABLE") {
        const s = substituteGated(text, checkedBefore(pos));
        if (s !== text && (classifySqlText(s, def) ?? ALLOWED).verdict === "ALLOWED") {
          gatedHit = true;
          continue;
        }
      }
      v = worst(v, c);
    }
    if (v.verdict !== "ALLOWED") sink.add({ line, kind: "SQL_CALL", channel, excerpt, verdict: v.verdict, detail: v.detail });
    else if (gatedHit) sink.counts.gated += 1;
    else sink.counts.allowed += 1;
  }

  for (let k = 0; k < toks.length; k += 1) {
    const t = toks[k]!;
    if (t.k !== "id" || toks[k + 1]?.v !== "(") continue;
    if (toks[k - 1]?.k === "id" && toks[k - 1]!.v === "def") continue;
    const receiver = receiverOf(toks, k);
    const close = matchClose(toks, k + 1);
    const excerpt = excerptOf(src, receiver ? toks[k - 2]!.pos : t.pos, toks[close]!.end);
    const args = argsOf(toks, k + 1);
    const kw = (name: string) => args.find((a) => a[0]?.k === "id" && a[0].v === name && a[1]?.v === "=")?.slice(2) ?? null;
    const channel = `${receiver ? `${receiver}.` : ""}${t.v}`;
    // U30F3 M-2: what module a receiver or a bare function name comes from (`as` renames followed)
    const recvModule = receiver !== null && receiver !== "" ? (pySurface.moduleAliases.get(receiver) ?? receiver) : null;
    const imp = receiver === null ? (pySurface.fnImports.get(t.v) ?? null) : null;
    const fnName = imp ? imp.fn : t.v;
    const staticArg = (a: readonly Tok[] | undefined) => a !== undefined && a.length === 1 && a[0]!.k === "str" && !a[0]!.parts;
    const dynamicSite = (detail: string) => sink.add({ line: t.line, kind: "PROCESS", channel, excerpt, verdict: "DYNAMIC", detail });
    // eval / exec / compile of code the source does not hold; __import__ / import_module / getattr on a client module
    if (receiver === null && !imp && /^(exec|eval|compile)$/.test(t.v)) {
      if (!staticArg(args[0])) dynamicSite("evaluates code the source does not hold");
      continue;
    }
    if ((receiver === null && t.v === "__import__") || (t.v === "import_module" && (recvModule === "importlib" || imp?.module === "importlib"))) {
      const a = args[0];
      if (!staticArg(a) || SENSITIVE_PY.test(a![0]!.v.split(".")[0]!) || PY_UNREAD_MODULES.has(a![0]!.v.split(".")[0]!)) dynamicSite("imports a database or process module (or one named at run time) in a way the scan does not follow");
      continue;
    }
    if (receiver === null && t.v === "getattr") {
      const a = args[0];
      const target = a && a.length === 1 && a[0]!.k === "id" ? (pySurface.moduleAliases.get(a[0]!.v) ?? a[0]!.v) : null;
      if (target !== null && SENSITIVE_PY.test(target.split(".")[0]!)) dynamicSite("a function of a database or process module chosen at run time");
      continue;
    }
    // psycopg2.extras.execute_values / execute_batch(cur, sql, ...): the SQL is the second argument
    if ((fnName === "execute_values" || fnName === "execute_batch") && (imp?.module.startsWith("psycopg2") || /^(extras|psycopg2\.extras)$/.test(recvModule ?? "") || receiver === "")) {
      judgePySql(args[1] ?? [], t.line, channel, excerpt, t.pos);
      continue;
    }
    // asyncpg copy_records_to_table / copy_to_table: rows into <schema_name>.<table_name>
    if ((t.v === "copy_records_to_table" || t.v === "copy_to_table") && receiver !== null) {
      sink.counts.channels += 1;
      const name = foldExpr(args[0] && args[0][1]?.v !== "=" ? args[0] : (kw("table_name") ?? []), ctx, 0).texts;
      const schema = kw("schema_name") ? foldExpr(kw("schema_name")!, ctx, 0).texts : [null];
      let v: TextVerdict = ALLOWED;
      for (const n of name) {
        for (const s of schema) {
          const sql = `COPY ${s === null ? `"${n}"` : `"${s}"."${n}"`} FROM STDIN`;
          v = worst(v, containsDynamic(sql) ? { verdict: "UNRESOLVABLE", detail: "COPY_FROM" } : (classifySqlText(sql, def) ?? ALLOWED));
        }
      }
      if (v.verdict === "ALLOWED") sink.counts.allowed += 1;
      else sink.add({ line: t.line, kind: "SQL_CALL", channel, excerpt, verdict: v.verdict, detail: v.detail });
      continue;
    }
    // U30F4 (B2): SQL-executing methods of an imported client; pandas read_sql* (pd.read_sql or imported by name)
    const viaModule = Object.entries(PY_MODULE_SQL_METHODS).find(([m, methods]) => methods.includes(fnName) && (pySurface.imported.has(m) || recvModule === m || imp?.module.split(".")[0] === m));
    if (viaModule && (receiver !== null || imp !== null) && args.length >= 1 && args[0]![1]?.v !== "=" && (viaModule[0] !== "pandas" || recvModule === "pandas" || imp?.module.split(".")[0] === "pandas")) {
      judgePySql(args[0]!, t.line, channel, excerpt, t.pos);
      continue;
    }
    // U30F4 (B2): a stored procedure call (its body is not in the source); SQLAlchemy writes whose tables the scan does not resolve
    if (t.v === "callproc" && receiver !== null) {
      dynamicSite("calls a database function whose body the source does not hold");
      continue;
    }
    if (pySurface.imported.has("sqlalchemy") && receiver !== null) {
      const chain = toks.slice(Math.max(0, k - 60), k);
      const lastNl = chain.map((x) => x.k).lastIndexOf("nl");
      const onQuery = chain.slice(lastNl + 1).some((x, n, a) => x.k === "id" && x.v === "query" && a[n + 1]?.v === "(");
      if (t.v === "drop_all" || t.v === "create_all" || ((t.v === "drop" || t.v === "create") && args.length >= 1) || ((t.v === "delete" || t.v === "update") && onQuery)) {
        sink.counts.channels += 1;
        sink.add({ line: t.line, kind: "SQL_CALL", channel, excerpt, verdict: "DYNAMIC", detail: "a SQLAlchemy write whose tables the scan does not resolve" });
        continue;
      }
    }
    const copyLike = t.v !== "copy" || (receiver !== null && !PY_COPY_NOT_SQL.test(receiver) && args.length >= 1 && args[0]![1]?.v !== "=");
    if (PY_SQL_METHODS.has(t.v) && receiver !== null && copyLike) {
      // (U30F3 M-2: a chained receiver -- conn.cursor().execute(...) -- is a channel too)
      judgePySql(args[0] ?? [], t.line, channel, excerpt, t.pos);
      continue;
    }
    if ((t.v === "to_sql" || t.v === "to_postgis") && receiver !== null) {
      sink.counts.channels += 1;
      const name = foldExpr(args[0] ?? kw("name") ?? [], ctx, 0).texts;
      const schema = kw("schema") ? foldExpr(kw("schema")!, ctx, 0).texts : [null];
      const ifExists = kw("if_exists") ? foldExpr(kw("if_exists")!, ctx, 0).texts : ["fail"];
      let v: TextVerdict = ALLOWED;
      for (const n of name) {
        for (const s of schema) {
          for (const mode of ifExists) {
            const rel = s === null ? `"${n}"` : `"${s}"."${n}"`;
            const sql = mode === "replace" ? `DROP TABLE ${rel}; CREATE TABLE ${rel} (x int)` : mode === "append" ? `INSERT INTO ${rel} VALUES (1)` : `CREATE TABLE ${rel} (x int)`;
            v = worst(v, containsDynamic(sql) ? { verdict: "UNRESOLVABLE", detail: `${t.v.toUpperCase()}` } : (classifySqlText(sql, def) ?? ALLOWED));
          }
        }
      }
      if (v.verdict === "ALLOWED") sink.counts.allowed += 1;
      else sink.add({ line: t.line, kind: "SQL_CALL", channel, excerpt, verdict: v.verdict, detail: v.detail });
      continue;
    }
    // asyncio.create_subprocess_shell(cmd) / create_subprocess_exec(program, *args)
    if ((fnName === "create_subprocess_shell" || fnName === "create_subprocess_exec") && (recvModule === "asyncio" || recvModule === "asyncio.subprocess" || imp?.module.startsWith("asyncio"))) {
      sink.counts.channels += 1;
      if (fnName === "create_subprocess_exec") {
        const positional = args.filter((a) => a[1]?.v !== "=");
        if (positional.some((a) => a[0]?.k === "p" && a[0]!.v === "*")) {
          sink.add({ line: t.line, kind: "PROCESS", channel, excerpt, verdict: "DYNAMIC", detail: "arguments spread from a value the source does not hold" });
          continue;
        }
        judgeArgvPy(argvCombos(positional.map((a) => foldExpr(a, ctx, 0).texts)), t.line, channel, excerpt, t.pos, null);
        continue;
      }
      const folded = foldExpr(args[0] ?? [], ctx, 0);
      let v: TextVerdict = ALLOWED;
      let dynamicWhy: string | null = folded.literal ? null : "the command is not in the source";
      for (const text of folded.texts) {
        v = worst(v, classifyCommandText(text, def, readSqlFile) ?? ALLOWED);
        dynamicWhy ??= commandDynamic(text);
      }
      if (v.verdict !== "ALLOWED") sink.add({ line: t.line, kind: "PROCESS", channel, excerpt, verdict: v.verdict, detail: v.detail });
      else if (dynamicWhy) sink.add({ line: t.line, kind: "PROCESS", channel, excerpt, verdict: "DYNAMIC", detail: dynamicWhy });
      else sink.counts.allowed += 1;
      continue;
    }
    const imported = receiver === null && (imp ? imp.module === "subprocess" || imp.module === "os" : new RegExp(`from\\s+subprocess\\s+import[^\\n]*\\b${t.v}\\b`).test(src));
    const isProcess = own(PY_PROCESS, fnName) !== undefined && (recvModule === "subprocess" || recvModule === "os" || imported);
    if (isProcess || (recvModule === "os" && /^(exec[lv]p?e?|spawn[lv]p?e?)$/.test(t.v))) {
      sink.counts.channels += 1;
      const arg = args[0] ?? [];
      if ((arg.length >= 1 && arg[0]!.k === "id" && PY_GATES.has(arg[0]!.v)) || (arg.length === 1 && gatedIds.has(arg[0]!.v))) {
        sink.counts.gated += 1;
        continue;
      }
      const shellKw = kw("shell");
      const shell = recvModule === "os" || imp?.module === "os" || (shellKw !== null && shellKw[0]?.v === "True") || fnName === "getoutput" || fnName === "getstatusoutput";
      const inputKw = kw("input");
      const stdin = inputKw ? foldExpr(inputKw, ctx, 0).texts : null;
      const alts = arrayAlternatives(arg, ctx, 0);
      if (alts && !shell) {
        judgeArgvPy(argvCombos(alts), t.line, channel, excerpt, t.pos, stdin);
        continue;
      }
      const folded = foldExpr(arg, ctx, 0);
      if (!folded.literal) {
        sink.add({ line: t.line, kind: "PROCESS", channel, excerpt, verdict: "DYNAMIC", detail: "the command is not in the source" });
        continue;
      }
      let v: TextVerdict = ALLOWED;
      let dynamicWhy: string | null = null;
      for (const text of folded.texts) {
        const variants = stdin ? stdin.map((s) => `${text} <<'WU30F2_STDIN_EOF'\n${s}\nWU30F2_STDIN_EOF`) : [text];
        for (const command of variants) v = worst(v, classifyCommandText(command, def, readSqlFile) ?? ALLOWED);
        dynamicWhy ??= commandDynamic(text);
      }
      if (v.verdict !== "ALLOWED") sink.add({ line: t.line, kind: "PROCESS", channel, excerpt, verdict: v.verdict, detail: v.detail });
      else if (dynamicWhy) sink.add({ line: t.line, kind: "PROCESS", channel, excerpt, verdict: "DYNAMIC", detail: dynamicWhy });
      else sink.counts.allowed += 1;
    }
  }

  function judgeArgvPy(argvs: string[][], line: number, channel: string, excerpt: string, pos: number, stdin: string[] | null): void {
    let v: TextVerdict = ALLOWED;
    let gatedHit = false;
    let dynamicWhy: string | null = null;
    for (const argv of argvs) {
      const verdicts = stdin ? stdin.map((s) => classifyArgvWithStdin(argv, s, def, readSqlFile)) : [classifyArgv(argv, def, readSqlFile)];
      for (const c of verdicts) {
        if (c.verdict === "UNRESOLVABLE") {
          const checked = checkedBefore(pos);
          const sub = argv.map((a) => substituteGated(a, checked));
          if (sub.some((a, n) => a !== argv[n]) && classifyArgv(sub, def, readSqlFile).verdict === "ALLOWED") {
            gatedHit = true;
            continue;
          }
        }
        v = worst(v, c);
      }
      dynamicWhy ??= argvDynamic(argv);
    }
    if (v.verdict !== "ALLOWED") sink.add({ line, kind: "PROCESS", channel, excerpt, verdict: v.verdict, detail: v.detail });
    else if (dynamicWhy) sink.add({ line, kind: "PROCESS", channel, excerpt, verdict: "DYNAMIC", detail: dynamicWhy });
    else if (gatedHit) sink.counts.gated += 1;
    else sink.counts.allowed += 1;
  }
}

// =============================================================================================
// PowerShell reader
// =============================================================================================

/** PowerShell source without comments (strings kept), plus its string tokens and variable bindings. */
function lexPs(src: string): { code: string; toks: Tok[] } {
  const toks: Tok[] = [];
  let code = "";
  let i = 0;
  let line = 1;
  let nl = false;
  const push = (t: Omit<Tok, "nl">) => {
    toks.push({ ...t, nl });
    nl = false;
  };
  const interpolate = (body: string): (string | { src: string; toks: Tok[] })[] => {
    const parts: (string | { src: string; toks: Tok[] })[] = [];
    let cur = "";
    let j = 0;
    while (j < body.length) {
      const d = body[j]!;
      if (d === "`" && j + 1 < body.length) {
        const n = body[j + 1]!;
        cur += n === "n" ? "\n" : n === "t" ? "\t" : n === "r" ? "\r" : n === "0" ? "\0" : n;
        j += 2;
        continue;
      }
      if (d === "$" && body[j + 1] === "(") {
        let b = 0;
        let k = j + 1;
        for (; k < body.length; k += 1) {
          if (body[k] === "(") b += 1;
          else if (body[k] === ")") {
            b -= 1;
            if (b === 0) break;
          }
        }
        parts.push(cur);
        cur = "";
        parts.push({ src: body.slice(j, k + 1), toks: [] });
        j = k + 1;
        continue;
      }
      const m = /^\$(\{[^}]+\}|[A-Za-z_][A-Za-z0-9_]*(:[A-Za-z_][A-Za-z0-9_]*)?)/.exec(body.slice(j));
      if (m) {
        parts.push(cur);
        cur = "";
        const name = `$${m[1]!.replace(/[{}]/g, "")}`;
        parts.push({ src: name, toks: [{ k: "id", v: name, pos: 0, end: 0, line: 0, nl: false }] });
        j += m[0].length;
        continue;
      }
      cur += d;
      j += 1;
    }
    parts.push(cur);
    return parts;
  };
  while (i < src.length) {
    const c = src[i]!;
    if (c === "<" && src[i + 1] === "#") {
      const e = src.indexOf("#>", i + 2);
      const stop = e < 0 ? src.length : e + 2;
      const n = countNewlines(src.slice(i, stop));
      line += n;
      code += "\n".repeat(n);
      if (n) nl = true;
      i = stop;
      continue;
    }
    if (c === "#") {
      while (i < src.length && src[i] !== "\n") i += 1;
      continue;
    }
    if (c === "\n") {
      push({ k: "nl", v: "\n", pos: i, end: i + 1, line });
      code += c;
      line += 1;
      nl = true;
      i += 1;
      continue;
    }
    if (c === "@" && (src[i + 1] === "'" || src[i + 1] === '"') && /^\r?\n/.test(src.slice(i + 2, i + 4))) {
      const q = src[i + 1]!;
      const closer = `\n${q}@`;
      const bodyStart = src.indexOf("\n", i) + 1;
      const e = src.indexOf(closer, bodyStart - 1);
      const stop = e < 0 ? src.length : e + closer.length;
      const body = src.slice(bodyStart, e < 0 ? src.length : e).replace(/\r$/, "");
      push({ k: "str", v: body, pos: i, end: stop, line, parts: q === '"' ? interpolate(body) : undefined });
      const text = src.slice(i, stop);
      code += text;
      line += countNewlines(text);
      i = stop;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      let body = "";
      for (; j < src.length; j += 1) {
        const d = src[j]!;
        if (c === '"' && d === "`") {
          body += d + (src[j + 1] ?? "");
          j += 1;
          continue;
        }
        if (d === c) {
          if (src[j + 1] === c) {
            body += c === '"' ? `\`${c}` : c;
            j += 1;
            continue;
          }
          break;
        }
        body += d;
      }
      const stop = Math.min(j + 1, src.length);
      push({ k: "str", v: c === "'" ? body : body.replace(/`(.)/g, "$1"), pos: i, end: stop, line, parts: c === '"' ? interpolate(body) : undefined });
      const text = src.slice(i, stop);
      code += text;
      line += countNewlines(text);
      i = stop;
      continue;
    }
    if (c === "$" && /[A-Za-z_{]/.test(src[i + 1] ?? "")) {
      const m = /^\$(\{[^}]+\}|[A-Za-z_][A-Za-z0-9_]*(:[A-Za-z_][A-Za-z0-9_]*)?)/.exec(src.slice(i));
      if (m) {
        const name = `$${m[1]!.replace(/[{}]/g, "")}`;
        push({ k: "id", v: name.toLowerCase().replace(/^\$(script|global|local|private):/, "$"), pos: i, end: i + m[0].length, line });
        code += m[0];
        i += m[0].length;
        continue;
      }
    }
    if (c === "." && /\s/.test(src[i + 1] ?? " ")) {
      push({ k: "p", v: ".", pos: i, end: i + 1, line });
      code += c;
      i += 1;
      continue;
    }
    if (/[A-Za-z0-9_\-.\\/:~*]/.test(c) && !(c === ":" && src[i + 1] === ":")) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_\-.\\/:~*!%^?]/.test(src[j]!) && !(src[j] === ":" && src[j + 1] === ":")) j += 1;
      const word = src.slice(i, j);
      push({ k: "id", v: word, pos: i, end: j, line });
      code += word;
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    const op = two === "@(" || two === "@{" || two === "$(" || two === "+=" ? two : c;
    if (c !== " " && c !== "\t" && c !== "\r") push({ k: "p", v: op, pos: i, end: i + op.length, line });
    code += src.slice(i, i + op.length);
    i += op.length;
  }
  return { code, toks };
}

const PS_GATES = new Set(["get-gatedsql", "assert-commandwriteallowed", "assert-ogr2ogrwriteallowed"]);
const PS_RELATION_GATE = "assert-ungovernedwriteallowed";

function scanPs(src: string, sink: SiteSink, def: ProtectedRelationsDefinition, readSqlFile: (p: string) => string | null, readRepo?: (p: string) => string | null): void {
  const { code, toks } = lexPs(src);
  const bindings = new Map<string, Tok[][]>();
  const bindingRanges: { name: string; from: number; to: number }[] = [];
  const stmtEnd = (start: number) => {
    let depth = 0;
    for (let k = start; k < toks.length; k += 1) {
      const t = toks[k]!;
      if (isOpen(t)) depth += 1;
      else if (isClose(t)) {
        if (depth === 0) return k;
        depth -= 1;
      } else if (depth === 0 && (t.k === "nl" || t.v === ";" || t.v === "|")) {
        const prev = toks[k - 1];
        if (t.k === "nl" && prev && prev.k === "p" && (prev.v === "+" || prev.v === "," || prev.v === "`")) continue;
        return k;
      }
    }
    return toks.length;
  };
  toks.forEach((t, k) => {
    if (t.k === "id" && t.v.startsWith("$") && toks[k + 1]?.k === "p" && (toks[k + 1]!.v === "=" || toks[k + 1]!.v === "+=")) {
      const end = stmtEnd(k + 2);
      const expr = toks.slice(k + 2, end);
      if (expr.length) {
        // `$a += 'x'` appends to the value `$a = @(...)` bound (an array push), it is not a second value
        if (toks[k + 1]!.v === "+=") addBinding(bindings, `${t.v}.push`, expr);
        else addBinding(bindings, t.v, expr);
        bindingRanges.push({ name: t.v, from: expr[0]!.pos, to: expr[expr.length - 1]!.end });
      }
    }
  });
  const ctx: FoldContext = { src, bindings, lang: "ps", readRepoFile: readRepo };
  const ranges: { from: number; to: number }[] = [];
  const gatedIds = new Set<string>();
  const relations: { text: string; pos: number }[] = [];
  toks.forEach((t, k) => {
    if (t.k !== "id") return;
    const lower = t.v.toLowerCase();
    if (PS_GATES.has(lower)) {
      const end = stmtEnd(k + 1);
      ranges.push({ from: t.pos, to: toks[end - 1]?.end ?? t.end });
      for (const a of toks.slice(k + 1, end)) if (a.k === "id" && a.v.startsWith("$")) gatedIds.add(a.v);
      // $ogrArgs = Assert-Ogr2ogrWriteAllowed ...: the result is the checked value
      if (toks[k - 1]?.v === "=" && toks[k - 2]?.k === "id" && toks[k - 2]!.v.startsWith("$")) gatedIds.add(toks[k - 2]!.v);
    }
    if (lower === PS_RELATION_GATE) {
      const end = stmtEnd(k + 1);
      const args = toks.slice(k + 1, end);
      const at = args.findIndex((a) => a.k === "id" && a.v.toLowerCase() === "-relation");
      if (at >= 0 && args[at + 1]) {
        const f = foldExpr([args[at + 1]!], ctx, 0);
        relations.push({ text: f.texts.length === 1 && containsDynamic(f.texts[0]!) ? f.texts[0]! : dyn(args[at + 1]!.v), pos: t.pos });
      }
    }
  });
  const literalGated = (pos: number) => inRanges(pos, ranges) || bindingRanges.some((r) => pos >= r.from && pos < r.to && gatedIds.has(r.name));

  // literal surface
  const seen = new Set<number>();
  for (let k = 0; k < toks.length; k += 1) {
    const t = toks[k]!;
    if (t.k !== "str" || seen.has(t.pos)) continue;
    let end = k + 1;
    while (toks[end]?.k === "p" && toks[end]!.v === "+" && (toks[end + 1]?.k === "str" || toks[end + 1]?.k === "id")) end += 2;
    for (let n = k; n < end; n += 1) if (toks[n]!.k === "str") seen.add(toks[n]!.pos);
    const folded = foldExpr(toks.slice(k, end), ctx, 0);
    sink.counts.literals += 1;
    // Write-Host '...' / throw '...': a message (the statement's first word, scanning back to the line start)
    let back = k - 1;
    while (back >= 0 && toks[back]!.k !== "nl" && !(toks[back]!.k === "p" && (toks[back]!.v === ";" || toks[back]!.v === "{" || toks[back]!.v === "|"))) back -= 1;
    const head = toks[back + 1];
    if (head && head.k === "id" && /^(write-host|write-output|write-warning|write-error|write-verbose|write-information|throw)$/i.test(head.v)) continue;
    for (const text of folded.texts) {
      const v = classifyLiteral(text, def, readSqlFile);
      if (!v || v.verdict === "ALLOWED") continue;
      if (literalGated(t.pos)) {
        sink.counts.gated += 1;
        continue;
      }
      if (v.verdict === "UNRESOLVABLE") {
        const checked = relations.filter((r) => r.pos < t.pos);
        let replaced = text;
        checked.forEach((r, n) => {
          replaced = replaced.split(r.text).join(`gate_checked_relation_${n}`);
        });
        const again = replaced === text ? null : classifySqlText(replaced, def);
        if (replaced !== text && (again === null || again.verdict === "ALLOWED")) {
          sink.counts.gated += 1;
          continue;
        }
      }
      sink.add({ line: t.line, kind: "SQL_TEXT", channel: "literal", excerpt: excerptOf(src, t.pos, toks[end - 1]!.end), verdict: v.verdict, detail: v.detail });
      break;
    }
  }

  // ---- command channels: every pipeline element of every statement (script blocks split at braces) ----
  const checkedBefore = (pos: number): string[] => relations.filter((r) => r.pos < pos).map((r) => r.text);
  const statements: Tok[][] = [];
  {
    let cur: Tok[] = [];
    let depth = 0;
    const flush = () => {
      if (cur.length) statements.push(cur);
      cur = [];
    };
    for (const t of toks) {
      if (t.k === "p" && (t.v === "{" || t.v === "@{" || t.v === "}") && depth === 0) {
        flush();
        continue;
      }
      if (t.k === "p" && (t.v === "(" || t.v === "@(" || t.v === "$(" || t.v === "[")) depth += 1;
      if (t.k === "p" && (t.v === ")" || t.v === "]")) depth = Math.max(0, depth - 1);
      if (depth === 0 && (t.k === "nl" || (t.k === "p" && t.v === ";"))) {
        const prev = cur[cur.length - 1];
        if (t.k === "nl" && prev && prev.k === "p" && (prev.v === "`" || prev.v === "|" || prev.v === "," || prev.v === "+")) {
          if (prev.v === "`") cur.pop();
          continue;
        }
        flush();
        continue;
      }
      if (t.k !== "nl") cur.push(t);
    }
    flush();
  }

  /** One argument token (or parenthesised group) as text. */
  const argText = (group: readonly Tok[]): string => {
    const f = foldExpr(group, ctx, 0);
    return f.texts.length === 1 ? f.texts[0]! : dyn(hintOf(group, src));
  };
  /** Split command-mode tokens into argument groups: a token, a (...) / $(...) / @(...) group, or @splat. */
  const argGroups = (ts: readonly Tok[]): Tok[][] => {
    const out: Tok[][] = [];
    for (let i = 0; i < ts.length; i += 1) {
      const t = ts[i]!;
      if (isOpen(t) && t.v !== "{") {
        const close = matchClose(ts, i);
        out.push(ts.slice(i, close + 1));
        i = close;
        continue;
      }
      if (t.k === "p" && t.v === "@" && ts[i + 1]?.k === "id") {
        out.push([{ ...ts[i + 1]!, k: "p", v: `@${ts[i + 1]!.v}` }]);
        i += 1;
        continue;
      }
      if (t.k === "p" && (t.v === "," || t.v === "`")) continue;
      // 2>$null, *>&1, > file: a redirection and its target
      if ((t.k === "p" && t.v === ">") || (t.k === "id" && /^[0-9*]?>{1,2}(&[0-9])?$/.test(t.v))) {
        if (ts[i + 1] && !(ts[i + 1]!.k === "p" && ts[i + 1]!.v === "&")) i += 1;
        continue;
      }
      if (t.k === "id" && /^[0-9*]$/.test(t.v) && ts[i + 1]?.k === "p" && ts[i + 1]!.v === ">") continue;
      out.push([t]);
    }
    return out;
  };
  const groupTexts = (g: readonly Tok[]): string[] => {
    if (g.length === 1 && g[0]!.k === "p" && g[0]!.v.startsWith("@")) {
      const name = g[0]!.v.slice(1);
      const els = resolveArray(`$${name.toLowerCase()}`, ctx, 0);
      return els ?? [dyn(`...${name}`)];
    }
    if (g.length === 1 && g[0]!.k === "id" && !g[0]!.v.startsWith("$")) return [g[0]!.v];
    return [argText(g)];
  };

  const judge = (programs: readonly string[], argv: string[] | null, stdin: string[] | null, line: number, excerpt: string, pos: number): void => {
    let v: TextVerdict = ALLOWED;
    let gatedHit = false;
    let dynamicWhy: string | null = null;
    for (const program of programs) {
      const kind = programKind(program);
      if (kind === "DYNAMIC") {
        dynamicWhy ??= "the program is chosen at run time";
        continue;
      }
      if (argv === null) {
        if (kind === "TOOL" || kind === "SHELL" || RUNNERS.has(programBase(program)) || RUNS_OTHERS.has(programBase(program))) dynamicWhy ??= `${programBase(program)} with arguments that are not in the source`;
        continue;
      }
      const full = [program, ...argv];
      const verdicts = stdin ? stdin.map((s) => classifyArgvWithStdin(full, s, def, readSqlFile)) : [classifyArgv(full, def, readSqlFile)];
      for (const c of verdicts) {
        if (c.verdict === "UNRESOLVABLE") {
          const checked = checkedBefore(pos);
          const sub = full.map((a) => substituteGated(a, checked));
          if (sub.some((a, n) => a !== full[n]) && classifyArgv(sub, def, readSqlFile).verdict === "ALLOWED") {
            gatedHit = true;
            continue;
          }
        }
        v = worst(v, c);
      }
      dynamicWhy ??= argvDynamic(full);
    }
    if (v.verdict !== "ALLOWED") sink.add({ line, kind: "PROCESS", channel: "powershell", excerpt, verdict: v.verdict, detail: v.detail });
    else if (dynamicWhy) sink.add({ line, kind: "PROCESS", channel: "powershell", excerpt, verdict: "DYNAMIC", detail: dynamicWhy });
    else if (gatedHit) sink.counts.gated += 1;
    else sink.counts.allowed += 1;
  };

  for (const statement of statements) {
    const elements = splitTop(statement, (t) => t.k === "p" && t.v === "|").filter((e) => e.length > 0);
    elements.forEach((el, index) => {
      let e = el;
      // an assignment prefix: [type]$x = / $x.y +=
      const eq = e.findIndex((x) => x.k === "p" && (x.v === "=" || x.v === "+="));
      if (eq > 0 && eq <= 8 && e.slice(0, eq).every((x) => (x.k === "id" && !x.v.startsWith("-")) || (x.k === "p" && (x.v === "[" || x.v === "]" || x.v === ".")))) e = e.slice(eq + 1);
      while (e[0]?.k === "id" && /^(return|throw|exit)$/i.test(e[0]!.v)) e = e.slice(1);
      const first = e[0];
      if (!first) return;
      const elSrc = src.slice(first.pos, e[e.length - 1]!.end);
      const excerpt = norm(elSrc);
      const line = first.line;
      // & ogr2ogr @ogrArgs where $ogrArgs came out of a gate
      const passesGated = e.some((x, n) => (x.k === "id" && gatedIds.has(x.v)) || (x.k === "p" && x.v === "@" && e[n + 1]?.k === "id" && gatedIds.has(`$${e[n + 1]!.v.toLowerCase()}`)));
      if (PS_GATES_RE.test(elSrc) || (passesGated && (first.v === "&" || toolOf(first.v)))) {
        sink.counts.channels += 1;
        sink.counts.gated += 1;
        return;
      }
      // (U30F4 B2: in any case -- PowerShell is case-insensitive -- the Async twins, and Npgsql COPY)
      if (/\.(Execute(NonQuery|Reader|Scalar)(Async)?|Begin(Binary|Text)(Import|Export)|BeginRawBinaryCopy)\s*\(/i.test(elSrc)) {
        sink.counts.channels += 1;
        sink.add({ line, kind: "SQL_CALL", channel: "ado.net", excerpt, verdict: "DYNAMIC", detail: "an ADO.NET command or Npgsql COPY whose SQL is set at run time" });
        return;
      }
      if (/Diagnostics\.Process\]::Start\s*\(|ProcessStartInfo/i.test(elSrc)) {
        sink.counts.channels += 1;
        sink.add({ line, kind: "PROCESS", channel: "powershell", excerpt, verdict: "DYNAMIC", detail: "System.Diagnostics.Process started with run-time arguments" });
        return;
      }
      // stdin: a string or variable piped into this element
      const prevEl = index > 0 ? elements[index - 1]! : null;
      const stdin = prevEl && prevEl.length === 1 && (prevEl[0]!.k === "str" || (prevEl[0]!.k === "id" && prevEl[0]!.v.startsWith("$"))) ? foldExpr(prevEl, ctx, 0).texts : null;
      if (first.k === "p" && (first.v === "&" || first.v === ".")) {
        const groups = argGroups(e.slice(1));
        const programGroup = groups[0];
        if (!programGroup) return;
        sink.counts.channels += 1;
        const pf = foldExpr(programGroup, ctx, 0);
        const programs = pf.texts.length > 0 ? pf.texts : [dyn(hintOf(programGroup, src))];
        if (first.v === "." && programs.every((p) => programKind(p) !== "DYNAMIC")) {
          sink.counts.allowed += 1; // dot-sourcing a script by a static file name: the script is scanned itself
          return;
        }
        judge(programs, groups.slice(1).flatMap(groupTexts), stdin, line, excerpt, first.pos);
        return;
      }
      if (first.k !== "id" || first.v.startsWith("$") || first.v.startsWith("-")) return;
      const word = first.v.toLowerCase();
      if (word === "invoke-expression" || word === "iex") {
        sink.counts.channels += 1;
        const groups = argGroups(e.slice(1)).filter((g) => !(g.length === 1 && g[0]!.k === "id" && g[0]!.v.toLowerCase() === "-command"));
        const f = groups[0] ? foldExpr(groups[0], ctx, 0) : null;
        if (!f || !f.literal || f.dynamic) {
          sink.add({ line, kind: "PROCESS", channel: "powershell", excerpt, verdict: "DYNAMIC", detail: "Invoke-Expression of a command the source does not hold" });
          return;
        }
        let v: TextVerdict = ALLOWED;
        let why: string | null = null;
        for (const text of f.texts) {
          v = worst(v, classifyCommandText(text, def, readSqlFile) ?? ALLOWED);
          why ??= commandDynamic(text);
        }
        if (v.verdict !== "ALLOWED") sink.add({ line, kind: "PROCESS", channel: "powershell", excerpt, verdict: v.verdict, detail: v.detail });
        else if (why) sink.add({ line, kind: "PROCESS", channel: "powershell", excerpt, verdict: "DYNAMIC", detail: why });
        else sink.counts.allowed += 1;
        return;
      }
      if (word === "start-process") {
        sink.counts.channels += 1;
        const groups = argGroups(e.slice(1));
        let programGroup: Tok[] | null = null;
        let argGroup: Tok[] | null = null;
        for (let i = 0; i < groups.length; i += 1) {
          const g = groups[i]!;
          const name = g.length === 1 && g[0]!.k === "id" ? g[0]!.v.toLowerCase() : "";
          if (name === "-filepath" || name === "-file") programGroup = groups[++i] ?? null;
          else if (name === "-argumentlist" || name === "-args") argGroup = groups[++i] ?? null;
          else if (name.startsWith("-")) {
            if (!/^-(nonewwindow|passthru|wait|usenewenvironment)$/.test(name)) i += 1;
          } else if (!programGroup) programGroup = g;
          else if (!argGroup) argGroup = g;
        }
        if (!programGroup) return;
        const programs = foldExpr(programGroup, ctx, 0).texts;
        let argv: string[] | null = [];
        if (argGroup) {
          const els = arrayElements(argGroup, ctx, 0);
          if (els) argv = els;
          else {
            const f = foldExpr(argGroup, ctx, 0);
            argv = f.literal && !f.dynamic && f.texts.length === 1 ? splitCommandLine(f.texts[0]!).flat().flatMap((s) => s.argv) : null;
          }
        }
        judge(programs, argv, null, line, excerpt, first.pos);
        return;
      }
      const base = programBase(first.v);
      if (toolOf(first.v) || programKind(first.v) === "SHELL" || RUNNERS.has(base) || RUNS_OTHERS.has(base)) {
        sink.counts.channels += 1;
        judge([first.v], argGroups(e.slice(1)).flatMap(groupTexts), stdin, line, excerpt, first.pos);
      }
    });
  }
}

const PS_GATES_RE = /\b(Get-GatedSql|Assert-CommandWriteAllowed|Assert-Ogr2ogrWriteAllowed)\b/i;

// =============================================================================================
// Line-based readers: shell, cmd, Dockerfile, YAML, TOML, JSON command configs
// =============================================================================================

interface LogicalLine {
  readonly text: string;
  readonly line: number;
}

/** Statements of a script: continuation lines joined, here-documents/here-strings attached. */
function logicalLines(code: string, lang: "sh" | "ps" | "cmd"): LogicalLine[] {
  const raw = code.split("\n");
  const out: LogicalLine[] = [];
  let k = 0;
  while (k < raw.length) {
    const start = k;
    let text = raw[k]!.replace(/\r$/, "");
    const cont = lang === "sh" ? /\\$/ : lang === "ps" ? /`$/ : /\^$/;
    while (cont.test(text) && k + 1 < raw.length) {
      k += 1;
      text = `${text.slice(0, -1)} ${raw[k]!.replace(/\r$/, "")}`;
    }
    // PowerShell: a statement continues while brackets are open or the line ends with an operator
    if (lang === "ps") {
      let depth = bracketDepth(text);
      while ((depth > 0 || /(\||,|\+|=)\s*$/.test(text)) && k + 1 < raw.length) {
        k += 1;
        text = `${text}\n${raw[k]!.replace(/\r$/, "")}`;
        depth = bracketDepth(text);
      }
      // a here-string opened on this line
      const hs = /@(['"])\s*$/.exec(text);
      if (hs) {
        while (k + 1 < raw.length) {
          k += 1;
          text = `${text}\n${raw[k]!.replace(/\r$/, "")}`;
          if (raw[k]!.startsWith(`${hs[1]}@`)) break;
        }
      }
    }
    if (lang === "sh") {
      // a quoted string that spans lines (a JSON body, a multi-line SQL): one statement
      while (shQuoteOpen(text) && k + 1 < raw.length) {
        k += 1;
        text = `${text}\n${raw[k]!.replace(/\r$/, "")}`;
      }
      const hd = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(text);
      if (hd) {
        while (k + 1 < raw.length) {
          k += 1;
          text = `${text}\n${raw[k]!.replace(/\r$/, "")}`;
          if (raw[k]!.replace(/\r$/, "").trim() === hd[2]) break;
        }
      }
    }
    out.push({ text, line: start + 1 });
    k += 1;
  }
  return out.filter((l) => l.text.trim().length > 0);
}

/** A shell line ends inside a quote. */
function shQuoteOpen(text: string): boolean {
  let q: string | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (q === "'") {
      if (c === "'") q = null;
      continue;
    }
    if (c === "\\") {
      i += 1;
      continue;
    }
    if (q === '"') {
      if (c === '"') q = null;
      continue;
    }
    if (c === "'" || c === '"') q = c;
  }
  return q !== null;
}

function bracketDepth(text: string): number {
  let depth = 0;
  let q: string | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (q) {
      if (c === q) q = null;
      continue;
    }
    if (c === "'" || c === '"') q = c;
    else if (c === "(" || c === "{" || c === "[") depth += 1;
    else if (c === ")" || c === "}" || c === "]") depth -= 1;
  }
  return depth;
}

/** Shell source without comments (a # that starts a word, outside quotes). */
function stripShComments(src: string): string {
  let out = "";
  let q: string | null = null;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i]!;
    if (q) {
      out += c;
      if (c === "\\" && q === '"') {
        out += src[i + 1] ?? "";
        i += 1;
      } else if (c === q) q = null;
      continue;
    }
    if (c === "'" || c === '"') {
      q = c;
      out += c;
      continue;
    }
    if (c === "#" && (i === 0 || /\s/.test(src[i - 1]!))) {
      while (i < src.length && src[i] !== "\n") i += 1;
      out += "\n";
      continue;
    }
    out += c;
  }
  return out;
}

/**
 * U30F6 (F5-1): shell functions whose body runs `"$@"` (a forwarder: `f() { local x="$1"; shift; "$@"; }`), with the
 * number of arguments they shift off first, and the line numbers of those `"$@"` lines.
 */
function shellForwarders(lines: readonly LogicalLine[]): { functions: Map<string, number>; lines: Set<number> } {
  const functions = new Map<string, number>();
  const forwardLines = new Set<number>();
  let current: { name: string; shift: number } | null = null;
  for (const { text, line } of lines) {
    const def = /^\s*(?:function\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(\)\s*\{\s*$/.exec(text) ?? /^\s*function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{\s*$/.exec(text);
    if (def) {
      current = { name: def[1]!, shift: 0 };
      continue;
    }
    if (!current) continue;
    if (/^\s*\}\s*;?\s*$/.test(text)) {
      current = null;
      continue;
    }
    const shift = /^\s*shift(?:\s+([0-9]+))?\s*;?\s*$/.exec(text);
    if (shift) current.shift += shift[1] ? Number(shift[1]) : 1;
    else if (/^\s*(?:exec\s+)?"?\$(?:@|\{@\})"?\s*;?\s*$/.test(text)) {
      functions.set(current.name, current.shift);
      forwardLines.add(line);
    }
  }
  return { functions, lines: forwardLines };
}

/** Quoted strings of a shell/cmd line (for the literal surface), variables as placeholders. */
function shellStrings(text: string): string[] {
  const out: string[] = [];
  const re = /'([^']*)'|"((?:[^"\\]|\\.)*)"/g;
  for (const m of text.matchAll(re)) {
    const body = m[1] ?? m[2] ?? "";
    out.push(m[1] !== undefined ? body : body.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?|%([A-Za-z_][A-Za-z0-9_]*)%/g, (_x, a, b) => dyn(a ?? b)));
  }
  return out;
}

interface ScriptOptions {
  readonly lineOffset?: number;
  readonly channel?: string;
  /**
   * The text IS a command (a script, a run: block, an npm script): a program or wrapper chosen at run time
   * is a DYNAMIC channel. Off for configuration values that merely might be one (a YAML name: or env:).
   */
  readonly commandContext?: boolean;
}

function scanCommandScript(src: string, lang: "sh" | "cmd", sink: SiteSink, def: ProtectedRelationsDefinition, readSqlFile: (p: string) => string | null, opts: ScriptOptions = {}): void {
  const lineOffset = opts.lineOffset ?? 0;
  const commandContext = opts.commandContext ?? true;
  let code = lang === "sh" ? stripShComments(src) : src.replace(/^\s*@?(rem\b|::).*$/gim, "");
  if (lang === "cmd") code = code.replace(/^\s*@/gm, "");
  const lines = logicalLines(code, lang);
  // U30F6 (F5-4): the launcher's own directory ($(dirname "$0"), %~dp0) is read as `.` -- also in the variables built on it
  const variables = scriptVariables(lines.map((l) => anchorLauncherDir(l.text, lang)), lang);
  const forwarders = lang === "sh" ? shellForwarders(lines) : { functions: new Map<string, number>(), lines: new Set<number>() };
  for (const { text: rawText, line } of lines) {
    // U30F6 (F5-1): the "$@" line of an in-file forwarder runs exactly what its callers pass -- read at each call
    if (forwarders.lines.has(line)) {
      sink.counts.channels += 1;
      sink.counts.allowed += 1;
      continue;
    }
    let text = substituteVariables(anchorLauncherDir(rawText, lang), variables, lang);
    const called = splitCommandLine(text).flat();
    if (forwarders.functions.size > 0 && called.length === 1) {
      const pi = programIndex(called[0]!.argv);
      const shift = pi >= 0 ? forwarders.functions.get(called[0]!.argv[pi]!) : undefined;
      if (shift !== undefined) text = called[0]!.argv.slice(pi + 1 + shift).map(requote).join(" ");
    }
    const excerpt = norm(rawText);
    // literal surface
    for (const s of shellStrings(text)) {
      const v = classifyLiteral(s, def, readSqlFile);
      if (v && v.verdict !== "ALLOWED") {
        sink.add({ line: line + lineOffset, kind: "SQL_TEXT", channel: "literal", excerpt, verdict: v.verdict, detail: v.detail });
      }
    }
    if (!commandContext) {
      const plain = classifyLiteral(text, def, readSqlFile);
      if (plain && plain.verdict !== "ALLOWED") sink.add({ line: line + lineOffset, kind: "SQL_TEXT", channel: "literal", excerpt, verdict: plain.verdict, detail: plain.detail });
    }
    // [[ a && b ]]: a test expression, not two commands
    const forSplit = lang === "sh" ? text.replace(/\[\[[\s\S]*?\]\]/g, "[[ test ]]") : text;
    const segments = splitCommandLine(forSplit).flat();
    const touchesTool = segments.some((s) => s.argv.some((a) => toolOf(a) || programKind(a) === "SHELL") || destroysVolume(s.argv));
    const dynamicWhy = commandContext ? commandDynamic(forSplit) : null;
    const evalLike = commandContext && segments.some((seg) => /^(eval|source|\.)$/.test(seg.argv[programIndex(seg.argv)] ?? "") && seg.argv.some((a) => dynamicHint(a) !== null));
    // U30F5 (D-1/D-2): a line that runs a file (tsx x.ts, bash x.txt) or inline code (node -e, python -c) is a channel too
    const runs = commandContext && segments.some((seg) => {
      const r = commandRuns(seg.argv);
      return r.launches.length + r.inline.length > 0;
    });
    if (!touchesTool && !dynamicWhy && !evalLike && !runs) continue;
    sink.counts.channels += 1;
    const v = classifyCommandText(text, def, readSqlFile) ?? ALLOWED;
    const channel = opts.channel ?? lang;
    if (v.verdict !== "ALLOWED") sink.add({ line: line + lineOffset, kind: "PROCESS", channel, excerpt, verdict: v.verdict, detail: v.detail });
    else if (dynamicWhy || evalLike) sink.add({ line: line + lineOffset, kind: "PROCESS", channel, excerpt, verdict: "DYNAMIC", detail: dynamicWhy ?? "eval/source of a command the source does not hold" });
    else sink.counts.allowed += 1;
  }
}

/**
 * Script variables with ONE static value in the whole script (NAME=value, export/local/readonly NAME=value,
 * cmd `set NAME=value`; `$(command -v x)` / `$(which x)` / `where x` read as x). A variable assigned more
 * than once with different values, or from anything else, stays dynamic.
 */
function scriptVariables(lines: readonly string[], lang: "sh" | "cmd"): Map<string, string> {
  const seen = new Map<string, Set<string | null>>();
  for (const l of lines) {
    const m =
      lang === "sh"
        ? /^\s*(?:export\s+|local\s+|readonly\s+|declare\s+(?:-\w+\s+)?)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(l)
        : /^\s*set\s+"?([A-Za-z_][A-Za-z0-9_]*)=([^"]*)"?\s*$/i.exec(l);
    if (!m) continue;
    let value: string | null = m[2]!.trim();
    const which = /^"?(?:\$\(|`)\s*(?:command\s+-v|which|type\s+-p|where)\s+([A-Za-z0-9_.\-]+)\b[^)`]*(?:\)|`)"?$/.exec(value);
    if (which) value = which[1]!;
    else if (/^'[^']*'$/.test(value)) value = value.slice(1, -1);
    else if (/^"[^"$`\\]*"$/.test(value)) value = value.slice(1, -1);
    // "$SDK_PATH/bin/gcloud": the variables it holds stay dynamic, its static text (the file name) is kept
    else if (/^"[^"`\\]*"$/.test(value) && !value.includes("$(")) value = value.slice(1, -1).replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (_m, n: string) => dyn(n));
    else if (!/^[^\s"'$`\\;|&()<>]*$/.test(value)) value = null;
    const name = lang === "cmd" ? m[1]!.toUpperCase() : m[1]!;
    if (!seen.has(name)) seen.set(name, new Set());
    seen.get(name)!.add(value);
  }
  const out = new Map<string, string>();
  for (const [name, values] of seen) {
    const only = [...values];
    if (only.length === 1 && only[0] !== null && !/["$`\\]/.test(only[0]!)) out.set(name, only[0]!);
  }
  return out;
}

function substituteVariables(text: string, variables: Map<string, string>, lang: "sh" | "cmd"): string {
  if (variables.size === 0) return text;
  if (lang === "cmd") return text.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (m, n: string) => variables.get(n.toUpperCase()) ?? m);
  // not inside single quotes (no expansion there)
  let out = "";
  let i = 0;
  let q: string | null = null;
  while (i < text.length) {
    const c = text[i]!;
    if (q === "'") {
      out += c;
      if (c === "'") q = null;
      i += 1;
      continue;
    }
    if (c === "'" && q === null) {
      q = "'";
      out += c;
      i += 1;
      continue;
    }
    if (c === '"') q = q === '"' ? null : '"';
    const m = /^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/.exec(text.slice(i));
    if (c === "$" && m) {
      const name = m[1] ?? m[2]!;
      const value = variables.get(name);
      out += value ?? m[0];
      i += m[0].length;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function scanDockerfile(src: string, sink: SiteSink, def: ProtectedRelationsDefinition, readSqlFile: (p: string) => string | null): void {
  const raw = src.split("\n");
  for (let k = 0; k < raw.length; k += 1) {
    const start = k;
    let text = raw[k]!.replace(/\r$/, "");
    while (/\\$/.test(text) && k + 1 < raw.length) {
      k += 1;
      text = `${text.slice(0, -1)} ${raw[k]!.replace(/\r$/, "").replace(/^\s*#.*$/, "")}`;
    }
    const m = /^\s*(RUN|CMD|ENTRYPOINT)\s+(.*)$/is.exec(text);
    if (!m) continue;
    const body = m[2]!.trim();
    if (body.startsWith("[")) {
      try {
        const argv = JSON.parse(body) as unknown;
        if (Array.isArray(argv) && argv.every((a) => typeof a === "string")) {
          const v = classifyArgv(argv as string[], def, readSqlFile);
          if (mentionsTool(argv.join(" "))) sink.counts.channels += 1;
          if (v.verdict !== "ALLOWED") sink.add({ line: start + 1, kind: "PROCESS", channel: "dockerfile", excerpt: norm(text), verdict: v.verdict, detail: v.detail });
          continue;
        }
      } catch {
        // shell form below
      }
    }
    scanCommandScript(body, "sh", sink, def, readSqlFile, { lineOffset: start, channel: "dockerfile" });
  }
}

/** YAML keys whose values are commands (CI steps, compose, cloudbuild, fly, k8s). */
const YAML_COMMAND_KEYS = /^(run|command|commands|cmds|entrypoint|cmd|release_command|exec|test|pre|post)$/i;
/** Keys whose list items are ARGUMENTS (cloudbuild args:): classified, but never a program position. */
const YAML_ARGUMENT_KEYS = /^(args|arguments)$/i;

/**
 * U30F6 (F5-6): a template placeholder in a command ({{.SQL}}, {{ .CMD }}: Taskfile, Helm and other Go templates) is
 * a value the source does not hold. GitHub's ${{ ... }} is a `$` expansion the splitter reads already.
 */
function templateValues(text: string): string {
  return text.includes("{{") ? text.replace(/(?<!\$)\{\{[\s\S]*?\}\}/g, () => dyn("template")) : text;
}

/**
 * U30F6 (F5-7): a YAML folded block scalar (`>`, `>-`, `>+`) as YAML reads it: the line break between two lines at the
 * block's indentation is a space; an empty line is a line break; a more-indented line keeps its line breaks.
 */
export function foldYamlBlock(lines: readonly string[]): string {
  let out = "";
  let prev: "none" | "normal" | "more" = "none";
  let empty = 0;
  for (const l of lines) {
    if (l.trim() === "") {
      empty += 1;
      continue;
    }
    const kind = /^[ \t]/.test(l) ? "more" : "normal";
    if (prev === "none") out += "\n".repeat(empty);
    else if (prev === "normal" && kind === "normal") out += empty > 0 ? "\n".repeat(empty) : " ";
    else out += "\n".repeat(empty + 1);
    out += l;
    prev = kind;
    empty = 0;
  }
  return out;
}

/**
 * YAML: a value under a command key (run:, command:, entrypoint:, args:, script:, test: ...) is a command;
 * every other scalar is classified as SQL text and, when it names a DB/GIS tool, as a command line.
 */
function scanYaml(src: string, sink: SiteSink, def: ProtectedRelationsDefinition, readSqlFile: (p: string) => string | null): void {
  const raw = src.split("\n").map((l) => l.replace(/\r$/, ""));
  const stripComment = (l: string) => {
    let q: string | null = null;
    for (let i = 0; i < l.length; i += 1) {
      const c = l[i]!;
      if (q) {
        if (c === q) q = null;
        continue;
      }
      if (c === "'" || c === '"') q = c;
      else if (c === "#" && (i === 0 || /\s/.test(l[i - 1]!))) return l.slice(0, i);
    }
    return l;
  };
  const unquote = (v: string) => {
    const t = v.trim();
    if (t.length >= 2 && ((t[0] === "'" && t.endsWith("'")) || (t[0] === '"' && t.endsWith('"')))) {
      return t[0] === "'" ? t.slice(1, -1).replace(/''/g, "'") : t.slice(1, -1).replace(/\\"/g, '"');
    }
    return t;
  };
  const LINE = /^(\s*)(-\s+)?(?:([^:'"\s][^:]*?|"[^"]*"|'[^']*'):(?:\s+|$))?(.*)$/;
  // U30F5 (D-2): a step's `shell:` (python, pwsh, cmd, node {0} ...) decides the language of its `run:` -- also when it
  // stands after run: -- and `defaults: run: shell:` for the steps without one
  const keyLines: { k: number; col: number; key: string; value: string; dash: boolean }[] = [];
  let defaultShell: string | null = null;
  {
    const parents: { col: number; key: string }[] = [];
    for (let k = 0; k < raw.length; k += 1) {
      const l = stripComment(raw[k]!);
      if (l.trim() === "") continue;
      const m = LINE.exec(l);
      if (!m || m[3] === undefined) continue;
      const col = m[1]!.length + (m[2] !== undefined ? m[2].length : 0);
      const key = unquote(m[3]);
      const value = m[4]!.trim();
      keyLines.push({ k, col, key, value, dash: m[2] !== undefined });
      while (parents.length && parents[parents.length - 1]!.col >= col) parents.pop();
      if (key === "shell" && value && parents[parents.length - 1]?.key === "run" && parents.some((x) => x.key === "defaults")) defaultShell = unquote(value);
      if (value === "") parents.push({ col, key });
    }
  }
  const stepShell = (k: number, col: number): string | null => {
    const at = keyLines.findIndex((x) => x.k === k);
    for (let i = at; i >= 0; i -= 1) {
      const x = keyLines[i]!;
      if (x.col < col) break;
      if (x.col !== col) continue;
      if (x.key === "shell" && x.value) return unquote(x.value);
      if (x.dash) break;
    }
    for (let i = at + 1; i < keyLines.length; i += 1) {
      const x = keyLines[i]!;
      if (x.col < col || (x.col === col && x.dash)) break;
      if (x.col === col && x.key === "shell" && x.value) return unquote(x.value);
    }
    return defaultShell;
  };
  /** A run: body in the language its shell runs it as: true when it was read here (not as sh). */
  const runAs = (body: string, k: number, col: number, lineOffset: number): boolean => {
    const shell = stepShell(k, col);
    if (shell === null) return false;
    const s = shell.toLowerCase();
    const lang: Language | "unknown" | null = /^python[0-9.]*\b/.test(s)
      ? "py"
      : /^(pwsh|powershell)\b/.test(s)
        ? "ps"
        : /^cmd\b/.test(s)
          ? "cmd"
          : /^node\b/.test(s)
            ? "js"
            : /^(bash|sh|zsh)\b/.test(s)
              ? null
              : "unknown";
    if (lang === null) return false;
    if (lang === "unknown") {
      sink.add({ line: k + 1, kind: "PROCESS", channel: `yaml shell: ${shell}`, excerpt: norm(raw[k]!), verdict: "DYNAMIC", detail: `a CI step run by a shell the scan does not read (${shell})` });
      return true;
    }
    for (const site of scanEmbedded(body, lang, def, readSqlFile)) sink.add({ ...site, line: site.line + lineOffset, channel: `yaml shell: ${shell} -> ${site.channel}` });
    return true;
  };
  // The keys of the enclosing mappings, by indentation of their content.
  const stack: { indent: number; key: string }[] = [];
  for (let k = 0; k < raw.length; k += 1) {
    const l = stripComment(raw[k]!);
    if (l.trim() === "") continue;
    const m = LINE.exec(l);
    if (!m) continue;
    const indent = m[1]!.length;
    const dash = m[2] !== undefined;
    const key = m[3] !== undefined ? unquote(m[3]) : null;
    const value = m[4]!.trim();
    // A line closes every mapping whose content is indented at least as deep; a list item stays inside its key.
    while (stack.length && (dash ? stack[stack.length - 1]!.indent > indent : stack[stack.length - 1]!.indent >= indent)) stack.pop();
    const governing = key ?? stack[stack.length - 1]?.key ?? "";
    const commandContext = YAML_COMMAND_KEYS.test(governing) && !YAML_ARGUMENT_KEYS.test(governing);
    if (key !== null && value === "") {
      stack.push({ indent: indent + (dash ? m[2]!.length : 0), key });
      continue;
    }
    const opts: ScriptOptions = { lineOffset: k, channel: "yaml", commandContext };
    if (/^[|>][-+0-9]*$/.test(value)) {
      const body: string[] = [];
      let n = k + 1;
      for (; n < raw.length; n += 1) {
        const r = raw[n]!;
        if (r.trim() === "") {
          body.push("");
          continue;
        }
        if (r.search(/\S/) <= indent) break;
        body.push(r);
      }
      const minIndent = Math.min(...body.filter((b) => b.trim()).map((b) => b.search(/\S/)));
      const stripped = body.map((b) => b.slice(Number.isFinite(minIndent) ? minIndent : 0));
      // U30F6 (F5-7): a folded block (>) is one command where YAML folds it, not one per source line
      const text = value.startsWith(">") ? foldYamlBlock(stripped) : stripped.join("\n");
      const keyCol = indent + (dash ? m[2]!.length : 0);
      if (!(commandContext && key !== null && key.toLowerCase() === "run" && runAs(text, k, keyCol, k + 1))) scanCommandScript(commandContext ? templateValues(text) : text, "sh", sink, def, readSqlFile, { ...opts, lineOffset: k + 1 });
      k = n - 1;
      continue;
    }
    if (value.startsWith("[") && value.endsWith("]")) {
      const items = value.slice(1, -1).split(",").map(unquote).map((x) => (commandContext ? templateValues(x) : x));
      const v = classifyArgv(items, def, readSqlFile);
      if (v.verdict !== "ALLOWED") sink.add({ line: k + 1, kind: "PROCESS", channel: "yaml", excerpt: norm(l), verdict: v.verdict, detail: v.detail });
      for (const item of items) scanCommandScript(item, "sh", sink, def, readSqlFile, { ...opts, commandContext: false });
      continue;
    }
    const keyCol = indent + (dash ? m[2]!.length : 0);
    if (commandContext && key !== null && key.toLowerCase() === "run" && runAs(unquote(value), k, keyCol, k)) continue;
    scanCommandScript(commandContext ? templateValues(unquote(value)) : unquote(value), "sh", sink, def, readSqlFile, opts);
  }
}

function scanToml(src: string, sink: SiteSink, def: ProtectedRelationsDefinition, readSqlFile: (p: string) => string | null): void {
  const re = /=\s*('''([\s\S]*?)'''|"""([\s\S]*?)"""|'([^'\n]*)'|"((?:[^"\\\n]|\\.)*)")/g;
  for (const m of src.matchAll(re)) {
    const value = m[2] ?? m[3] ?? m[4] ?? m[5] ?? "";
    const line = countNewlines(src.slice(0, m.index)) + 1;
    const key = /([A-Za-z0-9_.-]+)\s*$/.exec(src.slice(0, m.index))?.[1] ?? "";
    scanCommandScript(value, "sh", sink, def, readSqlFile, { lineOffset: line - 1, channel: "toml", commandContext: /(command|cmd|exec|run|script)$/i.test(key) });
  }
}

function scanJsonCommands(file: string, src: string, sink: SiteSink, def: ProtectedRelationsDefinition, readSqlFile: (p: string) => string | null): void {
  let doc: unknown = null;
  try {
    doc = JSON.parse(src);
  } catch {
    try {
      doc = JSON.parse(src.replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1"));
    } catch {
      doc = null;
    }
  }
  const lineOf = (needle: string) => {
    const at = src.indexOf(JSON.stringify(needle).slice(1, -1));
    return at < 0 ? 1 : countNewlines(src.slice(0, at)) + 1;
  };
  const values: string[] = [];
  if (file.split("/").pop()!.toLowerCase() === "package.json") {
    const scripts = (doc as { scripts?: Record<string, unknown> } | null)?.scripts ?? {};
    for (const v of Object.values(scripts)) if (typeof v === "string") values.push(v);
  } else {
    const walk = (x: unknown): void => {
      if (typeof x === "string") values.push(x);
      else if (Array.isArray(x)) {
        if (x.every((e) => typeof e === "string") && x.length > 1) values.push(x.map((e) => (/\s/.test(e as string) ? `"${e}"` : e)).join(" "));
        x.forEach(walk);
      } else if (x && typeof x === "object") {
        const o = x as Record<string, unknown>;
        if (typeof o.command === "string" && Array.isArray(o.args)) values.push([o.command, ...o.args.map((a) => (typeof a === "string" && /\s/.test(a) ? `"${a}"` : String(a)))].join(" "));
        Object.values(o).forEach(walk);
      }
    };
    if (doc !== null) walk(doc);
    else values.push(...src.split("\n"));
  }
  const npm = file.split("/").pop()!.toLowerCase() === "package.json";
  for (const v of values) scanCommandScript(v, "sh", sink, def, readSqlFile, { lineOffset: lineOf(v) - 1, channel: npm ? "npm script" : "json", commandContext: npm });
}

function scanSqlFile(src: string, sink: SiteSink, def: ProtectedRelationsDefinition): void {
  sink.counts.channels += 1;
  const v = verdictOf(judgeWrites(analyzeSql(src, { ungated: true }), def));
  if (v.verdict === "ALLOWED") sink.counts.allowed += 1;
  else sink.add({ line: 1, kind: "SQL_FILE", channel: "sql file", excerpt: "(whole file)", verdict: v.verdict, detail: v.detail });
}

// =============================================================================================
// Entry points
// =============================================================================================

/** Scan one file's text. `rel` is its repository path (posix). */
export function scanFile(rel: string, text: string, options: ScanOptions = {}): FileScan {
  const language = options.language ?? languageOf(rel);
  const def = options.definition ?? PROTECTED_RELATIONS;
  const sites: ChannelSite[] = [];
  const counts = { channels: 0, gated: 0, allowed: 0, literals: 0 };
  const sink: SiteSink = {
    counts,
    add(site) {
      const key = `${site.line}|${site.kind}|${site.excerpt}`;
      if (sites.some((s) => `${s.line}|${s.kind}|${s.excerpt}` === key)) return;
      sites.push({ file: rel, ...site });
    },
  };
  const dir = path.posix.dirname(rel);
  const readSqlFile = (p: string): string | null => {
    if (!options.readRepoFile || containsDynamic(p)) return null;
    const clean = p.replace(/\\/g, "/").replace(/^\.\//, "");
    return options.readRepoFile(path.posix.normalize(path.posix.join(dir, clean))) ?? options.readRepoFile(path.posix.normalize(clean));
  };
  const src = text.replace(/\r\n/g, "\n");
  const outer = LAUNCH_COLLECTOR;
  const launches: Launch[] = [];
  LAUNCH_COLLECTOR = launches;
  try {
  switch (language) {
    case "js":
      scanJs(src, sink, def, readSqlFile, options.readRepoFile);
      break;
    case "py":
      scanPy(src, sink, def, readSqlFile, options.readRepoFile);
      break;
    case "ps":
      scanPs(src, sink, def, readSqlFile, options.readRepoFile);
      break;
    case "sh":
      scanCommandScript(src, "sh", sink, def, readSqlFile, {});
      break;
    case "cmd":
      scanCommandScript(src, "cmd", sink, def, readSqlFile, {});
      break;
    case "sql":
      scanSqlFile(src, sink, def);
      break;
    case "yaml":
      scanYaml(src, sink, def, readSqlFile);
      break;
    case "toml":
      scanToml(src, sink, def, readSqlFile);
      break;
    case "docker":
      scanDockerfile(src, sink, def, readSqlFile);
      break;
    case "json":
      scanJsonCommands(rel, src, sink, def, readSqlFile);
      break;
    default:
      break;
  }
  } finally {
    LAUNCH_COLLECTOR = outer;
  }
  sites.sort((a, b) => a.line - b.line || a.excerpt.localeCompare(b.excerpt));
  return { file: rel, language: language ?? "js", sites, counts, launches };
}

export interface WalkRules {
  /** Repository-relative path prefixes that are not walked (each reviewed, with a justification). */
  readonly excludedPrefixes: readonly string[];
  /** Directory names never walked at any depth. */
  readonly excludedDirNames: readonly string[];
  /** A path that is a test source (executed only by the test runner behind TEST-DB-GUARD). */
  readonly isTestSource: (rel: string) => boolean;
  /** U30F4 (B5): every symbolic link the walk does not follow is reported here -- never skipped silently. */
  readonly links?: string[];
  /** The directory reader (tests inject a tree; default fs.readdirSync with file types). */
  readonly readdir?: (dir: string) => readonly { name: string; isSymbolicLink(): boolean; isDirectory(): boolean; isFile(): boolean }[];
}

/** Every repository file (posix, sorted), walked from `root` under `rules`. */
export function walkRepository(root: string, rules: WalkRules): string[] {
  const out: string[] = [];
  const walk = (dir: string, relDir: string) => {
    let entries: readonly { name: string; isSymbolicLink(): boolean; isDirectory(): boolean; isFile(): boolean }[];
    try {
      entries = rules.readdir ? rules.readdir(dir) : fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      // never follow a link out of the tree (junctions to node_modules) -- but report it (U30F4 B5)
      if (e.isSymbolicLink()) {
        rules.links?.push(rel);
        continue;
      }
      if (e.isDirectory()) {
        if (rules.excludedDirNames.includes(e.name)) continue;
        if (rules.excludedPrefixes.some((p) => `${rel}/`.startsWith(p))) continue;
        walk(path.join(dir, e.name), rel);
      } else if (e.isFile()) {
        if (rules.excludedPrefixes.some((p) => rel.startsWith(p))) continue;
        out.push(rel);
      }
    }
  };
  walk(root, "");
  return out.sort();
}
