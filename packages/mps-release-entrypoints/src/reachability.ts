import { builtinModules } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import type { TreeReader } from './types';

/**
 * Static import closure of a set of root files, read from ONE tree (for the proof: git objects of an exact commit).
 *
 * Followed edges: literal static imports and re-exports, `import x = require('..')`, literal dynamic `import('..')`,
 * literal `require('..')`, and `import('..')` type nodes (marked type-only). Resolution: relative paths with the
 * bundler/tsx extension rules, tsconfig `paths` (the best matching pattern, as TypeScript does), `baseUrl`, and
 * workspace packages (packages/<dir>/package.json name, `exports` map or `main`).
 *
 * FAIL CLOSED. Everything the resolver cannot classify with certainty becomes an entry in `unresolved`, and every
 * entry of `unresolved` is a BLOCKER: it is never treated as "not reachable". That covers: a non-literal import() or
 * require(), createRequire and import.meta.glob (computed resolution), a relative specifier or a path alias or a
 * workspace package that resolves to no file, a specifier form this resolver does not support, a file that is
 * referenced but not in the tree, a file that does not parse, and an unreadable tsconfig. A bare specifier to a package
 * that is neither a workspace package nor matched by a tsconfig alias is a third-party package: it is external, not part
 * of the tree, and is listed in `external_packages` so a reviewer can see exactly which names were classified so.
 *
 * Not modelled (and therefore not part of "reachable"): processes started by path (spawn, fork, new Worker), files
 * read at run time, and browser asset loading. The closure is the static module graph only.
 */

export type UnresolvedKind =
  | 'missing-root'
  | 'unreadable-file'
  | 'syntax-error'
  | 'nonliteral-dynamic-import'
  | 'nonliteral-require'
  | 'computed-resolution'
  | 'unresolved-relative'
  | 'unresolved-path-alias'
  | 'unresolved-workspace-package'
  | 'unsupported-specifier'
  | 'tsconfig-unreadable';

export interface Unresolved {
  readonly kind: UnresolvedKind;
  readonly from: string;
  readonly line: number;
  readonly specifier: string;
}

export interface ImportEdge {
  readonly specifier: string;
  readonly line: number;
  readonly typeOnly: boolean;
  readonly form: 'static' | 'export' | 'equals' | 'dynamic' | 'require' | 'type';
}

export interface NonLiteralHit {
  readonly file: string;
  readonly line: number;
  readonly form: 'import' | 'require';
  readonly text: string;
}

export interface ParsedModule {
  readonly edges: readonly ImportEdge[];
  readonly nonliteral: readonly NonLiteralHit[];
  readonly computed: ReadonlyArray<{ readonly line: number; readonly text: string }>;
  readonly syntaxErrors: number;
}

const CODE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'] as const;
const RESOLVE_EXTENSIONS = [...CODE_EXTENSIONS, '.json'] as const;
const SCRIPT_KIND: Record<string, ts.ScriptKind> = {
  '.ts': ts.ScriptKind.TS,
  '.mts': ts.ScriptKind.TS,
  '.cts': ts.ScriptKind.TS,
  '.tsx': ts.ScriptKind.TSX,
  '.js': ts.ScriptKind.JS,
  '.mjs': ts.ScriptKind.JS,
  '.cjs': ts.ScriptKind.JS,
  '.jsx': ts.ScriptKind.JSX,
};
const JS_TO_TS: Record<string, string[]> = { '.js': ['.ts', '.tsx'], '.jsx': ['.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'] };
const BUILTINS = new Set(builtinModules.flatMap((m) => [m, m.split('/')[0]!]));

export function isCodeFile(file: string): boolean {
  return (CODE_EXTENSIONS as readonly string[]).includes(path.posix.extname(file));
}

/** A path that is test code: under a tests or __tests__ directory, or named *.test.* / *.spec.* */
export function isTestPath(file: string): boolean {
  return /(^|\/)(tests?|__tests__)\//.test(file) || /\.(test|spec)\.[a-z]+$/.test(file);
}

// --------------------------------------------------------------------------------------------- parsing

