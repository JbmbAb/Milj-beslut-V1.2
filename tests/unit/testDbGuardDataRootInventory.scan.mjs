// TEST-DB-GUARD (OD-K0-5), TDG-4 -- the scanner of the data-root inventory: which environment keys
// and which default directories can make product code (server/, src/, services/, packages/*/src/,
// packages/*/scripts/, scripts/) read or write a data root. Derived from the code, never listed by hand.
//
// TDG-5: the scanner is a DRIFT GUARD, NOT A PROOF. It recognises the forms below by pattern; code that
// builds a key or a path in another way (a key or a path computed at run time, read from a file or an
// argument, passed through a variable it cannot follow) is not seen. The write guard
// (server/modules/test-db-guard/installTestDataRootWriteGuard.ts) is the in-process backstop behind it --
// not a proof either (children, worker_threads and the raw fs binding pass it: its KNOWN LIMITATIONS); this
// inventory only makes a NEW root in a known form fail CI until it is handled. Recognised:
//   - keys: process.env.X, process.env['X'], env.X, readEnv('X')-like helpers, a key-shaped literal in a
//     file that indexes process.env, process.env[`${p}_X`] (a pattern), process.env['A' + 'B'],
//     `const { X, Y: y = 'd' } = process.env`; TDG-6: Reflect.get(process.env, 'X') and another name for
//     process.env in the same file (`const e = process.env; e.X`, a parameter default, `{ env: e } =
//     process`); a key is data-root-shaped by a path-like NAME token or by a fallback that BUILDS A PATH
//     (whatever its name); fallbacks `X || f`, `X ?? f`, `X ? a : f`, `!X ? f : a`;
//   - relative roots: join/resolve(process.cwd() | cwd | repoRoot ... , 'a', 'b'), path.resolve('a'),
//     `${process.cwd()}/a`, process.cwd() + '/a', new URL('../a', import.meta.url),
//     join/resolve(__dirname | import.meta.dirname, '..', 'a') (resolved against the file); TDG-6:
//     `${cwd}/a` and cwd + '/a' with a cwd/repo-root variable, __dirname + '/../a' and `${__dirname}/a`, and a
//     relative literal handed straight to a writing fs call (`fs.writeFileSync('a/x')`, `copyFileSync(s, 'a/x')`);
//   - absolute paths: EVERY absolute path literal (drive, \\host\share, TDG-6: //host/share, a file:/// URL,
//     /tmp /mnt /home ...), with the literal segments a join/resolve adds; TDG-6: a drive put together with
//     the rest ('D:' + '\\x', ['D:', 'x'].join('\\')); a path under <drive>:\Users\<name> or from
//     os.homedir() (TDG-6: also USERPROFILE/HOME and os.userInfo().homedir) is reported home-relative (~/...).
// NOT recognised (KNOWN LIMITATION, TDG-6): `...rest` destructuring of process.env, a key or path computed at
// run time, path.join('a', ...) with no base (relative, but too common to tell from a sub-path), a relative
// fallback literal without `./` and without a name token ('n/a' cannot be told from a path), a path under
// tmpdir() that climbs out with '..', other package directories than src/ and scripts/ (packages/*/lib),
// POSIX paths outside the listed top directories, and tests and test helpers.
//
// Plain ESM (no TypeScript) so that the inventory test (tests/unit/testDbGuardDataRootInventory.test.ts)
// imports it and node can run it to print the inventory -- one scanner, never two copies that drift.
// Reads source files as text; imports nothing from the product, opens no network or database and
// reads no environment variable.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Where product code lives: the code a test can import or start. */
export const DATA_ROOT_SCAN_SCOPE = Object.freeze([
  'server/',
  'src/',
  'services/',
  'scripts/',
  'packages/*/src/',
  'packages/*/scripts/',
]);

const SCOPE = /^(?:server|src|services|scripts)\/|^packages\/[^/]+\/(?:src|scripts)\//;
const CODE_FILE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const NOT_PRODUCT = [
  /\.(?:test|spec)\.[cm]?[jt]sx?$/, // tests
  /\.d\.[cm]?ts$/, // declarations
  /(^|\/)__tests__\//,
  /^server\/modules\/test-db-guard\//, // the guard itself names every key it scrubs
];

/** The path-like name tokens: a key with one of them names a file-system location. */
export const DATA_ROOT_NAME_TOKENS = Object.freeze([
  'ROOT',
  'ROOTS',
  'DIR',
  'DIRS',
  'PATH',
  'PATHS',
  'HOME',
  'STORAGE',
  'UPLOAD',
  'UPLOADS',
  'QUARANTINE',
  'MANIFEST',
  'MANIFESTS',
  'DRAFT',
  'DRAFTS',
  'CACHE',
  'TMP',
  'TEMP',
  'TMPDIR',
  'OUT',
  'OUTPUT',
  'OUTDIR',
  'CAS',
  'GRANT',
  'GRANTS',
  'ARCHIVE',
  'DATA',
  // TDG-5 (TDG4-VERIFICATION finding 6): a remote store and the other location words
  'BUCKET',
  'BUCKETS',
  'FILE',
  'FILES',
  'FOLDER',
  'FOLDERS',
  'LOG',
  'LOGS',
  'STORE',
  'STORES',
  'SPOOL',
]);
const TOKEN_SET = new Set(DATA_ROOT_NAME_TOKENS);

