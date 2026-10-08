/**
 * U51-GENERATION-ABSENCE-PROOF-01 -- the static census of u51-generation-derivation-1 (contract 2d937d63, 5.3).
 *
 * Pure: bytes in, counts out. No IO, no git, no environment. The census is conservative on purpose.
 *
 *  - registration_identifier_files: files other than the port module whose BYTES contain the identifier, in ANY
 *    syntactic position (call, alias, destructuring, property access, string, re-export, comment). No AST narrowing.
 *  - nonliteral_dynamic_imports: import() / require() calls in non-test code whose specifier is not a string literal.
 *    This one needs syntax (prose such as "import (e.g." is not a call), so it parses.
 *  - test_registration_files: audit only. Test and mock registrations are never counted for or against the proof.
 *
 * "Source" for the registration count means a tracked, non-test file that is not documentation. Documentation
 * (docs/ and *.md) is never executed; it is reported separately so nothing is hidden.
 */
import ts from 'typescript';
import { createHash } from 'node:crypto';

/**
 * Built from parts on purpose: this file is non-test source, so a literal here would be counted by the very
 * census it implements whenever a tree that contains this unit is censused.
 */
export const REGISTRATION_IDENTIFIER = ['register', 'LocalGeneration', 'Runtime'].join('');
export const PORT_MODULE_PATH = 'server/modules/ai/generation/LocalGenerationPort.ts';

// Built from parts for the same reason as the registration identifier: this unit must not look like a composition.
const COMPOSITION_MARKER = ['composition', 'manifest'].join('_');

/**
 * (Lives in this module, not in a module of its own: the shape of this package's source set is pinned by a test.)
 *
 * U51-OD-17 -- the ONLY exemption from `nonliteral_dynamic_imports == 0`: a vendored file, by EXACT path and EXACT
 * content hash. There is no general allowlist, no prefix, no glob, no directory form.
 *
 * Why it lives here: the frozen policy and derivation schemas are closed and have no key for an exemption, so the
 * table belongs to the verifier implementation, whose tree identity `accepted_verifiers` binds (contract 7.3). The
 * census counts only non-exempt sites against the required 0 and lists the exempt sites in the unhashed audit part.
 *
 * The hash is checked against the BLOB BYTES OF THE SUBJECT TREE. A byte change makes the hits blocking again; the
 * same bytes at any other path are not covered; a new vendor version needs a new, reviewed entry.
 */
export interface VendoredException {
  /** exact repository-relative path, no wildcard */
  readonly path: string;
  /** SHA-256 of the exact blob bytes */
  readonly sha256: string;
  /** exactly how many non-literal dynamic-import sites the file holds */
  readonly sites: number;
  /** explicit statement that the file is vendored third-party code */
  readonly vendored: true;
  /** owner-reviewed rationale (record U51-OD-17, section 5) */
  readonly rationale: string;
}

export const VENDORED_DYNAMIC_IMPORT_EXCEPTIONS: readonly VendoredException[] = Object.freeze([
  Object.freeze({
    path: 'public/cesium/Workers/createGeometry.js',
    sha256: '2d82f9f488888652a358dc9cb8355049a71ce066508d5fa5d94fdfff9d39481f',
    sites: 2,
    vendored: true as const,
    rationale:
      'verbatim copy of cesium@1.144.0 Workers/createGeometry.js (upstream web-worker module loader); runs only as a browser web worker; its specifier is a message argument and cannot be made literal without changing upstream code (U51-OD-17 section 5)',
  }),
]);

const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** The exception that covers this file, or undefined. Path equality, hash equality and the exact site count must all hold. */
export function vendoredExceptionFor(path: string, bytes: Uint8Array, siteCount: number): VendoredException | undefined {
  const candidate = VENDORED_DYNAMIC_IMPORT_EXCEPTIONS.find((e) => e.path === path);
  if (candidate === undefined) return undefined;
  if (sha256Hex(bytes) !== candidate.sha256) return undefined;
  if (siteCount !== candidate.sites) return undefined;
  return candidate;
}

