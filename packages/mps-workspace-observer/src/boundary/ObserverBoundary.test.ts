/**
 * WORKSPACE-LIFECYCLE-CONTROLLER-V1 — spec A2 / B1, Deliverable D item 1: the observer/classifier
 * boundary, enforced mechanically.
 *
 * Three mechanisms enforce the same rule, and they fail in different ways on purpose:
 *
 *   1. packages/mps-workspace-observer/package.json names no classifier, harness or policy
 *      dependency. Breaks the install graph — but only for a package a developer bothered to add;
 *      a deep relative import `../../mps-workspace-classifier/src/...` sails straight past it.
 *   2. eslint's no-restricted-imports rule for packages/mps-workspace-observer/**. Fires while the
 *      code is being written — and is switched off by one `// eslint-disable-next-line` comment.
 *   3. THIS FILE. A transitive import-graph walk plus a source scan. It reads what the files
 *      actually import, follows the edges through every workspace package it lands in, and cannot
 *      be silenced by a lint comment: the only way to make it pass is to not have the edge.
 *
 * Mechanisms 1 and 2 are cheap and local; this one is the one that has to be right. Without it a
 * policy import that arrives indirectly — the observer imports mps-canonical, mps-canonical starts
 * importing a policy package — is invisible to both of the others, and the snapshot silently stops
 * being a pure observation. That is the failure the whole three-layer design exists to prevent
 * (A2: derived fields only when their raw inputs sit in the same artifact; the boundary is at
 * policy LOADING).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
/** src/boundary → src → mps-workspace-observer → packages → repo root. */
const REPO_ROOT = resolvePath(HERE, '..', '..', '..', '..');
const OBSERVER_PKG = join(REPO_ROOT, 'packages', 'mps-workspace-observer');
const OBSERVER_SRC = join(OBSERVER_PKG, 'src');

const slash = (p: string): string => p.replace(/\\/g, '/');

/**
 * Three line-aligned views of one source file.
 *
 * `withoutComments` still contains string bodies and is what the import walk reads — an import
 * specifier IS a string literal. `codeOnly` has string bodies blanked and is where an identifier
 * ban must be applied. `stringsOnly` is the string bodies alone, and is where a decision VALUE
 * would hide.
 *
 * The split is the whole reason this test is usable. Every banned word already appears in prose in
 * this package: `disposition` in five doc comments and in three `justification:` strings of the
 * SnapshotDigest inclusion table, `severity` and `confidence` in the A24 paragraph of
 * snapshot/types.ts. A scan that failed on those would be deleted within a day, and the boundary
 * would go back to being enforced by two mechanisms a comment can switch off. What must not exist
 * is the identifier in code — and, separately, the decision constant in a string.
 */
interface SourceViews {
  readonly withoutComments: string;
  readonly codeOnly: string;
  readonly stringsOnly: string;
}

/**
 * A character scanner, not a regex.
 *
 * A regex cannot do this and the difference is load-bearing here: `ObservationLedger.ts` builds its
 * map key from a template literal containing a raw U+0000, and a naive `/\/\/.*$/` also eats the
 * `//` inside any string. Template-literal `${...}` expressions are kept as code, because an
 * identifier interpolated into a message is still an identifier. Newlines go to all three views so
 * a reported line number is the real one.
 */
