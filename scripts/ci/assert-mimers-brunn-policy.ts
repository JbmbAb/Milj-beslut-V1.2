import fs from 'node:fs';
import path from 'node:path';

/**
 * Mimers Brunn architecture guard.
 *
 * New scripts/import modules must not introduce hardcoded legacy download roots.
 * Existing legacy scripts are kept in a baseline so the guard can be enabled
 * before the full data-pipeline migration is complete.
 */

const ROOT = process.cwd();
const IMPORT_ROOT = path.join(ROOT, 'scripts', 'import');

const LEGACY_BASELINE = new Set([
  'scripts/import/archive-lastkajen-split.ps1',
  'scripts/import/archive-product-raw.ps1',
  'scripts/import/cleanup-imported-raw.ps1',
  'scripts/import/convert-historiska-to-cog.ts',
  'scripts/import/convert-nmd-to-cog.ts',
  'scripts/import/data-disk-layout.ps1',
  'scripts/import/diagnose-system.ts',
  'scripts/import/discover-sgu-downloads.ts',
  'scripts/import/download-lantmateriet-ftp.ts',
  'scripts/import/download-lastkaj-rest.ts',
  'scripts/import/import-d-geodata-vectors.ts',
  'scripts/import/import-ingest-gpkg-batch.ts',
  'scripts/import/import-sgu-bulk.ts',
  'scripts/import/import-stability-mapping.ts',
  'scripts/import/inventory-data-disks.ps1',
  'scripts/import/run-import-focus.ps1',
  'scripts/import/run-import-session.ps1',
  'scripts/import/sguBulkImportEngine.ts',
]);

const CHECKED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.ps1']);

type Violation = {
  file: string;
  lineNumber: number;
  line: string;
  rule: string;
};

type Rule = {
  name: string;
  pattern: RegExp;
  isAllowedLine?: (line: string) => boolean;
};

const canonicalArchivePattern =
  /GEO_Master_Archive|GEO_MASTER_ARCHIVE|MIMERS_BRUNN|\/mnt\/geo_master_archive/i;

const rules: Rule[] = [
  {
    name: 'hardcoded D: drive import/download root',
    pattern: /\bD:\\+/i,
  },
  {
    name: 'hardcoded C:\\GEO PDF document root',
    pattern: /\bC:\\+GEO PDF\b/i,
  },
  {
    name: 'hardcoded H: path outside GEO_Master_Archive',
    pattern: /\bH:\\+/i,
    isAllowedLine: (line) => canonicalArchivePattern.test(line),
  },
];

function toRepoPath(file: string): string {
  return path.relative(ROOT, file).replace(/\\/g, '/');
}

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
      continue;
    }

    if (entry.isFile() && CHECKED_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

function scanFile(file: string): Violation[] {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  const violations: Violation[] = [];

  lines.forEach((line, index) => {
    for (const rule of rules) {
      if (!rule.pattern.test(line)) {
        continue;
      }

      if (rule.isAllowedLine?.(line)) {
        continue;
      }

      violations.push({
        file: toRepoPath(file),
        lineNumber: index + 1,
        line: line.trim(),
        rule: rule.name,
      });
    }
  });

  return violations;
}

const files = walk(IMPORT_ROOT);
const allViolations = files.flatMap(scanFile);

const newViolations = allViolations.filter((violation) => !LEGACY_BASELINE.has(violation.file));
const legacyViolations = allViolations.filter((violation) => LEGACY_BASELINE.has(violation.file));

if (newViolations.length > 0) {
  console.error('\nCI ARCHITECTURE GUARD FAILED: Mimers Brunn offline-first policy violation.');
  console.error(
    'New scripts/import modules must write through GEO_Master_Archive, not hardcoded D:/C:/legacy H: roots.\n',
  );

  for (const violation of newViolations) {
    console.error(`- ${violation.file}:${violation.lineNumber}`);
    console.error(`  Rule: ${violation.rule}`);
    console.error(`  Line: ${violation.line}\n`);
  }

  process.exit(2);
}

if (legacyViolations.length > 0) {
  const legacyFiles = new Set(legacyViolations.map((violation) => violation.file));
  console.warn(
    `Mimers Brunn guard: ${legacyViolations.length} legacy path references remain in ${legacyFiles.size} baseline import scripts.`,
  );
  console.warn('These are accepted as migration debt; do not copy them into new scripts.');
}

console.log('OK: Mimers Brunn policy enforced for new scripts/import modules.');