/**
 * A data-root-shaped key: every MIMERS_* key (the durable CAS and its settings) and every key with a
 * path-like name token (QUARANTINE_ROOT, ADMIN_ROLE_GRANT_CAS_ROOT, OUTLOOK_BASE_DIR, BACKUP_DIR ...).
 * Shaped is not the same as being a data root: the inventory test requires every shaped key to be on
 * the scrub list or, reviewed, on the list of keys that are not data roots (a binary, a certificate).
 */
export function isDataRootShapedEnvKey(key) {
  const upper = String(key).toUpperCase();
  if (upper.startsWith('MIMERS_')) return true;
  return upper.split(/[_*]/).some((token) => TOKEN_SET.has(token));
}

/**
 * TDG-5: a fallback that BUILDS A PATH makes the key a data root whatever its name (a key named
 * VTDG4_SPOOL with `|| path.join(process.cwd(), 'spool')` has no name token): a path-building call, an
 * absolute literal or a dot-relative literal (`./x`, `../x`, `.quarantine`). A bare `a/b` literal does not
 * count here ('n/a', an S3 prefix 'backups/'); for a key shaped by its name it still does.
 */
export function fallbackBuildsPath(expr) {
  if (expr == null) return false;
  const e = String(expr);
  if (
    /process\.cwd\(\)|(?:^|[^\w$.])(?:os\.)?(?:homedir|tmpdir)\(\)|__dirname|import\.meta\.(?:dirname|url)|(?:^|[^\w$])(?:path\.)?(?:join|resolve)\(/.test(
      e,
    )
  )
    return true;
  for (const m of e.matchAll(PATH_LITERAL)) {
    const value = unescapeLiteral(m[2]);
    if (isAbsolutePathLiteral(value) || /^\.{1,2}[\\/]|^\.[A-Za-z0-9_-]/.test(value)) return true;
  }
  return false;
}

const posix = (p) => p.split(path.sep).join('/');

/** Product code files under `root`, relative and POSIX-style, sorted. */
export function isDataRootScanFile(relPath) {
  const rel = posix(relPath);
  return SCOPE.test(rel) && CODE_FILE.test(rel) && !NOT_PRODUCT.some((re) => re.test(rel));
}

function walk(root, dir, acc) {
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) continue; // never follow a link out of the tree
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
      walk(root, rel, acc);
    } else if (entry.isFile() && isDataRootScanFile(rel)) {
      acc.push(rel);
    }
  }
}

function gitTopLevel(root) {
  try {
    const top = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return path.resolve(top);
  } catch {
    return null;
  }
}

/**
 * Product code files of `root`: through git (tracked and untracked-not-ignored files, so a new file
 * a writer has not committed yet counts) when `root` is a git top level, otherwise by walking the
 * tree (an export without .git, the canary's temp copy). `how` forces one of the two.
 */