function views(source: string): SourceViews {
  let all = '';
  let code = '';
  let strings = '';
  const emit = (ch: string, target: 'code' | 'str' | 'drop'): void => {
    if (ch === '\n') {
      all += '\n';
      code += '\n';
      strings += '\n';
      return;
    }
    if (target === 'drop') return;
    all += ch;
    if (target === 'code') code += ch;
    else strings += ch;
  };

  // A frame per nesting level. `braces` counts `{` inside a template expression so that the `}`
  // which closes the expression is told apart from the `}` of an object literal inside it.
  const stack: { kind: 'code' | 'quote' | 'template'; quote?: string; braces: number }[] = [
    { kind: 'code', braces: 0 },
  ];
  let i = 0;
  while (i < source.length) {
    const top = stack[stack.length - 1];
    const c = source[i];
    const d = source[i + 1];

    if (top.kind === 'code') {
      if (c === '/' && d === '/') {
        while (i < source.length && source[i] !== '\n') i += 1;
        continue;
      }
      if (c === '/' && d === '*') {
        i += 2;
        while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
          emit(source[i], 'drop');
          i += 1;
        }
        i += 2;
        continue;
      }
      if (c === "'" || c === '"') {
        stack.push({ kind: 'quote', quote: c, braces: 0 });
        emit(c, 'code');
        i += 1;
        continue;
      }
      if (c === '`') {
        stack.push({ kind: 'template', braces: 0 });
        emit(c, 'code');
        i += 1;
        continue;
      }
      if (c === '{') top.braces += 1;
      if (c === '}') {
        if (top.braces === 0 && stack.length > 1) {
          stack.pop();
          emit(c, 'code');
          i += 1;
          continue;
        }
        top.braces -= 1;
      }
      emit(c, 'code');
      i += 1;
      continue;
    }

    if (c === '\\') {
      emit(c, 'str');
      if (d !== undefined) emit(d, 'str');
      i += 2;
      continue;
    }
    if (top.kind === 'quote') {
      if (c === top.quote) {
        stack.pop();
        emit(c, 'code');
        i += 1;
        continue;
      }
      emit(c, 'str');
      i += 1;
      continue;
    }
    if (c === '`') {
      stack.pop();
      emit(c, 'code');
      i += 1;
      continue;
    }
    if (c === '$' && d === '{') {
      stack.push({ kind: 'code', braces: 0 });
      emit(c, 'code');
      emit(d, 'code');
      i += 2;
      continue;
    }
    emit(c, 'str');
    i += 1;
  }
  return { withoutComments: all, codeOnly: code, stringsOnly: strings };
}

/**
 * Every form that creates a module edge: static import, side-effect import, re-export, dynamic
 * import and require. A type-only edge counts: `export type { X } from '...'` still names the
 * module, and importing a policy TYPE is how the vocabulary gets in.
 */
const SPECIFIER_RE =
  /(?:^|[^.\w$])(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\sfrom\s*)?['"]([^'"]+)['"]|(?:^|[^.\w$])(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function specifiersOf(withoutComments: string): readonly string[] {
  const found = new Set<string>();
  for (const m of withoutComments.matchAll(SPECIFIER_RE)) {
    const spec = m[1] ?? m[2];
    if (spec !== undefined) found.add(spec);
  }
  return [...found];
}

function existingFile(candidate: string): string | null {
  try {
    return statSync(candidate).isFile() ? slash(candidate) : null;
  } catch {
    return null;
  }
}

function resolveModuleFile(base: string): string | null {
  return (
    existingFile(base) ??
    existingFile(`${base}.ts`) ??
    existingFile(`${base}.tsx`) ??
    existingFile(join(base, 'index.ts'))
  );
}

type Resolution =
  | { readonly kind: 'builtin'; readonly id: string }
  | { readonly kind: 'external'; readonly id: string }
  | { readonly kind: 'file'; readonly id: string }
  | { readonly kind: 'unresolved'; readonly id: string };

/**
 * Relative specifiers are rewritten `.js` → `.ts`: this repository writes ESM specifiers with the
 * emitted extension while the source on disk is TypeScript. A walk that took `./x.js` literally
 * would resolve nothing, the graph would collapse to a set of isolated roots, and every reachability
 * assertion below would pass vacuously. That is why `unresolved` is a hard failure rather than a
 * skipped edge.
 */
function resolveSpecifier(spec: string, fromFile: string): Resolution {
  if (spec.startsWith('node:')) return { kind: 'builtin', id: spec };
  if (spec.startsWith('.')) {
    const raw = resolvePath(dirname(fromFile), spec);
    const file = resolveModuleFile(raw.replace(/\.js$/, '.ts')) ?? resolveModuleFile(raw);
    return file === null ? { kind: 'unresolved', id: spec } : { kind: 'file', id: file };
  }
  if (spec.startsWith('@miljobeslut/')) {
    const pkg = spec.slice('@miljobeslut/'.length).split('/')[0];
    const file = resolveModuleFile(join(REPO_ROOT, 'packages', pkg, 'src', 'index.ts'));
    return file === null ? { kind: 'unresolved', id: spec } : { kind: 'file', id: file };
  }
  return { kind: 'external', id: spec };
}

function listSourceFiles(dir: string): readonly string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(p));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(slash(p));
  }
  return out;
}

