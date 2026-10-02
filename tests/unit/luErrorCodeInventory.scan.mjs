// W-M2e item 2 -- the scanner of the exhaustive error-code inventory (tests/unit/luErrorCodeInventory.test.ts).
//
// Plain ESM (no TypeScript) so the same code can be imported by the test and run by node to print the
// inventory -- one scanner, never two copies that drift. Reads source files as text; imports nothing
// from the product, touches no network, database or environment.

import fs from 'node:fs';
import path from 'node:path';

/** The modules whose answers the LU UI reads: the LU routes and the LU workers behind bootstrap/geometry/viewer status. */
export const LU_ENTRY_MODULES = Object.freeze([
  'server/routes/localization.routes.ts',
  'server/routes/property.routes.ts',
  'server/workers/lu-project-context-bootstrap-worker.ts',
  'server/workers/lu-viewer-capability-worker.ts',
  'server/workers/lu-geometry-supersession-worker.ts',
  'server/workers/lu-execution-identity-v3-worker.ts',
]);

/**
 * The LU core: here EVERY code-shaped literal and table key is collected (the reasons, states and
 * assurance values of the read-back are written as comparisons, call arguments and table keys too).
 */
const LU_CORE = /^(server\/modules\/localization\/|server\/routes\/(localization|property)\.routes\.ts$|src\/application\/(generate-localization-report\.usecase|resolveCanonicalProjectContext|resolveCurrentViewerIdentity)\.ts$)/;

const posix = (p) => p.split(path.sep).join('/');

function walk(dir, acc) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', '__tests__', '.git'].includes(entry.name)) continue;
      walk(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      acc.push(full);
    }
  }
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

