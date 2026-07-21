/**
 * Export a curated, Drive-friendly context bundle for Gemini Enterprise.
 *
 * This is not a backup and not a replacement for Git. It copies the files that
 * help Gemini understand the platform, Mimers Brunn, PostGIS schema, import
 * pipelines and current gaps, while avoiding secrets, node_modules, storage
 * dumps, binary data and live PostgreSQL files.
 *
 * Run:
 *   node scripts/ops/export-gemini-context.mjs
 *   node scripts/ops/export-gemini-context.mjs --dry-run
 *   node scripts/ops/export-gemini-context.mjs --target "H:\...\Gemini_Enterprise_Context"
 */
import fs from 'fs';
import path from 'path';

const REPO_ROOT = process.cwd();
const DEFAULT_TARGET = 'H:\\Delade enheter\\Miljöbeslut\\Platform\\Gemini_Enterprise_Context';

const args = new Set(process.argv.slice(2));
const isDryRun = args.has('--dry-run');
const targetArgIndex = process.argv.indexOf('--target');
const targetRoot = targetArgIndex >= 0
  ? process.argv[targetArgIndex + 1]
  : DEFAULT_TARGET;

if (!targetRoot) {
  throw new Error('Missing value for --target');
}

const includeEntries = [
  'AGENTS.md',
  'GEMINI.md',
  'README.md',
  'package.json',
  'tsconfig.json',
  'vite.config.ts',
  'vitest.config.ts',
  'docker-compose.yml',
  'docker/postgres-dev/Dockerfile',
  'docs/architecture',
  'docs/migration/google-target-architecture.md',
  'docs/ops/gemini-enterprise-access.md',
  'docs/ops/postgis-docker-drift.md',
  'docs/ops/postgis_fastighet_pipeline.md',
  'knowledge-base',
  'prisma/schema.prisma',
  'prisma/spatial',
  'scripts/ci/assert-mimers-brunn-policy.ts',
  'scripts/data-pipeline',
  'scripts/db',
  'scripts/import',
  'scripts/ops/export-gemini-context.mjs',
  'server/modules',
  'server/routes',
  'server/services',
  'services',
  'tests/unit',
  'tests/integration',
];

const allowedExtensions = new Set([
  '.cjs',
  '.css',
  '.csv',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.prisma',
  '.ps1',
  '.py',
  '.sql',
  '.svg',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);

const blockedPathParts = new Set([
  '.git',
  '.quarantine',
  '.tmp',
  'dist',
  'node_modules',
  'playwright-report',
  'storage',
  'test-results',
]);

const blockedFileNames = new Set([
  '.env',
  '.env.local',
  '.env.production',
  '.env.test',
  'rclone.conf',
]);

const copied = [];
const skipped = [];

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function isBlocked(relativePath) {
  const parts = relativePath.split(/[\\/]/).filter(Boolean);
  if (parts.some((part) => blockedPathParts.has(part))) return true;
  return blockedFileNames.has(path.basename(relativePath));
}

function isAllowedFile(relativePath) {
  if (isBlocked(relativePath)) return false;
  return allowedExtensions.has(path.extname(relativePath).toLowerCase());
}

function copyFile(relativePath) {
  if (!isAllowedFile(relativePath)) {
    skipped.push({ path: toPosix(relativePath), reason: 'extension-or-policy' });
    return;
  }

  const sourcePath = path.join(REPO_ROOT, relativePath);
  const targetPath = path.join(targetRoot, relativePath);
  copied.push(toPosix(relativePath));

  if (isDryRun) return;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function walk(relativePath) {
  if (isBlocked(relativePath)) {
    skipped.push({ path: toPosix(relativePath), reason: 'blocked-path' });
    return;
  }

  const fullPath = path.join(REPO_ROOT, relativePath);
  if (!fs.existsSync(fullPath)) {
    skipped.push({ path: toPosix(relativePath), reason: 'missing' });
    return;
  }

  const stat = fs.statSync(fullPath);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(fullPath, { withFileTypes: true })) {
      walk(path.join(relativePath, entry.name));
    }
    return;
  }

  if (stat.isFile()) copyFile(relativePath);
}

function writeBundleFiles() {
  const generatedAt = new Date().toISOString();
  const manifest = {
    generatedAt,
    sourceRepo: REPO_ROOT,
    targetRoot,
    purpose: 'Curated context bundle for Gemini Enterprise. Git remains source of truth.',
    policy: {
      platformCode: 'Git is canonical. This Drive bundle is a readable mirror.',
      geodata: 'GEO_Master_Archive on Drive is canonical for raw geodata and manifests.',
      postgis: 'PostGIS is derived. Share schema/snapshots, never the live Docker volume.',
    },
    copiedCount: copied.length,
    skippedCount: skipped.length,
    copied,
    skipped,
  };

  if (isDryRun) return manifest;

  fs.mkdirSync(targetRoot, { recursive: true });
  fs.writeFileSync(
    path.join(targetRoot, 'gemini-context-manifest.json'),
    JSON.stringify(manifest, null, 2),
  );
  fs.writeFileSync(
    path.join(targetRoot, 'README.md'),
    [
      '# Gemini Enterprise Context Bundle',
      '',
      `Generated: ${generatedAt}`,
      '',
      'This folder is a curated, Drive-friendly mirror for Gemini Enterprise.',
      '',
      '## Rules',
      '',
      '- Git remains the source of truth for platform code.',
      '- `GEO_Master_Archive` remains the source of truth for raw geodata and manifests.',
      '- PostGIS is derived data. Do not sync `/var/lib/postgresql/data` or Docker volumes through Drive.',
      '- Secrets and environment files are intentionally excluded.',
      '',
      '## Start Here',
      '',
      '- `GEMINI.md`',
      '- `knowledge-base/README.md`',
      '- `docs/architecture/data-coverage-gaps.md`',
      '- `docs/ops/gemini-enterprise-access.md`',
      '- `gemini-context-manifest.json`',
      '',
    ].join('\n'),
  );
  return manifest;
}

for (const entry of includeEntries) {
  walk(entry);
}

const manifest = writeBundleFiles();

console.log(JSON.stringify({
  dryRun: isDryRun,
  targetRoot,
  copiedCount: manifest.copiedCount,
  skippedCount: manifest.skippedCount,
}, null, 2));