interface Graph {
  readonly roots: readonly string[];
  readonly reachable: readonly string[];
  readonly edges: readonly { readonly from: string; readonly spec: string; readonly to: string }[];
  readonly unresolved: readonly string[];
  readonly externals: readonly string[];
}

function buildGraph(): Graph {
  const roots = listSourceFiles(OBSERVER_SRC);
  const reachable = new Set<string>();
  const edges: { from: string; spec: string; to: string }[] = [];
  const unresolved: string[] = [];
  const externals = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (reachable.has(file)) continue;
    reachable.add(file);
    for (const spec of specifiersOf(views(readFileSync(file, 'utf8')).withoutComments)) {
      const r = resolveSpecifier(spec, file);
      if (r.kind === 'unresolved') {
        unresolved.push(`${file} → ${spec}`);
        continue;
      }
      edges.push({ from: file, spec, to: r.id });
      if (r.kind === 'external') externals.add(r.id);
      if (r.kind === 'file') queue.push(r.id);
    }
  }
  return {
    roots,
    reachable: [...reachable].sort(),
    edges,
    unresolved,
    externals: [...externals].sort(),
  };
}

const graph = buildGraph();

/**
 * Packages the observer may never reach, transitively or otherwise.
 *
 * A data table rather than an if-chain because that is what it is: one row per forbidden
 * destination and the reason it is forbidden. The pattern row is what makes "or any policy package"
 * enforceable without an exhaustive list — a package created tomorrow named `mps-disposition-policy`
 * is caught by it on the first import, without anyone remembering to add it here.
 */
const FORBIDDEN_PACKAGES: readonly { readonly match: RegExp; readonly why: string }[] = Object.freeze([
  Object.freeze({
    match: /^mps-workspace-classifier$/,
    why: 'B1: the Classifier consumes the snapshot. An observer that imports it can see its own verdict.',
  }),
  Object.freeze({
    match: /^mps-workspace-harness$/,
    why: 'B4: the harness binds the acceptance authority. The observed subject may not import its judge.',
  }),
  Object.freeze({
    match: /policy|governance|classifier|disposition|adjudicat/i,
    why: 'A2: the boundary is at policy LOADING. Any policy package reached from here defeats it.',
  }),
]);

/** `.../packages/<name>/...` → `<name>`; null for a path outside packages/. */
function packageOf(file: string): string | null {
  const m = /\/packages\/([^/]+)\//.exec(file);
  return m === null ? null : m[1];
}

/**
 * Identifiers that must not appear in observer code.
 *
 * Each row takes a whole identifier token, never a substring of the file, because a substring match
 * on 'lease' also hits `released` and one on 'block' also hits `worktreeBlocks` — which is the
 * porcelain block structure R-G-03 actually returns and is entirely legitimate. A false positive
 * here gets the mechanism deleted, so every row says exactly which token shapes it rejects.
 */
const FORBIDDEN_IDENTIFIERS: readonly {
  readonly name: string;
  readonly test: (token: string) => boolean;
  readonly why: string;
}[] = Object.freeze([
  Object.freeze({
    name: 'disposition',
    test: (t: string) => /disposition/i.test(t),
    why: 'B1: the disposition is the Classifier’s output. The Observer has no vocabulary for it.',
  }),
  Object.freeze({
    name: 'SAFE_TO_REMOVE',
    test: (t: string) => /safe_?to_?remove/i.test(t),
    why: 'B1: a decision value. Emitting one from the observation layer is the boundary breach itself.',
  }),
  Object.freeze({
    name: 'BLOCKED as a decision value',
    // `BLOCKED`, `blocked`, `blockedBy`, `blocker`, `blockers` — but not `block`, `blocks`,
    // `worktreeBlocks` or `unblocked`, none of which is a verdict.
    test: (t: string) => /^block(ed|er)/i.test(t),
    why: 'B1: BLOCKED is a disposition. The Observer records UNKNOWN / NOT_ATTEMPTED, never a verdict.',
  }),
  Object.freeze({
    name: 'blockerScope',
    test: (t: string) => /blocker_?scope/i.test(t),
    why: 'A17: blocker scope is a classification concern; this surface records no scope at all.',
  }),
  Object.freeze({
    name: 'policyVersion',
    test: (t: string) => /policy_?version/i.test(t),
    why: 'A2: a policy version in the snapshot means policy was loaded to produce the snapshot.',
  }),
]);