export function listDataRootScanFiles(root, how = 'auto') {
  const absRoot = path.resolve(root);
  const top = how === 'walk' ? null : gitTopLevel(absRoot);
  if (top && top.toLowerCase() === absRoot.toLowerCase()) {
    const out = execFileSync(
      'git',
      ['-C', absRoot, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const files = [...new Set(out.split('\0').filter(Boolean).map(posix))]
      .filter((rel) => isDataRootScanFile(rel) && fs.existsSync(path.join(absRoot, rel)))
      .sort();
    return { how: 'git', files };
  }
  if (how === 'git') throw new Error(`not a git top level: ${absRoot}`);
  const acc = [];
  for (const dir of ['server', 'src', 'services', 'scripts', 'packages']) walk(absRoot, dir, acc);
  return { how: 'walk', files: acc.sort() };
}

/**
 * Comments become blanks (newlines kept, so line numbers stay right); string and template literals
 * are kept as they are. A regular-expression literal is not recognised -- a `//` inside one may blank
 * the rest of its line, which can only hide a match on that line, never invent one.
 */
export function stripComments(text) {
  let out = '';
  let i = 0;
  let state = 'code';
  let quote = '';
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (state === 'code') {
      if (c === '/' && n === '/') {
        state = 'line';
        out += '  ';
        i += 2;
        continue;
      }
      if (c === '/' && n === '*') {
        state = 'block';
        out += '  ';
        i += 2;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') {
        state = 'string';
        quote = c;
      }
      out += c;
      i += 1;
      continue;
    }
    if (state === 'line') {
      if (c === '\n') {
        state = 'code';
        out += c;
      } else out += ' ';
      i += 1;
      continue;
    }
    if (state === 'block') {
      if (c === '*' && n === '/') {
        state = 'code';
        out += '  ';
        i += 2;
        continue;
      }
      out += c === '\n' ? '\n' : ' ';
      i += 1;
      continue;
    }
    // string / template literal
    if (c === '\\') {
      out += c + (n ?? '');
      i += 2;
      continue;
    }
    if (c === quote) state = 'code';
    else if (c === '\n' && quote !== '`') state = 'code'; // an unterminated quote ends at the line
    out += c;
    i += 1;
  }
  return out;
}

const KEY = '[A-Z][A-Z0-9_]*';
const Q = '([\'"`])';

/** How code reads an environment key. `dynamic`: a key-shaped literal in a file that indexes process.env. */
const ENV_READS = [
  { how: 'process.env.KEY', re: new RegExp(`process\\.env\\??\\.(${KEY})`, 'g'), group: 1 },
  {
    how: "process.env['KEY']",
    re: new RegExp(`process\\.env\\??\\.?\\[\\s*${Q}(${KEY})\\1\\s*\\]`, 'g'),
    group: 2,
  },
  { how: 'env.KEY', re: new RegExp(`(?<![\\w$.])env\\??\\.(${KEY})\\b`, 'g'), group: 1 },
  {
    how: "env['KEY']",
    re: new RegExp(`(?<![\\w$.])env\\??\\.?\\[\\s*${Q}(${KEY})\\1\\s*\\]`, 'g'),
    group: 2,
  },
  {
    how: "readEnv('KEY')",
    re: new RegExp(`\\b[A-Za-z_$]*[Ee]nv[A-Za-z0-9_$]*\\(\\s*${Q}(${KEY})\\1`, 'g'),
    group: 2,
  },
  // TDG-6 (TDG5-VERIFICATION finding 10)
  {
    how: "Reflect.get(process.env, 'KEY')",
    re: new RegExp(`Reflect\\.get\\(\\s*process\\.env\\s*,\\s*${Q}(${KEY})\\1`, 'g'),
    group: 2,
  },
];

/**
 * TDG-6: another name for process.env in the same file -- `const e = process.env`, a parameter default
 * `(vars = process.env)`, `const { env: e } = process` -- read as `e.KEY` / `e['KEY']` (`env` itself is
 * read above).
 */
const ENV_ALIAS = [
  /(?<![\w$.])([A-Za-z_$][\w$]*)\s*(?::\s*[\w$.<>[\]|\s]+?)?\s*=\s*process\.env\b(?!\s*(?:\??\.|\[))/g,
  /\{\s*env\s*:\s*([A-Za-z_$][\w$]*)\s*\}\s*=\s*process\b/g,
];
function envAliasReads(text) {
  const names = new Set();
  for (const re of ENV_ALIAS) for (const m of text.matchAll(re)) if (m[1] !== 'env') names.add(m[1]);
  return [...names].flatMap((name) => {
    const n = name.replace(/\$/g, '\\$');
    return [
      { how: 'alias.KEY', re: new RegExp(`(?<![\\w$.])${n}\\??\\.(${KEY})\\b`, 'g'), group: 1 },
      {
        how: "alias['KEY']",
        re: new RegExp(`(?<![\\w$.])${n}\\??\\.?\\[\\s*${Q}(${KEY})\\1\\s*\\]`, 'g'),
        group: 2,
      },
    ];
  });
}
const DYNAMIC_INDEX = /process\.env\??\.?\[\s*(?!['"`])/;
const DYNAMIC_KEY_LITERAL = /(['"`])([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\1/g;

// TDG-5: keys built in the index expression, and keys destructured from process.env.
const TEMPLATE_KEY = /process\.env\??\.?\[\s*`([^`]*)`\s*\]/g;
const KEY_PART = String.raw`(?:'[^'\n]*'|"[^"\n]*"|\x60[^\x60\n]*\x60|[\w$.]+(?:\(\s*\))?)`;
const CONCAT_KEY = new RegExp(
  `process\\.env\\??\\.?\\[\\s*(${KEY_PART}(?:\\s*\\+\\s*${KEY_PART})+)\\s*\\]`,
  'g',
);
const DESTRUCTURE = /(?:const|let|var)\s*\{([^{}]*)\}\s*=\s*process\.env\b/g;

/** `a, b = f(x, y), c` -> three items (commas inside brackets and quotes do not split). */
function splitTopLevel(list) {
  const items = [];
  let depth = 0;
  let quote = '';
  let current = '';
  for (const c of list) {
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '(' || c === '[') depth += 1;
    else if (c === ')' || c === ']') depth -= 1;
    else if (c === ',' && depth === 0) {
      items.push(current);
      current = '';
      continue;
    }
    current += c;
  }
  items.push(current);
  return items;
}

/** `${p}_STORE_ROOT` -> `*_STORE_ROOT`; `'A' + x + '_ROOT'` -> `A*_ROOT`. */
function keyFromTemplate(raw) {
  return raw.replace(/\$\{[^}]*\}/g, '*');
}
function keyFromConcat(expr) {
  let out = '';
  for (const m of expr.matchAll(new RegExp(KEY_PART, 'g'))) {
    const part = m[0];
    if (/^['"]/.test(part)) out += part.slice(1, -1);
    else if (part.startsWith('`')) out += keyFromTemplate(part.slice(1, -1));
    else out += '*';
  }
  return out;
}

/**
 * One expression from the start of `rest`: up to `;`, a `,` or a closing bracket at depth 0, or a newline
 * after content unless the next line continues the expression (`?`, `:`, `|`, `&`, `+`, `.`). With
 * `stopAtColon`, also up to the `:` that closes a ternary begun outside it.
 */
function readExpression(rest, stopAtColon) {
  let depth = 0;
  let pending = 0;
  let quote = '';
  let out = '';
  for (let i = 0; i < rest.length; i += 1) {
    const c = rest[i];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += rest[i + 1] ?? '';
        i += 1;
      } else if (c === quote) quote = '';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      out += c;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth += 1;
    if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) break;
      depth -= 1;
    }
    if (depth === 0) {
      if (c === ';' || c === ',') break;
      if (c === '\n' && out.trim() !== '') {
        const next = /^\s*(\S)/.exec(rest.slice(i + 1));
        if (!next || !'?:|&+.'.includes(next[1])) break;
      }
      if (c === '?' && rest[i + 1] !== '?' && rest[i + 1] !== '.') pending += 1;
      if (c === ':') {
        if (pending > 0) pending -= 1;
        else if (stopAtColon) break;
      }
    }
    out += c;
  }
  return out;
}

const trimmedFallback = (expr) => {
  const e = String(expr ?? '').trim();
  return e ? e.slice(0, 240) : null;
};

/**
 * The fallback expression of a read that ends at `end` and starts at `start`: `X || <f>`, `X ?? <f>`,
 * `X ? <a> : <f>` and `!X ? <f> : <a>` (TDG-5); null when the read has none.
 */
function fallbackAfter(text, end, start = end) {
  const tail = text.slice(end, end + 600);
  const lead =
    /^\s*(?:\?\.\s*\w+\(\s*\)|\.\s*\w+\(\s*\))*\s*\)?\s*(?:\?\.\s*\w+\(\s*\)|\.\s*\w+\(\s*\))*\s*/.exec(
      tail,
    )[0];
  const rest = tail.slice(lead.length);
  const op = /^(?:\|\||\?\?)\s*/.exec(rest);
  if (op) return trimmedFallback(readExpression(rest.slice(op[0].length), false));
  const ternary = /^\?(?![?.])\s*/.exec(rest);
  if (!ternary) return null;
  const afterQ = rest.slice(ternary[0].length);
  const consequent = readExpression(afterQ, true);
  if (/!\s*\(?\s*$/.test(text.slice(Math.max(0, start - 4), start))) return trimmedFallback(consequent);
  if (afterQ[consequent.length] !== ':') return null;
  return trimmedFallback(readExpression(afterQ.slice(consequent.length + 1), false));
}

const PATH_LITERAL = /(['"`])((?:[^'"`\\]|\\.)*)\1/g;

function unescapeLiteral(raw) {
  return raw.replace(/\\\\/g, '\\');
}

function isAbsolutePathLiteral(value) {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\') || /^\/[A-Za-z0-9_.-]/.test(value);
}

function isRelativePathLiteral(value) {
  if (!value || isAbsolutePathLiteral(value)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return false; // a URL
  if (value.includes('${')) return false;
  return /^\.{1,2}[\\/]|^\.[A-Za-z0-9_-]|[\\/]/.test(value) && !/\s/.test(value);
}

/**
 * Classifies a fallback: `none` (no location: empty/null/a plain value such as 'best-effort'),
 * `caller` (options.x -- the caller's own value), `location` (a path or an expression that builds one;
 * conservative: any expression not shown to be one of the first two).
 */
export function classifyFallback(expr) {
  if (expr == null) return 'none';
  const e = expr.trim();
  if (/^(?:''|""|``|null|undefined|false|true|\d[\d_]*(?:\.\d+)?|\[\]|\{\})(?:\s*\)|\s*$|\s*\.)/.test(e))
    return 'none';
  const lit = /^(['"])((?:[^'"\\]|\\.)*)\1\s*(?:\)|$|\.)/.exec(e);
  if (lit) {
    const value = unescapeLiteral(lit[2]);
    return isAbsolutePathLiteral(value) || isRelativePathLiteral(value) || value.startsWith('.')
      ? 'location'
      : 'none';
  }
  if (/^(?:options|opts|args|params|input|config)\??\.\w+\s*$/.test(e)) return 'caller';
  return 'location';
}

/** The absolute path literals in a fallback expression (an unset key then means that live location). */
function absoluteLiteralsIn(expr) {
  const out = [];
  for (const m of (expr ?? '').matchAll(PATH_LITERAL)) {
    const value = unescapeLiteral(m[2]);
    if (isAbsolutePathLiteral(value)) out.push(value);
  }
  return out;
}

/** Relative path literals in a fallback expression (an unset key then means <cwd>/<that>). */
function relativeLiteralsIn(expr) {
  const out = [];
  const e = expr ?? '';
  const cwdJoin = /(?:join|resolve)\(\s*process\.cwd\(\)\s*,\s*(['"`])([^'"`]+)\1/g;
  for (const m of e.matchAll(cwdJoin)) out.push(m[2]);
  const firstArg = /(?<![\w$.])(?:path\.)?(?:join|resolve)\(\s*(['"`])([^'"`]+)\1/g;
  for (const m of e.matchAll(firstArg)) if (!isAbsolutePathLiteral(m[2])) out.push(m[2]);
  const bare = /^(['"])((?:[^'"\\]|\\.)*)\1/.exec(e.trim());
  if (bare) {
    const value = unescapeLiteral(bare[2]);
    if (!isAbsolutePathLiteral(value) && (isRelativePathLiteral(value) || value.startsWith('.')))
      out.push(value);
  }
  // TDG-5: `${process.cwd()}/.quarantine`, process.cwd() + '/x'
  for (const m of e.matchAll(CWD_TEMPLATE)) out.push(m[1]);
  for (const m of e.matchAll(CWD_CONCAT)) out.push(m[2]);
  return out;
}

/** The literal arguments that follow position `at` (`, 'a', "b"`), up to the first that is not one. */
function literalArgsAt(text, at) {
  const out = [];
  const re = /^\s*,\s*(['"`])([^'"`$\n]*)\1/;
  let rest = text.slice(at, at + 600);
  for (let m = re.exec(rest); m; m = re.exec(rest)) {
    out.push(unescapeLiteral(m[2]));
    rest = rest.slice(m[0].length);
  }
  return out;
}

/**
 * The bases a cwd- or repo-relative directory is joined to (TDG-5: and a `cwd` variable). Generic names
 * such as rootDir or workspaceRoot are a caller's root (a CAS, a corpus), not the tree: not followed.
 */
const CWD_BASES = String.raw`process\.cwd\(\)|repoRoot\(\)|repoRoot|REPO_ROOT|projectRoot|PROJECT_ROOT|ROOT_DIR|cwd|CWD`;
const BASE_JOIN = new RegExp(`(?<![\\w$.])(?:path\\.)?(?:join|resolve)\\(\\s*(${CWD_BASES})\\s*(?=,)`, 'g');
const FILE_BASE_JOIN =
  /(?<![\w$.])(?:path\.)?(?:join|resolve)\(\s*(__dirname|import\.meta\.dirname)\s*(?=,)/g;
const URL_RELATIVE = /new\s+URL\(\s*(['"`])([^'"`$\n]+)\1\s*,\s*import\.meta\.url\s*\)/g;
const CWD_TEMPLATE = /`\$\{\s*process\.cwd\(\)\s*\}[\\/]+([^`$]+)/g;
const CWD_CONCAT = /process\.cwd\(\)\s*\+\s*(['"`])[\\/]+([^'"`$\n]+)\1/g;
// TDG-6 (TDG5-VERIFICATION finding 10): a cwd/repo-root VARIABLE with `+` or in a template
const CWD_VARS = String.raw`repoRoot\(\)|repoRoot|REPO_ROOT|projectRoot|PROJECT_ROOT|ROOT_DIR|cwd|CWD`;
const CWD_VAR_TEMPLATE = new RegExp(`\`\\$\\{\\s*(?:${CWD_VARS})\\s*\\}[\\\\/]+([^\`$]+)`, 'g');
const CWD_VAR_CONCAT = new RegExp(`(?<![\\w$.])(?:${CWD_VARS})\\s*\\+\\s*(['"\`])[\\\\/]+([^'"\`$\\n]+)\\1`, 'g');
// TDG-6: a file-relative path built with `+` or a template (`__dirname + '/../x'`, `${import.meta.dirname}/x`)
const FILE_CONCAT = /(?<![\w$.])(?:__dirname|import\.meta\.dirname)\s*\+\s*(['"`])[\\/]+([^'"`$\n]+)\1/g;
const FILE_TEMPLATE = /`\$\{\s*(?:__dirname|import\.meta\.dirname)\s*\}[\\/]+([^`$]+)/g;
/**
 * TDG-6 (TDG5-VERIFICATION finding 10): a RELATIVE literal handed straight to a writing fs call --
 * `fs.writeFileSync('rot/x')`, `mkdirSync('out')`, `copyFileSync(a, 'rot/x')` -- is cwd-relative.
 */
const FS_FIRST_ARG_WRITERS = String.raw`writeFileSync|writeFile|appendFileSync|appendFile|mkdirSync|mkdir|mkdtempSync|mkdtemp|createWriteStream|truncateSync|truncate|rmSync|rmdirSync|rmdir|unlinkSync|unlink|outputFileSync|outputFile|ensureDirSync|ensureDir`;
const FS_SECOND_ARG_WRITERS = String.raw`copyFileSync|copyFile|cpSync|renameSync|rename|linkSync|symlinkSync`;
const FS_RECEIVER = String.raw`(?:(?:fs|fsp|fsPromises|fse|promises|nodeFs)\s*\.\s*)?`;
const FS_FIRST = new RegExp(
  `(?<![\\w$.])${FS_RECEIVER}(?:${FS_FIRST_ARG_WRITERS})\\(\\s*(['"\`])([^'"\`$\\n]+)\\1`,
  'g',
);
const FS_SECOND = new RegExp(
  `(?<![\\w$.])${FS_RECEIVER}(?:${FS_SECOND_ARG_WRITERS})\\(\\s*[^,()]+(?:\\([^()]*\\))?[^,()]*,\\s*(['"\`])([^'"\`$\\n]+)\\1`,
  'g',
);

/** cwd-relative and repo-relative default directories written in code. */
const RELATIVE_ROOTS = [
  {
    how: "path.resolve('<p>')",
    re: /(?<![\w$.])(?:path\.)?resolve\(\s*(['"`])((?![\\/]|[A-Za-z]:)[^'"`$]+)\1\s*[,)]/g,
    group: 2,
  },
  { how: '`${process.cwd()}/<p>`', re: CWD_TEMPLATE, group: 1 },
  { how: "process.cwd() + '/<p>'", re: CWD_CONCAT, group: 2 },
  { how: '`${cwd}/<p>`', re: CWD_VAR_TEMPLATE, group: 1 },
  { how: "cwd + '/<p>'", re: CWD_VAR_CONCAT, group: 2 },
  { how: "fs.writeFileSync('<p>')", re: FS_FIRST, group: 2, relativeOnly: true },
  { how: "fs.copyFileSync(a, '<p>')", re: FS_SECOND, group: 2, relativeOnly: true },
];

/**
 * `.quarantine/x` -> `.quarantine`; `tests/fixtures/x` -> `tests/fixtures` (tests is not one root);
 * TDG-5: `../Ops_Pipeline/x` -> `../Ops_Pipeline` (a sibling of the tree keeps its `..`).
 */
export function topRelativeRoot(p) {
  const parts = posix(String(p).replace(/\\\\/g, '/').replace(/\\/g, '/'))
    .replace(/^\.\//, '')
    .split('/')
    .filter((s) => s && s !== '.');
  if (parts.length === 0) return '.';
  let up = 0;
  while (parts[up] === '..') up += 1;
  if (up > 0) return parts.slice(0, Math.min(up + 1, parts.length)).join('/');
  if (parts[0] === 'tests' && parts.length > 1) return `tests/${parts[1]}`;
  return parts[0];
}

function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

// ---------------------------------------------------------------------------------------------------
// TDG-5: every absolute path literal, and every path under the home directory.

const ANY_LITERAL = /(['"`])((?:[^'"`\\\n]|\\.)*)\1/g;
const POSIX_FS_ROOT = /^\/(?:tmp|mnt|home|var|data|opt|srv|Users|root|etc|media|Volumes|usr)(?:\/|$)/;
// TDG-6 (TDG5-VERIFICATION finding 10): a UNC path written with forward slashes (`//host/share`) too
const WIN_ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\\\\[A-Za-z0-9._$-]+\\[^\\]|\/\/[A-Za-z0-9._$-]+\/[^/])/;

/** `C:\x\` -> `C:\x`; `/tmp/x/` -> `/tmp/x`; a bare root (`C:\`, `/`) -> null (only compared or listed). */
function normalizeAbsolute(value) {
  if (WIN_ABSOLUTE.test(value)) {
    const n = path.win32.normalize(value.replace(/\//g, '\\'));
    const trimmed = n.length > 3 ? n.replace(/\\+$/, '') : n;
    return /^[A-Za-z]:\\?$/.test(trimmed) ? null : trimmed;
  }
  const n = path.posix.normalize(value).replace(/\/+$/, '');
  return n === '' || n === '/' ? null : n;
}

/** `C:\Users\<name>\x` (the system drive's profiles) and `/home|/Users/<name>/x` -> `~/x`, else null. */
export function homeRelative(absolute) {
  const win = /^[Cc]:\\Users\\[^\\]+(\\.*)?$/.exec(absolute);
  if (win) return `~${(win[1] ?? '').replace(/\\/g, '/')}`;
  const nix = /^\/(?:home|Users)\/[^/]+(\/.*)?$/.exec(absolute);
  if (nix) return `~${nix[1] ?? ''}`;
  return null;
}

// TDG-6 (TDG5-VERIFICATION finding 10): the home directory also as USERPROFILE/HOME or os.userInfo().homedir
const HOME_BASE = String.raw`(?:os\.)?homedir\(\)|process\.env\.(?:USERPROFILE|HOME)\b|(?:os\.)?userInfo\(\)\.homedir`;
const HOME_JOIN = new RegExp(`(?<![\\w$.])(?:path\\.)?(?:join|resolve)\\(\\s*(?:${HOME_BASE})\\s*(?=,)`, 'g');
const HOME_TEMPLATE = new RegExp(`\`\\$\\{\\s*(?:${HOME_BASE})\\s*\\}[\\\\/]+([^\`$]+)`, 'g');
const HOME_CONCAT = new RegExp(`(?:${HOME_BASE})\\s*\\+\\s*(['"\`])[\\\\/]+([^'"\`$\\n]+)\\1`, 'g');

/**
 * TDG-6 (TDG5-VERIFICATION finding 10): a drive root put together with the rest -- `'D:' + '\\x'`,
 * `'D:\\' + 'x'`, `['D:', 'x', 'y'].join('\\')` -- and a `file:///D:/x` URL literal.
 */
const DRIVE_CONCAT = /(['"`])([A-Za-z]:(?:\\\\|\/)?)\1\s*\+\s*(['"`])([^'"`$\n]+)\3/g;
const DRIVE_ARRAY_JOIN =
  /\[\s*(['"`])([A-Za-z]:(?:\\\\|\/)?)\1((?:\s*,\s*(['"`])[^'"`$\n]*\4)+)\s*,?\s*\]\s*\.join\(\s*(['"`])(?:\\\\|\/)\5\s*\)/g;
function pathOfFileUrlLiteral(value) {
  const m = /^file:\/\/(?:localhost)?\/([^?#]*)$/i.exec(value);
  if (!m) return null;
  let rest = m[1];
  try {
    rest = decodeURIComponent(rest);
  } catch {
    // keep it as written
  }
  return /^[A-Za-z]:[\\/]/.test(rest) ? rest : `/${rest}`;
}

const homePath = (rest) => `~/${path.posix.normalize(rest.replace(/\\/g, '/')).replace(/^\/+|\/+$/g, '')}`;

/**
 * The inventory. `envKeys`: every data-root-shaped key a product file reads, with each read
 * (file:line, how, fallback) and whether any read falls back to a location when the key is unset.
 * `dynamicEnvKeys`: data-root-shaped keys built at run time (`*_STORE_ROOT`). `relativeRoots`: every cwd-
 * or repo-relative default directory by its top segment. `absoluteDefaults`: absolute paths a key falls
 * back to. `absolutePaths`: EVERY absolute path literal; `homePaths`: every path under the home directory.
 */
export function scanDataRoots(root, options = {}) {
  const absRoot = path.resolve(root);
  const listed = listDataRootScanFiles(absRoot, options.how ?? 'auto');
  const envKeys = new Map();
  const dynamicEnvKeys = new Map();
  const relativeRoots = new Map();
  const absoluteDefaults = new Map();
  const absolutePaths = new Map();
  const homePaths = new Map();
  const note = (map, key, entry) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(entry);
  };
  const noteAbsolute = (value, file, line, how) => {
    const normalized = normalizeAbsolute(value);
    if (normalized === null) return;
    const home = homeRelative(normalized);
    if (home !== null) note(homePaths, home, { file, line, how, path: normalized });
    else note(absolutePaths, normalized, { file, line, how });
  };
  const noteRead = (file, text, key, start, end, how, fallbackText) => {
    const fallback = fallbackText === undefined ? fallbackAfter(text, end, start) : fallbackText;
    if (!isDataRootShapedEnvKey(key) && !fallbackBuildsPath(fallback)) return;
    const line = lineAt(text, start);
    if (key.includes('*')) {
      note(dynamicEnvKeys, key, { file, line, how });
      return;
    }
    const kind = classifyFallback(fallback);
    note(envKeys, key, { file, line, how, fallback, fallbackKind: kind });
    for (const abs of absoluteLiteralsIn(fallback)) note(absoluteDefaults, abs, { file, line, key });
    for (const relPath of relativeLiteralsIn(fallback)) {
      note(relativeRoots, topRelativeRoot(relPath), { file, line, path: relPath, how: `${key} fallback` });
    }
  };
  for (const file of listed.files) {
    let raw;
    try {
      raw = fs.readFileSync(path.join(absRoot, file), 'utf8');
    } catch {
      continue;
    }
    const text = stripComments(raw);
    for (const read of [...ENV_READS, ...envAliasReads(text)]) {
      for (const m of text.matchAll(read.re)) {
        noteRead(file, text, m[read.group], m.index, m.index + m[0].length, read.how);
      }
    }
    for (const m of text.matchAll(TEMPLATE_KEY)) {
      if (!m[1].includes('${')) continue; // a plain key in backticks: read above
      noteRead(file, text, keyFromTemplate(m[1]), m.index, m.index + m[0].length, 'process.env[`${x}_KEY`]');
    }
    for (const m of text.matchAll(CONCAT_KEY)) {
      noteRead(file, text, keyFromConcat(m[1]), m.index, m.index + m[0].length, "process.env['A' + 'B']");
    }
    for (const m of text.matchAll(DESTRUCTURE)) {
      for (const item of splitTopLevel(m[1])) {
        const d =
          /^\s*(?:\[\s*)?(['"`]?)([A-Z][A-Z0-9_]*)\1(?:\s*\])?\s*(?::\s*[\w$]+)?\s*(?:=\s*([\s\S]+?))?\s*$/.exec(
            item,
          );
        if (!d) continue;
        noteRead(file, text, d[2], m.index, m.index, 'const { KEY } = process.env', trimmedFallback(d[3]));
      }
    }
    if (DYNAMIC_INDEX.test(text)) {
      for (const m of text.matchAll(DYNAMIC_KEY_LITERAL)) {
        const key = m[2];
        if (!isDataRootShapedEnvKey(key)) continue;
        note(envKeys, key, {
          file,
          line: lineAt(text, m.index),
          how: 'dynamic',
          fallback: null,
          fallbackKind: 'none',
        });
      }
    }
    for (const rr of RELATIVE_ROOTS) {
      for (const m of text.matchAll(rr.re)) {
        const p = m[rr.group];
        if (/^[a-z][a-z0-9+.-]*:/i.test(p)) continue;
        if (rr.relativeOnly && (isAbsolutePathLiteral(unescapeLiteral(p)) || /^[\\/]/.test(p))) continue;
        note(relativeRoots, topRelativeRoot(p), { file, line: lineAt(text, m.index), path: p, how: rr.how });
      }
    }
    // join/resolve(<cwd or repo root>, 'a', 'b' ...): every literal segment, `..` included
    for (const m of text.matchAll(BASE_JOIN)) {
      const args = literalArgsAt(text, m.index + m[0].length);
      if (args.length === 0 || isAbsolutePathLiteral(args[0])) continue;
      const p = path.posix.join(...args.map((a) => a.replace(/\\/g, '/')));
      if (/^[a-z][a-z0-9+.-]*:/i.test(p) || p === '.') continue;
      note(relativeRoots, topRelativeRoot(p), {
        file,
        line: lineAt(text, m.index),
        path: p,
        how: `join(${m[1]}, '<p>')`,
      });
    }
    // relative to the file itself: join(__dirname, '..', 'x'), new URL('../x', import.meta.url)
    const fileDir = path.posix.dirname(file);
    const noteFileRelative = (rel, index, how) => {
      const p = path.posix.normalize(path.posix.join(fileDir, rel.replace(/\\/g, '/')));
      if (p === '.' || p === './') return; // the tree itself: a base for further joins, never a target
      note(relativeRoots, topRelativeRoot(p), { file, line: lineAt(text, index), path: p, how });
    };
    for (const m of text.matchAll(FILE_BASE_JOIN)) {
      const args = literalArgsAt(text, m.index + m[0].length);
      if (args.length === 0 || isAbsolutePathLiteral(args[0])) continue;
      noteFileRelative(
        path.posix.join(...args.map((a) => a.replace(/\\/g, '/'))),
        m.index,
        `join(${m[1]}, '<p>')`,
      );
    }
    for (const m of text.matchAll(URL_RELATIVE)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(m[2]) || m[2].startsWith('/')) continue;
      noteFileRelative(m[2], m.index, "new URL('<p>', import.meta.url)");
    }
    for (const m of text.matchAll(FILE_CONCAT)) noteFileRelative(m[2], m.index, "__dirname + '/<p>'");
    for (const m of text.matchAll(FILE_TEMPLATE)) noteFileRelative(m[1], m.index, '`${__dirname}/<p>`');
    // TDG-6: a drive root put together with the rest; a file:/// URL literal
    for (const m of text.matchAll(DRIVE_CONCAT)) {
      const drive = m[2].replace(/[\\/]+$/, '');
      noteAbsolute(`${drive}\\${unescapeLiteral(m[4]).replace(/^[\\/]+/, '')}`, file, lineAt(text, m.index), "'D:' + '\\x'");
    }
    for (const m of text.matchAll(DRIVE_ARRAY_JOIN)) {
      const parts = [...m[3].matchAll(/(['"`])([^'"`$\n]*)\1/g)].map((p) => unescapeLiteral(p[2]));
      noteAbsolute(
        path.win32.join(`${m[2].replace(/[\\/]+$/, '')}\\`, ...parts),
        file,
        lineAt(text, m.index),
        "['D:', 'x'].join('\\')",
      );
    }
    // every absolute path literal (a template literal up to its first ${...}); join/resolve's literal tail
    for (const m of text.matchAll(ANY_LITERAL)) {
      let value = unescapeLiteral(m[2]);
      const interpolation = value.indexOf('${');
      if (interpolation >= 0) value = value.slice(0, interpolation);
      const fromUrl = pathOfFileUrlLiteral(value);
      if (fromUrl !== null) value = fromUrl;
      if (!WIN_ABSOLUTE.test(value) && !POSIX_FS_ROOT.test(value)) continue;
      const before = text.slice(Math.max(0, m.index - 24), m.index);
      if (interpolation < 0 && /(?:join|resolve)\(\s*$/.test(before)) {
        const tail = literalArgsAt(text, m.index + m[0].length);
        if (tail.length > 0) {
          value = WIN_ABSOLUTE.test(value)
            ? path.win32.join(value, ...tail)
            : path.posix.join(value, ...tail);
        }
      }
      noteAbsolute(value, file, lineAt(text, m.index), 'literal');
    }
    // the home directory: join(os.homedir(), 'a'), `${os.homedir()}/a`, os.homedir() + '/a'
    for (const m of text.matchAll(HOME_JOIN)) {
      const args = literalArgsAt(text, m.index + m[0].length);
      if (args.length === 0) continue;
      note(homePaths, homePath(args.join('/')), {
        file,
        line: lineAt(text, m.index),
        how: 'join(os.homedir(), ...)',
      });
    }
    for (const m of text.matchAll(HOME_TEMPLATE))
      note(homePaths, homePath(m[1]), { file, line: lineAt(text, m.index), how: '`${os.homedir()}/...`' });
    for (const m of text.matchAll(HOME_CONCAT))
      note(homePaths, homePath(m[2]), { file, line: lineAt(text, m.index), how: "os.homedir() + '/...'" });
  }
  const keys = {};
  for (const [key, reads] of [...envKeys].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    keys[key] = {
      reads,
      fallsBackToLocation: reads.some((r) => r.fallbackKind === 'location'),
    };
  }
  const sortObj = (map) => Object.fromEntries([...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return {
    how: listed.how,
    fileCount: listed.files.length,
    envKeys: keys,
    dynamicEnvKeys: sortObj(dynamicEnvKeys),
    relativeRoots: sortObj(relativeRoots),
    absoluteDefaults: sortObj(absoluteDefaults),
    absolutePaths: sortObj(absolutePaths),
    homePaths: sortObj(homePaths),
  };
}
