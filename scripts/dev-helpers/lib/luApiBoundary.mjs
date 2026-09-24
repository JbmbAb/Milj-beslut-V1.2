import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SNAPSHOT_PATH = 'packages/mps-lu/api-boundary.snapshot.json';
const PACKAGE_ROOT = 'packages/mps-lu/src/index.ts';
const PRODUCTION_ROOTS = ['src', 'server', 'components', 'services', 'packages', 'integrations'];
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'coverage',
  'tests',
  'test',
  '__tests__',
  'fixtures',
  '.claude',
  '.worktrees',
]);

const posix = (value) => value.split(sep).join('/');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function loadLuApiBoundarySnapshot(repoRoot = process.cwd()) {
  const snapshot = readJson(resolve(repoRoot, SNAPSHOT_PATH));
  if (snapshot?.schema_version !== 'mps-lu-api-boundary-v1') {
    throw new Error('unsupported LU API boundary snapshot');
  }
  if (!Array.isArray(snapshot.public_exports) || !Array.isArray(snapshot.grandfathered_deep_imports)) {
    throw new Error('invalid LU API boundary snapshot arrays');
  }
  return snapshot;
}

export function collectPublicExports(repoRoot = process.cwd()) {
  const configPath = resolve(repoRoot, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) {
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  }
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, repoRoot);
  const indexPath = resolve(repoRoot, PACKAGE_ROOT);
  const program = ts.createProgram([indexPath], parsed.options);
  const source =
    program.getSourceFile(indexPath) ??
    program.getSourceFiles().find((candidate) => resolve(candidate.fileName) === indexPath);
  if (!source) throw new Error('LU package root is not part of the TypeScript program');
  const checker = program.getTypeChecker();
  const symbol = checker.getSymbolAtLocation(source);
  if (!symbol) throw new Error('LU package root has no module symbol');
  return checker
    .getExportsOfModule(symbol)
    .map((item) => item.getName())
    .sort();
}

function shouldSkipDirectory(absPath, repoRoot) {
  const rel = posix(relative(repoRoot, absPath));
  if (rel === 'packages/mps-lu' || rel.startsWith('packages/mps-lu/')) return true;
  return SKIP_DIRS.has(absPath.split(sep).at(-1));
}

function collectCodeFiles(root, repoRoot, out) {
  if (!statSafe(root)?.isDirectory()) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const abs = join(root, entry.name);
    if (entry.isDirectory()) {
      if (!shouldSkipDirectory(abs, repoRoot)) collectCodeFiles(abs, repoRoot, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!CODE_EXTENSIONS.has(extname(entry.name))) continue;
    if (/\.(?:test|spec)\.[^.]+$/.test(entry.name)) continue;
    out.push(abs);
  }
}

function statSafe(path) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

export function isLuDeepImport(repoRoot, sourceFile, specifier) {
  if (specifier === '@miljobeslut/mps-lu') return false;
  if (specifier.startsWith('@miljobeslut/mps-lu/')) return true;
  if (!specifier.startsWith('.')) return false;
  const target = posix(relative(repoRoot, resolve(dirname(sourceFile), specifier)));
  return target === 'packages/mps-lu/src' || target.startsWith('packages/mps-lu/src/');
}

function collectModuleSpecifiers(sourceFile, sourceText) {
  const found = [];
  const source = ts.createSourceFile(sourceFile, sourceText, ts.ScriptTarget.Latest, true);
  const add = (node) => {
    if (node && ts.isStringLiteralLike(node)) found.push(node.text);
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      add(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node.moduleReference.expression);
    } else if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const first = node.arguments[0];
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) add(first);
      if (ts.isIdentifier(node.expression) && node.expression.text === 'require') add(first);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

export function collectProductionDeepImports(repoRoot = process.cwd()) {
  const files = [];
  for (const root of PRODUCTION_ROOTS) {
    collectCodeFiles(resolve(repoRoot, root), repoRoot, files);
  }
  const hits = [];
  for (const file of files) {
    const sourceText = readFileSync(file, 'utf8');
    for (const specifier of collectModuleSpecifiers(file, sourceText)) {
      if (!isLuDeepImport(repoRoot, file, specifier)) continue;
      hits.push({ file: posix(relative(repoRoot, file)), specifier });
    }
  }
  return hits.sort((a, b) => (a.file + '\0' + a.specifier).localeCompare(b.file + '\0' + b.specifier));
}

export function diffStringSets(expected, actual) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  return {
    added: actual.filter((value) => !expectedSet.has(value)),
    removed: expected.filter((value) => !actualSet.has(value)),
  };
}

const deepImportKey = (item) => item.file + '\0' + item.specifier;

export function evaluateLuApiBoundary(repoRoot = process.cwd()) {
  const snapshot = loadLuApiBoundarySnapshot(repoRoot);
  const publicExports = collectPublicExports(repoRoot);
  const deepImports = collectProductionDeepImports(repoRoot);
  const exportDiff = diffStringSets(snapshot.public_exports, publicExports);
  const deepDiff = diffStringSets(
    snapshot.grandfathered_deep_imports.map(deepImportKey),
    deepImports.map(deepImportKey),
  );
  const forbiddenExportsPresent = snapshot.forbidden_root_exports.filter((name) =>
    publicExports.includes(name),
  );
  const errors = [];
  if (exportDiff.added.length || exportDiff.removed.length) {
    errors.push({ code: 'LU_API_EXPORT_SNAPSHOT_DRIFT', ...exportDiff });
  }
  if (deepDiff.added.length || deepDiff.removed.length) {
    errors.push({ code: 'LU_API_DEEP_IMPORT_BASELINE_DRIFT', ...deepDiff });
  }
  if (forbiddenExportsPresent.length) {
    errors.push({ code: 'LU_API_FORBIDDEN_ROOT_EXPORT', names: forbiddenExportsPresent });
  }
  return {
    schema_version: 'mps-lu-api-boundary-report-v1',
    authoritative: false,
    package: snapshot.package,
    public_export_count: publicExports.length,
    grandfathered_deep_import_count: deepImports.length,
    forbidden_exports_present: forbiddenExportsPresent,
    export_diff: exportDiff,
    deep_import_diff: deepDiff,
    errors,
    result: errors.length === 0 ? 'PASS' : 'FAIL',
  };
}

const invokedAsScript = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsScript) {
  try {
    const report = evaluateLuApiBoundary(process.cwd());
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.result === 'PASS' ? 0 : 1;
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          schema_version: 'mps-lu-api-boundary-report-v1',
          authoritative: false,
          result: 'ERROR',
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
    process.exitCode = 2;
  }
}