/**
 * A24 forbids a second copy of a fact in a different vocabulary, and these two get added first:
 * both let a caller downgrade a hard observation into a soft one.
 */
const FORBIDDEN_ARTIFACT_FIELDS: readonly RegExp[] = Object.freeze([/^severity$/i, /^confidence$/i]);

/**
 * knownNonSources of the frozen command surface: at canonical base 0d7b2bd5 leases exist only in
 * memory (InMemoryLeaseRegistry, no leases section in the durable store) and no persisted
 * unit-state registry exists at all. A2/A16 forbid a snapshot field whose raw input is not in the
 * same artifact, so the Observer must emit no such field — not a null, not a default, not an
 * UNKNOWN placeholder. Absence is encoded by omission.
 */
const FORBIDDEN_UNOBSERVABLE_FIELDS: readonly {
  readonly name: string;
  readonly test: (token: string) => boolean;
}[] = Object.freeze([
  Object.freeze({
    // `lease`, `leases`, `leaseId`, `agentLease`, `LeaseRegistry` — but not `released` or `please`.
    name: 'lease',
    test: (t: string) => /^lease/i.test(t) || /Lease/.test(t),
  }),
  Object.freeze({
    name: 'unit state',
    test: (t: string) => /^unit_?state/i.test(t) || /UnitState/.test(t),
  }),
]);

/**
 * Decision constants that would hide inside a string literal rather than an identifier.
 *
 * Only SCREAMING_SNAKE tokens are considered, which is what separates the constant `'BLOCKED'` from
 * the English sentence "a workspace that stopped answering MUST invalidate a disposition" that the
 * SnapshotDigest inclusion table carries as a `justification:` value.
 */
const FORBIDDEN_STRING_VALUES: readonly RegExp[] = Object.freeze([
  /^BLOCKED/,
  /SAFE_TO_REMOVE/,
  /DISPOSITION/,
  /BLOCKER/,
  /POLICY_VERSION/,
]);

const IDENTIFIER_RE = /[A-Za-z_$][A-Za-z0-9_$]*/g;
const SCREAMING_RE = /[A-Z][A-Z0-9_]{2,}/g;

/** Line-by-line so a failure names the file and line to fix rather than just "something matched". */
function scan(
  files: readonly string[],
  view: keyof SourceViews,
  tokenRe: RegExp,
  reject: (token: string) => boolean,
): readonly string[] {
  const hits: string[] = [];
  for (const file of files) {
    const lines = views(readFileSync(file, 'utf8'))[view].split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      for (const m of lines[i].matchAll(new RegExp(tokenRe.source, 'g'))) {
        if (reject(m[0])) {
          hits.push(`${slash(file).replace(`${slash(REPO_ROOT)}/`, '')}:${i + 1} '${m[0]}'`);
        }
      }
    }
  }
  return hits;
}

const OBSERVER_FILES = listSourceFiles(OBSERVER_SRC);

