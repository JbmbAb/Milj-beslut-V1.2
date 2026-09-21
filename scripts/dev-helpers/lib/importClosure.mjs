/**
 * DEV-HELPER (not an authority). Static, heuristic import-closure scan.
 *
 * Answers one cheap question before an expensive trusted run: "does this proof command load a module
 * that needs something the trusted environment does not have?" The concrete R1 case: the trusted
 * attest workflow installs with `npm ci --ignore-scripts`, so the Prisma client is never generated;
 * anything that imports server/db/prisma.ts then dies at import time (exit 2 / BLOCKED_ENVIRONMENT).
 *
 * It over- and under-approximates on purpose (regex parsing, no type information). Treat a hit as a
 * reason to look, never as a verdict. The protected controller and gate remain the authority.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

const SOURCE_EXT = /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/;
const PRELOAD_EXCLUDE = /^(?:public|docs|node_modules|GEO_Master_Archive|scratch|deploy)\//;
const SUFFIXES = ['', '.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs', '/index.ts', '/index.tsx', '/index.js', '/index.mjs'];

// import/export ... from 'x' | import 'x' | import('x') | require('x').
// `import type` / `export type` are erased at runtime and are captured (group 1) so they can be skipped.
const SPEC_RE =
  /\b(?:import|export)\s+(type\s+)?(?:[\w*${}\s,]+?\s+from\s+)?['"]([^'"\n]+)['"]|\bimport\(\s*['"]([^'"\n]+)['"]\s*\)|\brequire\(\s*['"]([^'"\n]+)['"]\s*\)/g;

/**
 * Blanks comments and string/template literals so that import-looking text INSIDE them (fixtures,
 * messages, documentation) is not mistaken for a real import. A string literal is kept verbatim only when
 * it is an import specifier: it directly follows `from`, `import`, `import(` or `require(`.
 * Heuristic: regex literals containing quotes can confuse it.
 */
export function maskSource(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') j += 1;
        j += 1;
      }
      const raw = src.slice(i, j + 1);
      const isSpecifier = c !== '`' && /(?:\bfrom|\bimport|\bimport\(|\brequire\()\s*$/.test(out);
      out += isSpecifier ? raw : c + raw.slice(1, -1).replace(/[^\n]/g, ' ') + (raw.length > 1 ? c : '');
      i = j + 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** Reads files from a working tree. */
export function fsReader(root) {
  return {
    read(path) {
      try {
        return statSync(join(root, path)).isFile() ? readFileSync(join(root, path), 'utf8') : null;
      } catch {
        return null;
      }
    },
    exists(path) {
      try {
        return statSync(join(root, path)).isFile();
      } catch {
        return false;
      }
    },
  };
}

/** Reads files from a git tree (any commit) without checking it out. Returns null-safe reader. */
export function gitReader(repo, sha) {
  let files = null;
  const list = () => {
    if (files) return files;
    const r = spawnSync('git', ['ls-tree', '-r', '--name-only', '-z', sha], {
      cwd: repo,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
    files = r.status === 0 ? new Set(r.stdout.split('\0').filter(Boolean)) : null;
    return files;
  };
  // One `git cat-file --batch` for every source file, instead of a git process per file (~100 ms each on
  // Windows, which made a closure scan take minutes). Source files are ~16 MB in total.
  let cache = null;
  const preload = () => {
    if (cache) return cache;
    cache = new Map();
    const names = [...(list() ?? [])].filter((p) => SOURCE_EXT.test(p) && !PRELOAD_EXCLUDE.test(p));
    if (names.length === 0) return cache;
    const r = spawnSync('git', ['cat-file', '--batch'], {
      cwd: repo,
      input: names.map((p) => `${sha}:${p}\n`).join(''),
      maxBuffer: 512 * 1024 * 1024,
    });
    if (r.status !== 0) return cache;
    const buf = r.stdout;
    let pos = 0;
    for (const name of names) {
      const eol = buf.indexOf(10, pos);
      if (eol < 0) break;
      const header = buf.toString('utf8', pos, eol).split(' ');
      pos = eol + 1;
      if (header[1] === 'missing') continue;
      const size = Number(header[2]);
      cache.set(name, buf.toString('utf8', pos, pos + size));
      pos += size + 1;
    }
    return cache;
  };
  return {
    available: () => list() !== null,
    exists: (path) => list()?.has(path) ?? false,
    read(path) {
      if (!list()?.has(path)) return null;
      const hit = preload().get(path);
      if (hit !== undefined) return hit;
      const r = spawnSync('git', ['cat-file', '-p', `${sha}:${path}`], {
        cwd: repo,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
      return r.status === 0 ? r.stdout : null;
    },
  };
}

/** Reads `@scope/name` path aliases out of the repository's root tsconfig.json (text scan, no JSON parse). */
export function loadAliases(reader) {
  const text = reader.read('tsconfig.json') ?? '';
  const exact = new Map();
  const prefix = [];
  for (const m of text.matchAll(/"(@[\w./-]+?)(\/\*)?"\s*:\s*\[\s*"([^"]+?)(\/\*)?"/g)) {
    const [, name, wild, target] = m;
    const t = target.replace(/^\.\//, '');
    if (wild) prefix.push([`${name}/`, `${t}/`]);
    else exact.set(name, t);
  }
  return { exact, prefix };
}

function resolveSpec(spec, fromFile, reader, aliases) {
  let base;
  if (spec.startsWith('.')) base = posix.normalize(posix.join(posix.dirname(fromFile), spec));
  else if (aliases.exact.has(spec)) base = aliases.exact.get(spec);
  else {
    const hit = aliases.prefix.find(([p]) => spec.startsWith(p));
    if (!hit) return null; // bare package specifier: lives in node_modules, not scanned
    base = hit[1] + spec.slice(hit[0].length);
  }
  const stem = base.replace(/\.(?:m?js|cjs)$/, '');
  for (const candidate of [base, ...SUFFIXES.map((s) => base + s), ...SUFFIXES.map((s) => stem + s)]) {
    if (SOURCE_EXT.test(candidate) && reader.exists(candidate)) return candidate;
  }
  return null;
}

/**
 * Breadth-first walk of runtime imports from `seeds`.
 * Returns { kind: 'file' | 'bare', hit, chain } for the first target reached, or null.
 *   fileTargets: RegExp matched against resolved repo-relative paths
 *   bareTargets: RegExp matched against unresolved (package) specifiers
 */
export function findRuntimeReach({ seeds, reader, aliases, fileTargets, bareTargets, maxNodes = 4000 }) {
  const seen = new Set();
  const queue = [];
  for (const seed of seeds) {
    if (reader.exists(seed) && SOURCE_EXT.test(seed)) {
      seen.add(seed);
      queue.push({ file: seed, chain: [seed] });
    }
  }
  let scanned = 0;
  while (queue.length > 0 && scanned < maxNodes) {
    const { file, chain } = queue.shift();
    scanned += 1;
    const source = reader.read(file);
    if (source === null) continue;
    for (const m of maskSource(source).matchAll(SPEC_RE)) {
      if (m[1]) continue; // type-only import/export
      const spec = m[2] ?? m[3] ?? m[4];
      if (bareTargets?.test(spec)) return { kind: 'bare', hit: spec, chain: [...chain, spec] };
      const resolved = resolveSpec(spec, file, reader, aliases);
      if (!resolved || seen.has(resolved)) continue;
      seen.add(resolved);
      if (fileTargets?.test(resolved)) return { kind: 'file', hit: resolved, chain: [...chain, resolved] };
      queue.push({ file: resolved, chain: [...chain, resolved] });
    }
  }
  return null;
}
