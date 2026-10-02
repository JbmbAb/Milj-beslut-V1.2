// TEST-DB-GUARD (OD-K0-5), TDG-4 -- the scanner of the data-root inventory: which environment keys
// and which default directories can make product code (server/, src/, services/, packages/*/src/,
// scripts/) read or write a data root. Derived from the code, never listed by hand.
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
]);

const SCOPE = /^(?:server|src|services|scripts)\/|^packages\/[^/]+\/src\//;
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
  return upper.split('_').some((token) => TOKEN_SET.has(token));
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
];
const DYNAMIC_INDEX = /process\.env\??\.?\[\s*(?!['"`])/;
const DYNAMIC_KEY_LITERAL = /(['"`])([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\1/g;

/** The fallback expression right after a read (`X || <fallback>`, `X ?? <fallback>`), or null. */
function fallbackAfter(text, end) {
  const tail = text.slice(end, end + 400);
  const m =
    /^\s*(?:\?\.\s*\w+\(\s*\)|\.\s*\w+\(\s*\))*\s*\)?\s*(?:\?\.\s*\w+\(\s*\)|\.\s*\w+\(\s*\))*\s*(\|\||\?\?)\s*/.exec(
      tail,
    );
  if (!m) return null;
  const rest = tail.slice(m[0].length);
  // up to the end of the statement/argument: `;`, a blank line, or a newline outside brackets
  let depth = 0;
  let out = '';
  for (let i = 0; i < rest.length; i += 1) {
    const c = rest[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) break;
      depth -= 1;
    }
    if (depth === 0 && (c === ';' || c === ',' || (c === '\n' && out.trim() !== ''))) break;
    out += c;
  }
  return out.trim().slice(0, 240) || null;
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
  if (/^(?:''|""|``|null|undefined|false|true|\d+|\[\]|\{\})(?:\s*\)|\s*$|\s*\.)/.test(e)) return 'none';
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
  return out;
}

/** cwd-relative and repo-relative default directories written in code. */
const RELATIVE_ROOTS = [
  {
    how: "join(process.cwd(), '<p>')",
    re: /(?:join|resolve)\(\s*process\.cwd\(\)\s*,\s*(['"`])([^'"`$]+)\1/g,
    group: 2,
  },
  {
    how: "path.resolve('<p>')",
    re: /(?<![\w$.])(?:path\.)?resolve\(\s*(['"`])((?![\\/]|[A-Za-z]:)[^'"`$]+)\1\s*[,)]/g,
    group: 2,
  },
  {
    how: "join(repoRoot, '<p>')",
    re: /(?:join|resolve)\(\s*(?:repoRoot\(\)|repoRoot|REPO_ROOT|projectRoot|PROJECT_ROOT|ROOT_DIR)\s*,\s*(['"`])([^'"`$]+)\1/g,
    group: 2,
  },
];

/** `.quarantine/x` -> `.quarantine`; `tests/fixtures/x` -> `tests/fixtures` (tests is not one root). */
export function topRelativeRoot(p) {
  const parts = posix(String(p).replace(/\\\\/g, '/').replace(/\\/g, '/'))
    .replace(/^\.\//, '')
    .split('/')
    .filter((s) => s && s !== '.');
  if (parts.length === 0) return '.';
  if (parts[0] === 'tests' && parts.length > 1) return `tests/${parts[1]}`;
  return parts[0];
}

function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

/**
 * The inventory. `envKeys`: every data-root-shaped key a product file reads, with each read
 * (file:line, how, fallback) and whether any read falls back to a location when the key is unset.
 * `relativeRoots`: every cwd- or repo-relative default directory by its top segment. `absoluteDefaults`:
 * absolute paths a key falls back to.
 */
export function scanDataRoots(root, options = {}) {
  const absRoot = path.resolve(root);
  const listed = listDataRootScanFiles(absRoot, options.how ?? 'auto');
  const envKeys = new Map();
  const relativeRoots = new Map();
  const absoluteDefaults = new Map();
  const note = (map, key, entry) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(entry);
  };
  for (const file of listed.files) {
    let raw;
    try {
      raw = fs.readFileSync(path.join(absRoot, file), 'utf8');
    } catch {
      continue;
    }
    const text = stripComments(raw);
    for (const read of ENV_READS) {
      for (const m of text.matchAll(read.re)) {
        const key = m[read.group];
        if (!isDataRootShapedEnvKey(key)) continue;
        const fallback = fallbackAfter(text, m.index + m[0].length);
        const kind = classifyFallback(fallback);
        const line = lineAt(text, m.index);
        note(envKeys, key, { file, line, how: read.how, fallback, fallbackKind: kind });
        for (const abs of absoluteLiteralsIn(fallback)) note(absoluteDefaults, abs, { file, line, key });
        for (const relPath of relativeLiteralsIn(fallback)) {
          note(relativeRoots, topRelativeRoot(relPath), {
            file,
            line,
            path: relPath,
            how: `${key} fallback`,
          });
        }
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
        note(relativeRoots, topRelativeRoot(p), { file, line: lineAt(text, m.index), path: p, how: rr.how });
      }
    }
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
    relativeRoots: sortObj(relativeRoots),
    absoluteDefaults: sortObj(absoluteDefaults),
  };
}