/** Code-shaped string literals, by how they are written. */
const PATTERNS = [
  // a prefix of the LU error vocabulary
  ['prefix', /['"`]((?:ASSESSMENT|REJECT|PINNED|LU|VERIFIER|PROPERTY|EVIDENCE|CHECKS|LOCALIZATION|GOVERNED)_[A-Z0-9_]*[A-Z0-9]|CURRENT[A-Z0-9_]*[A-Z0-9])/g],
  // an error-shaped suffix
  [
    'suffix',
    /['"`]([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_(?:ERROR|FAULT|FAILED|FAILURE|REFUSED|REJECTED|DENIED|MISMATCH|UNAVAILABLE|NOT_FOUND|INVALID|UNVERIFIED|UNREADABLE|AMBIGUOUS|FORBIDDEN|MISSING|TAMPERED|CORRUPTED|INCONSISTENT|UNRESOLVED|UNRESOLVABLE|EXPIRED|TIMEOUT|EXCEEDED|CONFLICT|OWNER)(?:_[A-Z0-9]+)*)['"`]/g,
  ],
  // compared with a wire field
  [
    'compare',
    /\b(?:reason|code|failureClass|reasonCode|failure_class|reason_code|technical_error_class|coverage_state|failureCode|errorCode)\s*[!=]==?\s*['"`]([A-Z][A-Z0-9_]*[A-Z0-9])['"`]/g,
  ],
  // the code at the start of a message or basis entry ("REJECT_X: ...", `UNKNOWN_SEVERITY:${id}`)
  ['message-prefix', /['"`]([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+):/g],
];
const CARRIER =
  /\b(code|failureClass|reasonCode|failure_class|reason_code|technical_error_class|coverage_state|errorCode|failureCode|reason)\??\s*[:=]\s*((?:['"`][A-Z][A-Z0-9_]*[A-Z0-9]['"`]\s*\|?\s*)+)/g;
const ARRAY_CARRIER = /\breason_codes\??\s*:\s*\[([^\]]*)\]/g;
const TYPE_UNION =
  /\btype\s+(\w*(?:FailureClass|ErrorClass|FaultReason|Reason|ReasonCode|CoverageState|Violation|ErrorCode|FailureCode))\s*(?:<[^>]*>)?\s*=\s*([^;]+);/g;
const LITERAL = /['"`]([A-Z][A-Z0-9_]*[A-Z0-9])['"`]/g;
const CORE_LITERAL = /['"`]([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)['"`]/g;
const CORE_KEY = /^\s*([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\s*:/gm;

/**
 * Scans server/, src/application/ and packages/<pkg>/src (non-test sources, comments stripped).
 * @returns {{ tokens: Map<string, { files: Set<string>, how: Set<string> }>, files: string[] }}
 */
export function scanServerTokens(root) {
  const files = [];
  walk(path.join(root, 'server'), files);
  walk(path.join(root, 'src', 'application'), files);
  for (const pkg of fs.readdirSync(path.join(root, 'packages'))) walk(path.join(root, 'packages', pkg, 'src'), files);
  const tokens = new Map();
  const add = (token, file, how) => {
    let entry = tokens.get(token);
    if (!entry) tokens.set(token, (entry = { files: new Set(), how: new Set() }));
    entry.files.add(file);
    entry.how.add(how);
  };
  for (const file of files) {
    const rel = posix(path.relative(root, file));
    const source = stripComments(fs.readFileSync(file, 'utf8'));
    for (const [how, pattern] of PATTERNS) for (const m of source.matchAll(pattern)) add(m[1], rel, how);
    for (const m of source.matchAll(CARRIER)) for (const t of m[2].matchAll(LITERAL)) add(t[1], rel, `field:${m[1]}`);
    for (const m of source.matchAll(ARRAY_CARRIER)) for (const t of m[1].matchAll(LITERAL)) add(t[1], rel, 'field:reason_codes');
    for (const m of source.matchAll(TYPE_UNION)) for (const t of m[2].matchAll(LITERAL)) add(t[1], rel, `type:${m[1]}`);
    if (LU_CORE.test(rel)) {
      for (const m of source.matchAll(CORE_LITERAL)) add(m[1], rel, 'lu-core');
      for (const m of source.matchAll(CORE_KEY)) add(m[1], rel, 'lu-core-key');
    }
  }
  return { tokens, files: files.map((f) => posix(path.relative(root, f))) };
}

function resolveFile(base) {
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
  if (/\.m?js$/.test(base)) candidates.push(base.replace(/\.m?js$/, '.ts'), base.replace(/\.m?js$/, '.tsx'));
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* not this one */
    }
  }
  return null;
}

function resolveSpecifier(root, spec, from) {
  if (spec.startsWith('.')) return resolveFile(path.resolve(path.dirname(from), spec));
  const pkg = /^@miljobeslut\/([^/]+)(?:\/(.*))?$/.exec(spec);
  if (pkg) return pkg[2] ? resolveFile(path.join(root, 'packages', pkg[1], pkg[2])) : resolveFile(path.join(root, 'packages', pkg[1], 'src', 'index'));
  if (spec.startsWith('~/')) return resolveFile(path.join(root, spec.slice(2)));
  if (spec.startsWith('@/')) return resolveFile(path.join(root, 'src', spec.slice(2)));
  return null;
}

const IMPORT =
  /\b(import|export)\s+(type\s+)?(?:[^'"`;]*?\sfrom\s*)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)|\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * The static value-import closure (`import type` carries no runtime value) of LU_ENTRY_MODULES: the
 * only modules whose codes can reach an answer the LU UI reads.
 * @returns {Set<string>} repo-relative posix paths
 */
export function luReachClosure(root) {
  const seen = new Set();
  const stack = LU_ENTRY_MODULES.map((m) => path.join(root, m));
  while (stack.length > 0) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = stripComments(fs.readFileSync(file, 'utf8'));
    for (const m of source.matchAll(IMPORT)) {
      if (m[2]) continue;
      const resolved = resolveSpecifier(root, m[3] ?? m[4] ?? m[5], file);
      if (resolved && !resolved.includes('node_modules')) stack.push(resolved);
    }
  }
  return new Set([...seen].map((f) => posix(path.relative(root, f))));
}
