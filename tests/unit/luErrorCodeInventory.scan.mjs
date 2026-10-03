// W-M2e item 2 -- the scanner of the exhaustive error-code inventory (tests/unit/luErrorCodeInventory.test.ts).
//
// Plain ESM (no TypeScript) so the same code can be imported by the test and run by node to print the
// inventory -- one scanner, never two copies that drift. Reads source files as text; imports nothing
// from the product, touches no network, database or environment.
//
// W-UI1 (M2e verification finding 1: the inventory was not exhaustive) -- what is collected now, and why:
//  - every file of the LU reach is scanned, wherever it lives (C7: db.server.ts, src/infrastructure/...,
//    scripts/ops/... were in the reach but never scanned);
//  - the reach also starts at the middleware mounted in server/createApp.ts BEFORE the LU router (C8b:
//    csrf, the error handler, request logging, tracing) and at createApp.ts's own literals (its imports --
//    every router -- are not followed);
//  - in every file of the reach, EVERY code-shaped literal (A_B[_C...]) is collected, not only those with a
//    known prefix, suffix or carrier field (C3b, C9: a code pushed into a list, a neutral constant);
//  - in the LU core, single-word upper-case literals in value positions are collected too (C6:
//    `integrity: 'UNVERIFIABLE'`);
//  - a constant used as the value of a wire field (`code: SOME_CONST`) is resolved to its literal (C3b);
//  - code-shaped TEMPLATE literals in the reach (`ASSESSMENT_${kind}`) are reported separately: each one must
//    be listed with its expansions in the reviewed list, or the test fails (C5);
//  - the members of the `LuAssessmentStatus` union and values of `assessment_status` are marked, so the test
//    can require a STATUS label for them, not just any text (U20CDF4 verification L6.1).

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
 * W-UI1: middleware that server/createApp.ts mounts BEFORE `app.use(localizationRouter)` -- every LU request
 * passes it, so its answers (a CSRF 403, the error handler's mapping) can reach the LU UI. Its imports are
 * followed like an entry module's.
 */
export const LU_MIDDLEWARE_MODULES = Object.freeze([
  'server/security/csrf.ts',
  'server/security/secureErrors.ts',
  'server/security/requestLogging.ts',
  'server/observability/trace.ts',
]);

/** W-UI1: files whose OWN literals are in the reach, but whose imports (every router of the app) are not followed. */
export const LU_SHELL_MODULES = Object.freeze(['server/createApp.ts']);

/**
 * The LU core: here EVERY code-shaped literal and table key is collected (the reasons, states and
 * assurance values of the read-back are written as comparisons, call arguments and table keys too).
 */
const LU_CORE = /^(server\/modules\/localization\/|server\/routes\/(localization|property)\.routes\.ts$|src\/application\/(generate-localization-report\.usecase|resolveCanonicalProjectContext|resolveCurrentViewerIdentity)\.ts$)/;

/** W-UI1: union types whose members are presented as a STATUS label (U20CDF4 verification L6.1). */
export const LU_STATUS_UNIONS = Object.freeze(['LuAssessmentStatus']);

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
/** The wire fields whose value is a code, state or status the UI may present. */
const WIRE_FIELDS = 'code|failureClass|reasonCode|failure_class|reason_code|technical_error_class|coverage_state|errorCode|failureCode|reason|assessment_status';
const CARRIER = new RegExp(`\\b(${WIRE_FIELDS})\\??\\s*[:=]\\s*((?:['"\`][A-Z][A-Z0-9_]*[A-Z0-9]['"\`]\\s*\\|?\\s*)+)`, 'g');
/** W-UI1 (C3b): a wire field whose value is an identifier -- resolved through the constants below. */
const CARRIER_IDENT = new RegExp(`\\b(${WIRE_FIELDS}|integrity|status)\\??\\s*:\\s*([A-Za-z_$][\\w$]*)\\b(?!\\s*[(.\\[])`, 'g');
const CONST_DECL = /\b(export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*['"`]([A-Z][A-Z0-9_]*[A-Z0-9])['"`]/g;
const ARRAY_CARRIER = /\breason_codes\??\s*:\s*\[([^\]]*)\]/g;
const TYPE_UNION =
  /\btype\s+(\w*(?:FailureClass|ErrorClass|FaultReason|Reason|ReasonCode|CoverageState|Violation|ErrorCode|FailureCode))\s*(?:<[^>]*>)?\s*=\s*([^;]+);/g;
const STATUS_UNION = /\btype\s+(\w+)\s*(?:<[^>]*>)?\s*=\s*([^;]+);/g;
const LITERAL = /['"`]([A-Z][A-Z0-9_]*[A-Z0-9])['"`]/g;
const CORE_LITERAL = /['"`]([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)['"`]/g;
const CORE_KEY = /^\s*([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\s*:/gm;
/** W-UI1 (C6): a single upper-case word as a value (field value, comparison, argument, element, alternative). */
const CORE_WORD = /(?:\b\w+\??\s*:\s*|[!=]==?\s*|\(\s*|,\s*|\[\s*|\?\s*|\|\s*)['"]([A-Z][A-Z0-9]{2,})['"]/g;
/**
 * W-UI1 (C5): a code-shaped template literal -- upper-case/underscore text around one or more `${...}`, also one that
 * STARTS with an interpolation (`${kind}_READ_ERROR`); it must hold an upper-case word joined by an underscore.
 */
const CODE_TEMPLATE = /`((?:[A-Z][A-Z0-9_]*)?\$\{[^}`]+\}[A-Z0-9_]*(?:\$\{[^}`]+\}[A-Z0-9_]*)*)`/g;
/** Code-shaped LITERAL text of a template (read with every `${...}` emptied, so a constant's name inside one is no code). */
const CODE_SHAPED_PART = /[A-Z0-9]_[A-Z]|[A-Z]_\$\{|\}_[A-Z]/;
/** W-UI1: a code built by concatenation ('ASSESSMENT_' + kind, kind + '_READ_ERROR') -- reviewed like a template. */
const CODE_CONCAT = /(?:['"]([A-Z][A-Z0-9]*_[A-Z0-9_]*)['"]\s*\+\s*[A-Za-z_$][\w$.]*|[A-Za-z_$][\w$.()]*\s*\+\s*['"](_[A-Z][A-Z0-9_]*)['"])/g;

/**
 * W-UI1 (C5): the code-shaped templates and concatenations of one source text, as the inventory reviews them.
 * KNOWN LIMIT: a template whose code-shaped part lives only in a constant (`${PREFIX}${x}`) is not seen.
 */
export function codeTemplatesIn(source) {
  const found = [];
  for (const m of source.matchAll(CODE_TEMPLATE)) {
    if (CODE_SHAPED_PART.test(m[1].replace(/\$\{[^}`]+\}/g, '${}'))) found.push(m[1]);
  }
  for (const m of source.matchAll(CODE_CONCAT)) found.push(m[0].replace(/\s+/g, ' '));
  return found;
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
 * The static value-import closure (`import type` carries no runtime value) of LU_ENTRY_MODULES and
 * LU_MIDDLEWARE_MODULES, plus LU_SHELL_MODULES themselves: the only modules whose codes can reach an
 * answer the LU UI reads.
 * @returns {Set<string>} repo-relative posix paths
 */
export function luReachClosure(root) {
  const seen = new Set();
  const stack = [...LU_ENTRY_MODULES, ...LU_MIDDLEWARE_MODULES].map((m) => path.join(root, m));
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
  for (const shell of LU_SHELL_MODULES) seen.add(path.join(root, shell));
  return new Set([...seen].map((f) => posix(path.relative(root, f))));
}

/** The text inside the parentheses that open at `open` (balanced; strings are not special-cased). */
function balancedArgument(source, open) {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '(') depth += 1;
    else if (source[index] === ')') {
      depth -= 1;
      if (depth === 0) return { text: source.slice(open + 1, index), end: index };
    }
  }
  return { text: source.slice(open + 1), end: source.length };
}

/**
 * W-UI1-R2 (UI1-VERIFICATION finding 3a): what server/createApp.ts mounts BEFORE `app.use(localizationRouter)` --
 * every `app.use(...)`, by its callee (`inline` for a handler written in place) and the repository module that callee
 * is imported from (null for a third-party package or an inline handler). Every LU request passes all of them, so the
 * test pins this list: a new middleware fails until it is reviewed (scanned, or reviewed as unable to answer an LU
 * request), instead of being taken in only through a hand-kept LU_MIDDLEWARE_MODULES.
 * @returns {{ key: string, module: string | null }[]}
 */
export function appUsesBeforeLuRouter(root) {
  const file = path.join(root, 'server', 'createApp.ts');
  const source = stripComments(fs.readFileSync(file, 'utf8'));
  const end = source.indexOf('app.use(localizationRouter)');
  if (end < 0) throw new Error('app.use(localizationRouter) not found in server/createApp.ts');
  const importOf = new Map();
  for (const m of source.matchAll(/\bimport\s+(?!type\b)([\w$]+)?\s*,?\s*(?:\{([^}]*)\})?\s*from\s*['"]([^'"]+)['"]/g)) {
    const names = [m[1], ...(m[2] ?? '').split(',').map((part) => part.trim().split(/\s+as\s+/).pop())].filter(Boolean);
    for (const name of names) importOf.set(name, m[3]);
  }
  const uses = [];
  let at = source.indexOf('app.use(');
  while (at >= 0 && at < end) {
    const { text, end: close } = balancedArgument(source, at + 'app.use'.length);
    const callee = /^\s*([A-Za-z_$][\w$.]*)/.exec(text)?.[1] ?? null;
    const spec = callee ? importOf.get(callee.split('.')[0]) : undefined;
    const resolved = spec ? resolveSpecifier(root, spec, file) : null;
    uses.push({ key: callee ?? 'inline', module: resolved ? posix(path.relative(root, resolved)) : null });
    at = source.indexOf('app.use(', close);
  }
  return uses;
}

/**
 * W-UI1-R2 (UI1-VERIFICATION finding 3a): router-level middleware -- a `.use(` whose first argument is not a path
 * string -- in the repository modules mounted before the LU router: such a middleware runs for every request that
 * passes the router, also an LU one. Returned as `<module>: <callee>` for the test to pin.
 * @returns {string[]}
 */
export function routerLevelUsesBeforeLuRouter(root) {
  const out = [];
  for (const use of appUsesBeforeLuRouter(root)) {
    if (!use.module || use.module === 'server/createApp.ts') continue;
    const source = stripComments(fs.readFileSync(path.join(root, use.module), 'utf8'));
    for (const m of source.matchAll(/\b[A-Za-z_$][\w$]*\.use\(/g)) {
      const { text } = balancedArgument(source, m.index + m[0].length - 1);
      if (/^\s*['"`]/.test(text)) continue;
      const callee = /^\s*([A-Za-z_$][\w$.]*)/.exec(text)?.[1] ?? 'inline';
      out.push(`${use.module}: ${callee}`);
    }
  }
  return [...new Set(out)].sort();
}

/**
 * Scans server/, src/application/, packages/<pkg>/src and every file of the LU reach (non-test sources,
 * comments stripped).
 * @returns {{ tokens: Map<string, { files: Set<string>, how: Set<string> }>, files: string[], templates: { file: string, template: string }[] }}
 */
export function scanServerTokens(root) {
  const closure = luReachClosure(root);
  const absolute = [];
  walk(path.join(root, 'server'), absolute);
  walk(path.join(root, 'src', 'application'), absolute);
  for (const pkg of fs.readdirSync(path.join(root, 'packages'))) walk(path.join(root, 'packages', pkg, 'src'), absolute);
  const files = new Set(absolute.map((f) => posix(path.relative(root, f))));
  for (const reached of closure) files.add(reached);
  const tokens = new Map();
  const add = (token, file, how) => {
    let entry = tokens.get(token);
    if (!entry) tokens.set(token, (entry = { files: new Set(), how: new Set() }));
    entry.files.add(file);
    entry.how.add(how);
  };
  const sources = new Map();
  for (const rel of files) sources.set(rel, stripComments(fs.readFileSync(path.join(root, rel), 'utf8')));
  // Constants with a code-shaped value, by name (for `code: SOME_CONST`): an EXPORTED constant can be imported
  // anywhere; a local one counts only in its own file (a local `outcome` elsewhere is another variable).
  const exported = new Map();
  const local = new Map();
  const remember = (map, key, value) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(value);
  };
  for (const [rel, source] of sources) {
    for (const m of source.matchAll(CONST_DECL)) {
      if (m[1]) remember(exported, m[2], m[3]);
      remember(local, `${rel}\0${m[2]}`, m[3]);
    }
  }
  const constantsFor = (rel, name) => [...(exported.get(name) ?? []), ...(local.get(`${rel}\0${name}`) ?? [])];
  const templates = [];
  for (const [rel, source] of sources) {
    for (const [how, pattern] of PATTERNS) for (const m of source.matchAll(pattern)) add(m[1], rel, how);
    for (const m of source.matchAll(CARRIER)) for (const t of m[2].matchAll(LITERAL)) add(t[1], rel, `field:${m[1]}`);
    for (const m of source.matchAll(ARRAY_CARRIER)) for (const t of m[1].matchAll(LITERAL)) add(t[1], rel, 'field:reason_codes');
    for (const m of source.matchAll(TYPE_UNION)) for (const t of m[2].matchAll(LITERAL)) add(t[1], rel, `type:${m[1]}`);
    for (const m of source.matchAll(STATUS_UNION)) {
      if (LU_STATUS_UNIONS.includes(m[1])) for (const t of m[2].matchAll(LITERAL)) add(t[1], rel, `type:${m[1]}`);
    }
    if (LU_CORE.test(rel)) {
      for (const m of source.matchAll(CORE_LITERAL)) add(m[1], rel, 'lu-core');
      for (const m of source.matchAll(CORE_KEY)) add(m[1], rel, 'lu-core-key');
      for (const m of source.matchAll(CORE_WORD)) add(m[1], rel, 'lu-core-word');
    }
    if (closure.has(rel)) {
      for (const m of source.matchAll(CORE_LITERAL)) add(m[1], rel, 'reach-literal');
      for (const m of source.matchAll(CARRIER_IDENT)) {
        for (const value of constantsFor(rel, m[2])) add(value, rel, `field-const:${m[1]}`);
      }
      for (const template of codeTemplatesIn(source)) templates.push({ file: rel, template });
    }
  }
  return { tokens, files: [...files].sort(), templates };
}
