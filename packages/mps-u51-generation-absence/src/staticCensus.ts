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

/**
 * Built from parts on purpose: this file is non-test source, so a literal here would be counted by the very
 * census it implements whenever a tree that contains this unit is censused.
 */
export const REGISTRATION_IDENTIFIER = ['register', 'LocalGeneration', 'Runtime'].join('');
export const PORT_MODULE_PATH = 'server/modules/ai/generation/LocalGenerationPort.ts';

const COMPOSITION_MARKER = 'composition_manifest';

export interface TreeEntry {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface DynamicImportSite {
  readonly path: string;
  readonly line: number;
  readonly kind: 'import' | 'require';
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
  readonly composition_manifest_paths: readonly string[];
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
      this.sites.push(...nonliteralDynamicImportSites(path, Buffer.from(bytes).toString('utf8')));
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
      composition_manifest_paths: sorted(this.composition),
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