describe('observer/classifier boundary (spec A2 / B1)', () => {
  it('walks a non-trivial transitive graph — a collapsed walk would prove nothing', () => {
    // Guard against a silently broken walk. If the .js → .ts rewrite or the specifier regex ever
    // breaks, every root becomes an island and the forbidden-package assertion passes vacuously.
    expect(graph.roots.length).toBeGreaterThanOrEqual(10);
    expect(graph.reachable.length).toBeGreaterThan(graph.roots.length);
    expect(graph.edges.length).toBeGreaterThan(graph.roots.length);
    // The walk must actually leave the package: mps-canonical is a declared dependency and its own
    // imports are followed, which is the only reason an INDIRECT policy import could be seen.
    expect(graph.reachable.some((f) => f.includes('/packages/mps-canonical/'))).toBe(true);
  });

  it('resolves every import specifier it finds', () => {
    // An unresolved edge is an unwalked edge, and an unwalked edge is where the breach would sit.
    expect(graph.unresolved).toEqual([]);
  });

  it('reaches no classifier, harness or policy package transitively', () => {
    const breaches: string[] = [];
    for (const file of graph.reachable) {
      const pkg = packageOf(file);
      if (pkg === null) continue;
      for (const rule of FORBIDDEN_PACKAGES) {
        if (rule.match.test(pkg)) breaches.push(`${file} (package ${pkg}) — ${rule.why}`);
      }
    }
    expect(breaches).toEqual([]);
  });

  it('names no classifier, harness or policy specifier in any import, even one that does not resolve', () => {
    // The graph test above only sees edges it could follow. This one reads the raw specifier text,
    // so a deep relative import into ../../mps-workspace-classifier/src is caught by its spelling
    // even if the target file were absent on this machine.
    const named = graph.edges
      .filter((e) => /mps-workspace-classifier|mps-workspace-harness|mps-policy/.test(e.spec))
      .map((e) => `${e.from} → ${e.spec}`);
    expect(named).toEqual([]);
  });

  it('declares no classifier, harness or policy dependency in package.json', () => {
    const pkg = JSON.parse(readFileSync(join(OBSERVER_PKG, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const declared = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
    ];
    expect(
      declared.filter((d) =>
        /mps-workspace-classifier|mps-workspace-harness|policy|governance|classifier/i.test(d),
      ),
    ).toEqual([]);
    // The file really was read and really does declare something, so a wrong path cannot make the
    // assertion above pass by producing an empty list.
    expect(Object.keys(pkg.dependencies ?? {})).toContain('@miljobeslut/mps-canonical');
  });

  it('uses no decision-vocabulary identifier in code', () => {
    const hits: string[] = [];
    for (const rule of FORBIDDEN_IDENTIFIERS) {
      for (const h of scan(OBSERVER_FILES, 'codeOnly', IDENTIFIER_RE, rule.test)) {
        hits.push(`${rule.name}: ${h} — ${rule.why}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('hides no decision constant inside a string literal', () => {
    expect(
      scan(OBSERVER_FILES, 'stringsOnly', SCREAMING_RE, (t) =>
        FORBIDDEN_STRING_VALUES.some((r) => r.test(t)),
      ),
    ).toEqual([]);
  });

  it('keeps the decision vocabulary out of CODE without banning it from PROSE', () => {
    // The three-view split, asserted directly. snapshot/types.ts documents A24 by naming `severity`
    // and `confidence`; SnapshotDigest.ts explains two inclusion decisions by naming `disposition`
    // in a justification string. If a future refactor replaced the scanner with a plain grep, this
    // test fails and says why — instead of the ban being quietly relaxed to keep the suite green.
    const types = views(readFileSync(join(OBSERVER_SRC, 'snapshot', 'types.ts'), 'utf8'));
    expect(types.withoutComments.length).toBeLessThan(
      readFileSync(join(OBSERVER_SRC, 'snapshot', 'types.ts'), 'utf8').length,
    );
    expect(readFileSync(join(OBSERVER_SRC, 'snapshot', 'types.ts'), 'utf8')).toContain('severity');
    expect(types.codeOnly).not.toMatch(/severity/i);
    expect(types.codeOnly).not.toMatch(/confidence/i);

    const digest = views(readFileSync(join(OBSERVER_SRC, 'snapshot', 'SnapshotDigest.ts'), 'utf8'));
    expect(digest.stringsOnly).toMatch(/disposition/i);
    expect(digest.codeOnly).not.toMatch(/disposition/i);
  });

  it('declares no severity or confidence field on any artifact type', () => {
    expect(
      scan(
        [
          join(OBSERVER_SRC, 'snapshot', 'types.ts'),
          join(OBSERVER_SRC, 'snapshot', 'SnapshotDigest.ts'),
        ],
        'codeOnly',
        IDENTIFIER_RE,
        (t) => FORBIDDEN_ARTIFACT_FIELDS.some((r) => r.test(t)),
      ),
    ).toEqual([]);
  });

  it('emits no lease field and no unit-state field anywhere in the package', () => {
    // Not a style rule. The frozen surface's knownNonSources record that neither fact is observable
    // at canonical base 0d7b2bd5, so either field would have no raw input in the artifact that
    // carries it (A2/A16), and the snapshot would assert something nothing observed.
    expect(
      scan(OBSERVER_FILES, 'codeOnly', IDENTIFIER_RE, (t) =>
        FORBIDDEN_UNOBSERVABLE_FIELDS.some((f) => f.test(t)),
      ),
    ).toEqual([]);
  });
});

/**
 * Negative controls.
 *
 * Every assertion above is of the form "this list is empty", and a list is also empty when the
 * mechanism that fills it is broken. These cases feed the same predicates and the same resolver a
 * breach that MUST be caught, so the green above means "no breach exists" rather than "nothing was
 * looked at". Without them, a typo in one regex silently disarms the only mechanism a lint comment
 * cannot switch off.
 */
describe('the boundary mechanism detects a breach', () => {
  const identifierRejected = (token: string): boolean =>
    FORBIDDEN_IDENTIFIERS.some((r) => r.test(token)) ||
    FORBIDDEN_UNOBSERVABLE_FIELDS.some((r) => r.test(token)) ||
    FORBIDDEN_ARTIFACT_FIELDS.some((r) => r.test(token));

  it.each([
    'disposition',
    'workspaceDisposition',
    'SAFE_TO_REMOVE',
    'safeToRemove',
    'blocked',
    'BLOCKED',
    'blockedBy',
    'blocker',
    'blockerScope',
    'policyVersion',
    'POLICY_VERSION',
    'severity',
    'confidence',
    'lease',
    'leaseId',
    'agentLease',
    'unitState',
    'UnitState',
  ])('rejects the identifier %s', (token) => {
    expect(identifierRejected(token)).toBe(true);
  });

  it.each([
    // The tokens the observer legitimately uses. A rule that also rejected these would be reverted,
    // and the boundary would go back to two mechanisms a comment can switch off.
    'block',
    'blocks',
    'worktreeBlocks',
    'WorktreeListBlock',
    'unblocked',
    'released',
    'please',
    'filesystemPolicy',
    'PathPolicy',
    'state',
    'unknownReason',
  ])('accepts the legitimate identifier %s', (token) => {
    expect(identifierRejected(token)).toBe(false);
  });

  it('finds a banned identifier that a comment-only stripper would have hidden', () => {
    const source = [
      '/** A comment mentioning disposition and severity, which is fine. */',
      "const label = 'the disposition is not ours to make';",
      'export interface X { readonly blockerScope: string; }',
      '',
    ].join('\n');
    const v = views(source);
    // Prose survives in the two views where prose belongs, and only line 3 is a real breach.
    expect(v.stringsOnly).toMatch(/disposition/);
    expect(v.codeOnly).not.toMatch(/severity/);
    const lines = v.codeOnly.split('\n');
    expect(lines.length).toBe(4);
    const hits = lines
      .flatMap((line, i) =>
        [...line.matchAll(IDENTIFIER_RE)].map((m) => ({ line: i + 1, token: m[0] })),
      )
      .filter((h) => identifierRejected(h.token));
    expect(hits).toEqual([{ line: 3, token: 'blockerScope' }]);
  });

  it('finds a decision constant hidden in a string literal', () => {
    const v = views("const verdict = 'SAFE_TO_REMOVE';\nconst other = 'BLOCKED_BY_UNCOMMITTED';\n");
    const hits = [...v.stringsOnly.matchAll(SCREAMING_RE)].filter((m) =>
      FORBIDDEN_STRING_VALUES.some((r) => r.test(m[0])),
    );
    expect(hits.map((m) => m[0])).toEqual(['SAFE_TO_REMOVE', 'BLOCKED_BY_UNCOMMITTED']);
  });

  it('resolves and rejects a deep relative import into the classifier package', () => {
    // The exact shape package.json and eslint both miss: a relative path that never names the
    // package as a dependency. It only fails if the resolver really walks it to a real file.
    const from = join(OBSERVER_SRC, 'observe', 'parsers.ts');
    const r = resolveSpecifier('../../../mps-workspace-classifier/src/index.js', slash(from));
    expect(r.kind).toBe('file');
    const pkg = packageOf(r.id);
    expect(pkg).toBe('mps-workspace-classifier');
    expect(FORBIDDEN_PACKAGES.some((p) => p.match.test(pkg as string))).toBe(true);
  });

  it.each(['mps-workspace-classifier', 'mps-workspace-harness', 'mps-policy', 'mps-disposition-policy'])(
    'treats %s as forbidden',
    (pkg) => {
      expect(FORBIDDEN_PACKAGES.some((p) => p.match.test(pkg))).toBe(true);
    },
  );

  it.each(['mps-workspace-observer', 'mps-canonical'])('leaves %s permitted', (pkg) => {
    expect(FORBIDDEN_PACKAGES.some((p) => p.match.test(pkg))).toBe(false);
  });
});