export function parseModule(file: string, text: string): ParsedModule {
  const kind = SCRIPT_KIND[path.posix.extname(file)] ?? ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const edges: ImportEdge[] = [];
  const nonliteral: NonLiteralHit[] = [];
  const computed: Array<{ line: number; text: string }> = [];
  const handledCreateRequire = new Set<ts.Node>();
  const lineOf = (node: ts.Node): number => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const literalOf = (node: ts.Node | undefined): string | null =>
    node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;
  const clip = (s: string): string => (s.length > 120 ? `${s.slice(0, 117)}...` : s).replace(/\s+/g, ' ');

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const spec = literalOf(node.moduleSpecifier);
      const clause = node.importClause;
      const named = clause?.namedBindings;
      const typeOnly =
        clause !== undefined &&
        (clause.isTypeOnly || (clause.name === undefined && named !== undefined && ts.isNamedImports(named) && named.elements.length > 0 && named.elements.every((e) => e.isTypeOnly)));
      if (spec !== null) edges.push({ specifier: spec, line: lineOf(node), typeOnly, form: 'static' });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
      const spec = literalOf(node.moduleSpecifier);
      const clause = node.exportClause;
      const typeOnly = node.isTypeOnly || (clause !== undefined && ts.isNamedExports(clause) && clause.elements.length > 0 && clause.elements.every((e) => e.isTypeOnly));
      if (spec !== null) edges.push({ specifier: spec, line: lineOf(node), typeOnly, form: 'export' });
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const spec = literalOf(node.moduleReference.expression);
      if (spec !== null) edges.push({ specifier: spec, line: lineOf(node), typeOnly: node.isTypeOnly, form: 'equals' });
      else nonliteral.push({ file, line: lineOf(node), form: 'require', text: clip(node.moduleReference.expression.getText(sf)) });
    } else if (ts.isImportTypeNode(node)) {
      const arg = node.argument;
      const spec = ts.isLiteralTypeNode(arg) ? literalOf(arg.literal) : null;
      if (spec !== null) edges.push({ specifier: spec, line: lineOf(node), typeOnly: true, form: 'type' });
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      // `createRequire(import.meta.url)('x')`: a require relative to this very file, classifiable with certainty.
      // Any other use of createRequire (stored instance, other argument) stays a computed resolution below.
      const direct =
        ts.isCallExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === 'createRequire' &&
        callee.arguments.length === 1 &&
        callee.arguments[0]!.getText(sf) === 'import.meta.url';
      if (direct) handledCreateRequire.add(callee);
      const isRequire = direct || (ts.isIdentifier(callee) && callee.text === 'require');
      if (isImport || isRequire) {
        const spec = literalOf(node.arguments[0]);
        if (spec !== null && node.arguments.length >= 1) edges.push({ specifier: spec, line: lineOf(node), typeOnly: false, form: isImport ? 'dynamic' : 'require' });
        else nonliteral.push({ file, line: lineOf(node), form: isImport ? 'import' : 'require', text: clip(node.arguments[0]?.getText(sf) ?? '') });
      } else if (
        (ts.isIdentifier(callee) && callee.text === 'createRequire' && !handledCreateRequire.has(node)) ||
        (ts.isPropertyAccessExpression(callee) && (callee.name.text === 'createRequire' || /^import\.meta\.glob/.test(callee.getText(sf))))
      ) {
        computed.push({ line: lineOf(node), text: clip(callee.getText(sf)) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  const syntaxErrors = ((sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics ?? []).length;
  return { edges, nonliteral, computed, syntaxErrors };
}

// ------------------------------------------------------------------------------------------- resolution

type Resolution =
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'external'; readonly name: string }
  | { readonly kind: 'unresolved'; readonly why: UnresolvedKind };

interface PathPattern {
  readonly pattern: string;
  readonly prefix: string;
  readonly suffix: string;
  readonly star: boolean;
  readonly targets: readonly string[];
}

interface WorkspacePackage {
  readonly dir: string;
  readonly json: Record<string, unknown>;
}

export interface Resolver {
  resolve(from: string, specifier: string): Resolution;
  readonly configProblem: string | null;
}

function tryFile(tree: TreeReader, base: string): string | null {
  const ext = path.posix.extname(base);
  const candidates: string[] = [];
  if (JS_TO_TS[ext]) for (const t of JS_TO_TS[ext]!) candidates.push(base.slice(0, -ext.length) + t);
  if ((RESOLVE_EXTENSIONS as readonly string[]).includes(ext)) candidates.push(base);
  for (const e of RESOLVE_EXTENSIONS) candidates.push(base + e);
  for (const e of RESOLVE_EXTENSIONS) candidates.push(`${base}/index${e}`);
  for (const c of candidates) if (tree.has(c)) return c;
  return null;
}

function conditionTarget(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) for (const v of value) { const t = conditionTarget(v); if (t !== null) return t; }
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    for (const key of ['import', 'node', 'default', 'require', 'types']) if (key in obj) { const t = conditionTarget(obj[key]); if (t !== null) return t; }
  }
  return null;
}

function resolveWorkspace(tree: TreeReader, pkg: WorkspacePackage, subpath: string): string | null {
  const exportsField = pkg.json.exports;
  const join = (target: string): string => path.posix.normalize(`${pkg.dir}/${target.replace(/^\.\//, '')}`);
  if (exportsField !== undefined) {
    if (typeof exportsField === 'string' || Array.isArray(exportsField) || !Object.keys(exportsField as object).some((k) => k.startsWith('.'))) {
      if (subpath !== '') return null;
      const t = conditionTarget(exportsField);
      return t === null ? null : tryFile(tree, join(t));
    }
    const map = exportsField as Record<string, unknown>;
    const key = `.${subpath}`;
    if (key in map) {
      const t = conditionTarget(map[key]);
      return t === null ? null : tryFile(tree, join(t));
    }
    for (const k of Object.keys(map)) {
      const star = k.indexOf('*');
      if (star < 0) continue;
      const pre = k.slice(0, star);
      const post = k.slice(star + 1);
      if (key.startsWith(pre) && key.endsWith(post) && key.length >= pre.length + post.length) {
        const t = conditionTarget(map[k]);
        if (t === null) return null;
        return tryFile(tree, join(t.replace('*', key.slice(pre.length, key.length - post.length))));
      }
    }
    return null;
  }
  if (subpath === '') {
    for (const field of ['module', 'main', 'types']) {
      const v = pkg.json[field];
      if (typeof v === 'string') { const f = tryFile(tree, join(v)); if (f !== null) return f; }
    }
    return tryFile(tree, `${pkg.dir}/index`);
  }
  return tryFile(tree, `${pkg.dir}${subpath}`);
}

export function createResolver(tree: TreeReader): Resolver {
  let configProblem: string | null = null;
  const patterns: PathPattern[] = [];
  let baseDir = '';
  let hasBaseUrl = false;

  const tsconfigText = tree.read('tsconfig.json');
  if (tsconfigText === null) configProblem = 'tsconfig.json is not in the tree';
  else {
    const parsed = ts.parseConfigFileTextToJson('tsconfig.json', tsconfigText);
    if (parsed.error !== undefined || typeof parsed.config !== 'object' || parsed.config === null) configProblem = 'tsconfig.json cannot be parsed';
    else {
      const config = parsed.config as { extends?: unknown; compilerOptions?: { paths?: Record<string, string[]>; baseUrl?: string } };
      if (config.extends !== undefined) configProblem = 'tsconfig.json uses "extends", which this resolver does not follow';
      const options = config.compilerOptions ?? {};
      if (typeof options.baseUrl === 'string') {
        hasBaseUrl = true;
        baseDir = path.posix.normalize(options.baseUrl).replace(/^\.$/, '').replace(/^\.\//, '');
      }
      for (const [pattern, targets] of Object.entries(options.paths ?? {})) {
        const star = pattern.indexOf('*');
        patterns.push({ pattern, prefix: star < 0 ? pattern : pattern.slice(0, star), suffix: star < 0 ? '' : pattern.slice(star + 1), star: star >= 0, targets });
      }
    }
  }

  const workspace = new Map<string, WorkspacePackage>();
  for (const file of tree.listUnder('packages')) {
    const m = /^(packages\/[^/]+)\/package\.json$/.exec(file);
    if (!m) continue;
    const text = tree.read(file);
    if (text === null) continue;
    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      if (typeof json.name === 'string') workspace.set(json.name, { dir: m[1]!, json });
    } catch {
      configProblem ??= `${file} cannot be parsed`;
    }
  }

  const resolve = (from: string, rawSpecifier: string): Resolution => {
    const specifier = rawSpecifier.split(/[?#]/)[0]!;
    if (specifier === '') return { kind: 'unresolved', why: 'unsupported-specifier' };
    if (specifier.startsWith('node:')) return { kind: 'external', name: specifier };
    if (specifier === '.' || specifier === '..' || specifier.startsWith('./') || specifier.startsWith('../')) {
      const joined = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
      if (joined.startsWith('..')) return { kind: 'unresolved', why: 'unresolved-relative' };
      const found = tryFile(tree, joined);
      return found === null ? { kind: 'unresolved', why: 'unresolved-relative' } : { kind: 'file', path: found };
    }
    if (specifier.startsWith('/') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(specifier)) return { kind: 'unresolved', why: 'unsupported-specifier' };

    // tsconfig paths: the best (longest prefix) matching pattern, like TypeScript
    let best: PathPattern | null = null;
    for (const p of patterns) {
      const matches = p.star
        ? specifier.startsWith(p.prefix) && specifier.endsWith(p.suffix) && specifier.length >= p.prefix.length + p.suffix.length
        : specifier === p.pattern;
      if (matches && (best === null || p.prefix.length > best.prefix.length)) best = p;
    }
    if (best !== null) {
      const captured = best.star ? specifier.slice(best.prefix.length, specifier.length - best.suffix.length) : '';
      for (const target of best.targets) {
        const t = path.posix.normalize(path.posix.join(baseDir, target.replace('*', captured)));
        const found = tryFile(tree, t);
        if (found !== null) return { kind: 'file', path: found };
      }
      return { kind: 'unresolved', why: 'unresolved-path-alias' };
    }
    if (hasBaseUrl) {
      const found = tryFile(tree, path.posix.normalize(path.posix.join(baseDir, specifier)));
      if (found !== null) return { kind: 'file', path: found };
    }

    const segments = specifier.split('/');
    const name = specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]!;
    const subpath = specifier.slice(name.length);
    const pkg = workspace.get(name);
    if (pkg !== undefined) {
      const found = resolveWorkspace(tree, pkg, subpath);
      return found === null ? { kind: 'unresolved', why: 'unresolved-workspace-package' } : { kind: 'file', path: found };
    }
    if (name.startsWith('@miljobeslut/')) return { kind: 'unresolved', why: 'unresolved-workspace-package' };
    if (/^[@~#]\//.test(specifier) || specifier.startsWith('#')) return { kind: 'unresolved', why: 'unresolved-path-alias' };
    // a Node built-in or a third-party package: not part of the tree
    return { kind: 'external', name: BUILTINS.has(specifier) ? specifier : name };
  };
  return { resolve, configProblem };
}

// ----------------------------------------------------------------------------------------------- closure

export interface RootClosure {
  readonly root: string;
  /** every file reached by any literal edge (type-only edges included): the conservative closure */
  readonly files_all: readonly string[];
  /** files reached through edges that exist at run time (type-only edges excluded) */
  readonly files_value: readonly string[];
}

export interface ClosureResult {
  readonly roots: readonly string[];
  readonly per_root: readonly RootClosure[];
  readonly union_all: readonly string[];
  readonly union_value: readonly string[];
  readonly external_packages: readonly string[];
  /** Every entry is a blocker. */
  readonly unresolved: readonly Unresolved[];
  /** Non-literal import()/require() sites inside the union closure (also listed in `unresolved`). */
  readonly nonliteral_in_closure: readonly NonLiteralHit[];
}

const unresolvedKey = (u: Unresolved): string => `${u.kind}\0${u.from}\0${u.line}\0${u.specifier}`;

export function computeClosure(tree: TreeReader, roots: readonly string[]): ClosureResult {
  const resolver = createResolver(tree);
  const parsedCache = new Map<string, ParsedModule | null>();
  const unresolved = new Map<string, Unresolved>();
  const externals = new Set<string>();
  const nonliteral = new Map<string, NonLiteralHit>();
  const note = (u: Unresolved): void => { unresolved.set(unresolvedKey(u), u); };
  const sortedRoots = [...roots].sort();

  if (resolver.configProblem !== null) note({ kind: 'tsconfig-unreadable', from: 'tsconfig.json', line: 0, specifier: resolver.configProblem });

  const parsed = (file: string, importer: string, line: number): ParsedModule | null => {
    if (parsedCache.has(file)) return parsedCache.get(file)!;
    if (!isCodeFile(file)) {
      // a data/asset file (json, css, image ...) is a leaf: it must exist, its content is not parsed
      if (!tree.has(file)) note({ kind: 'unreadable-file', from: importer, line, specifier: file });
      parsedCache.set(file, null);
      return null;
    }
    const text = tree.read(file);
    let result: ParsedModule | null = null;
    if (text === null) note({ kind: 'unreadable-file', from: importer, line, specifier: file });
    else {
      result = parseModule(file, text);
      if (result.syntaxErrors > 0) note({ kind: 'syntax-error', from: file, line: 0, specifier: `${result.syntaxErrors} syntax diagnostics` });
      for (const hit of result.nonliteral) {
        nonliteral.set(`${hit.file}\0${hit.line}\0${hit.text}`, hit);
        note({ kind: hit.form === 'import' ? 'nonliteral-dynamic-import' : 'nonliteral-require', from: file, line: hit.line, specifier: hit.text });
      }
      for (const c of result.computed) note({ kind: 'computed-resolution', from: file, line: c.line, specifier: c.text });
    }
    parsedCache.set(file, result);
    return result;
  };

  const walk = (root: string, valueOnly: boolean): string[] => {
    if (!tree.has(root)) {
      note({ kind: 'missing-root', from: root, line: 0, specifier: root });
      return [];
    }
    const seen = new Set<string>([root]);
    let frontier = [root];
    while (frontier.length > 0) {
      tree.prefetch?.(frontier);
      const next: string[] = [];
      for (const file of frontier) {
        const module = parsed(file, file, 0);
        if (module === null) continue;
        for (const edge of module.edges) {
          if (valueOnly && edge.typeOnly) continue;
          const r = resolver.resolve(file, edge.specifier);
          if (r.kind === 'external') externals.add(r.name);
          else if (r.kind === 'unresolved') note({ kind: r.why, from: file, line: edge.line, specifier: edge.specifier });
          else if (!seen.has(r.path)) {
            seen.add(r.path);
            next.push(r.path);
            // a referenced file the tree cannot read is reported by parsed() when it is visited
          }
        }
      }
      frontier = next;
    }
    return [...seen].sort();
  };

  const perRoot: RootClosure[] = sortedRoots.map((root) => ({ root, files_all: walk(root, false), files_value: walk(root, true) }));
  const unionAll = [...new Set(perRoot.flatMap((r) => r.files_all))].sort();
  const unionValue = [...new Set(perRoot.flatMap((r) => r.files_value))].sort();
  return {
    roots: sortedRoots,
    per_root: perRoot,
    union_all: unionAll,
    union_value: unionValue,
    external_packages: [...externals].sort(),
    unresolved: [...unresolved.values()].sort((a, b) => (unresolvedKey(a) < unresolvedKey(b) ? -1 : 1)),
    nonliteral_in_closure: [...nonliteral.values()].sort((a, b) => (a.file + a.line < b.file + b.line ? -1 : 1)),
  };
}

// ------------------------------------------------------------------------------------------------ census

export interface CensusHit extends NonLiteralHit {
  readonly test: boolean;
  readonly in_union_closure: boolean;
  /** blocking = inside the production union closure; otherwise outside it (by reachability only, no allowlist) */
  readonly classification: 'blocking-in-production-closure' | 'outside-production-closure';
}

export interface Census {
  readonly code_files_parsed: number;
  readonly files_with_syntax_errors: number;
  readonly literal_edges: number;
  readonly nonliteral_total: number;
  readonly nonliteral_test: number;
  readonly nonliteral_non_test: number;
  readonly nonliteral_in_union_closure: number;
  readonly computed_resolution_total: number;
  readonly hits: readonly CensusHit[];
}

/** Whole-tree census of non-literal import()/require() calls, classified against a production union closure. */
export function censusTree(tree: TreeReader, unionClosure: readonly string[]): Census {
  const inClosure = new Set(unionClosure);
  const files = tree.listUnder('').filter(isCodeFile);
  const hits: CensusHit[] = [];
  let literalEdges = 0;
  let syntaxFiles = 0;
  let computedTotal = 0;
  const CHUNK = 200;
  for (let i = 0; i < files.length; i += CHUNK) {
    const chunk = files.slice(i, i + CHUNK);
    tree.prefetch?.(chunk);
    for (const file of chunk) {
      const text = tree.read(file);
      if (text === null) continue;
      const module = parseModule(file, text);
      literalEdges += module.edges.length;
      computedTotal += module.computed.length;
      if (module.syntaxErrors > 0) syntaxFiles += 1;
      for (const hit of module.nonliteral) {
        const inside = inClosure.has(file);
        hits.push({ ...hit, test: isTestPath(file), in_union_closure: inside, classification: inside ? 'blocking-in-production-closure' : 'outside-production-closure' });
      }
    }
  }
  hits.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
  return {
    code_files_parsed: files.length,
    files_with_syntax_errors: syntaxFiles,
    literal_edges: literalEdges,
    nonliteral_total: hits.length,
    nonliteral_test: hits.filter((h) => h.test).length,
    nonliteral_non_test: hits.filter((h) => !h.test).length,
    nonliteral_in_union_closure: hits.filter((h) => h.in_union_closure).length,
    computed_resolution_total: computedTotal,
    hits,
  };
}