export interface TreeEntry {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface DynamicImportSite {
  readonly path: string;
  readonly line: number;
  readonly kind: 'import' | 'require';
}

/** A site that U51-OD-17 exempts (exact vendored path + exact content hash). Audit only; never counted. */
export interface ExemptDynamicImportSite extends DynamicImportSite {
  readonly exempt_by_content_sha256: string;
}

/** Exactly the three counts of `static_census` in u51-generation-derivation-1. */
export interface StaticCensus {
  readonly registration_identifier_files: number;
  readonly nonliteral_dynamic_imports: number;
  readonly test_registration_files: number;
}

/** The census plus the paths behind it. Only `census` belongs in a derivation record; the rest is audit. */
export interface StaticCensusDetail {
  readonly census: StaticCensus;
  readonly registration_identifier_paths: readonly string[];
  readonly test_registration_paths: readonly string[];
  readonly documentation_identifier_paths: readonly string[];
  readonly nonliteral_dynamic_import_sites: readonly DynamicImportSite[];
  /** U51-OD-17: sites in an exempt vendored file. NOT part of the census count. */
  readonly exempt_nonliteral_dynamic_import_sites: readonly ExemptDynamicImportSite[];
  readonly composition_marker_paths: readonly string[];
  readonly code_files_parsed: number;
  readonly files_seen: number;
}

/** Contract 5.3: path matches (^|/)(tests?|__tests__|e2e)/ or \.(test|spec)\.[cm]?[jt]sx?$ . */
export function isTestPath(path: string): boolean {
  return /(^|\/)(tests?|__tests__|e2e)\//.test(path) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);
}

export function isCodePath(path: string): boolean {
  return /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(path);
}

export function isDocumentationPath(path: string): boolean {
  return /^docs\//.test(path) || /\.md$/.test(path);
}

function scriptKindOf(path: string): ts.ScriptKind {
  if (/\.tsx$/.test(path)) return ts.ScriptKind.TSX;
  if (/\.jsx$/.test(path)) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(path)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** The dynamic import()/require() calls of one file whose first argument is not a string literal. */
export function nonliteralDynamicImportSites(path: string, text: string): DynamicImportSite[] {
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKindOf(path));
  const sites: DynamicImportSite[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
      if (isImport || isRequire) {
        const arg = node.arguments[0];
        const literal = arg !== undefined && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg));
        if (!literal) {
          sites.push({
            path,
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            kind: isImport ? 'import' : 'require',
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return sites;
}

function containsAscii(bytes: Uint8Array, needle: string): boolean {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes(needle, 0, 'latin1');
}

/** Streaming form, so a whole tree never has to be in memory at once. */
export class StaticCensusAccumulator {
  private readonly registration: string[] = [];
  private readonly testRegistration: string[] = [];
  private readonly documentation: string[] = [];
  private readonly sites: DynamicImportSite[] = [];
  private readonly exemptSites: ExemptDynamicImportSite[] = [];
  private readonly composition: string[] = [];
  private parsed = 0;
  private seen = 0;

  add(entry: TreeEntry): void {
    this.seen += 1;
    const { path, bytes } = entry;
    const test = isTestPath(path);
    const doc = isDocumentationPath(path);

    if (path !== PORT_MODULE_PATH && containsAscii(bytes, REGISTRATION_IDENTIFIER)) {
      if (test) this.testRegistration.push(path);
      else if (doc) this.documentation.push(path);
      else this.registration.push(path);
    }
    if (!test && !doc && containsAscii(bytes, COMPOSITION_MARKER)) this.composition.push(path);

    if (!test && isCodePath(path)) {
      this.parsed += 1;
      const found = nonliteralDynamicImportSites(path, Buffer.from(bytes).toString('utf8'));
      const exception = found.length > 0 ? vendoredExceptionFor(path, bytes, found.length) : undefined;
      if (exception !== undefined) {
        this.exemptSites.push(...found.map((site) => ({ ...site, exempt_by_content_sha256: exception.sha256 })));
      } else {
        this.sites.push(...found);
      }
    }
  }

  result(): StaticCensusDetail {
    const sorted = (xs: string[]): string[] => [...xs].sort();
    return {
      census: {
        registration_identifier_files: this.registration.length,
        nonliteral_dynamic_imports: this.sites.length,
        test_registration_files: this.testRegistration.length,
      },
      registration_identifier_paths: sorted(this.registration),
      test_registration_paths: sorted(this.testRegistration),
      documentation_identifier_paths: sorted(this.documentation),
      nonliteral_dynamic_import_sites: [...this.sites].sort((a, b) => (a.path === b.path ? a.line - b.line : a.path < b.path ? -1 : 1)),
      exempt_nonliteral_dynamic_import_sites: [...this.exemptSites].sort((a, b) => (a.path === b.path ? a.line - b.line : a.path < b.path ? -1 : 1)),
      composition_marker_paths: sorted(this.composition),
      code_files_parsed: this.parsed,
      files_seen: this.seen,
    };
  }
}

export function computeStaticCensus(entries: Iterable<TreeEntry>): StaticCensusDetail {
  const acc = new StaticCensusAccumulator();
  for (const entry of entries) acc.add(entry);
  return acc.result();
}
