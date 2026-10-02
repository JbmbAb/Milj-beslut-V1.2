/**
 * U30F F1 -- inventory of destructive paths against protected relations (owner decision 2026-10-02).
 *
 * Scans scripts/, packages/ and server/ (TypeScript/JavaScript, Python, PowerShell, shell, SQL) for
 * destructive operations -- DROP, TRUNCATE, DELETE, INSERT/UPDATE/MERGE/COPY into, rename,
 * CREATE OR REPLACE VIEW, ogr2ogr -overwrite/-append/-update/-upsert/OVERWRITE=YES -- in files
 * that reference a protected relation (every table in protected-relations.v1.json, the retained
 * staging schema, the import registry, or a directly imported module that does). Every such file
 * must be ONE of:
 *
 *   - the gate's own implementation (GATE_IMPLEMENTATION, fixed below);
 *   - GATED: it imports the protected relation gate (TS/JS: ProtectedRelationGate; Python:
 *     protected_relation_gate; PowerShell: ProtectedRelationGate.ps1) and calls it, and -- for
 *     TS/JS -- every ogr2ogr spawn and every destructive raw statement line is itself gated;
 *   - RETIRED: listed in RETIRED_DESTRUCTIVE_SCRIPTS (justification required, count pinned) and
 *     refusing before any connection;
 *   - SEPARATELY_GUARDED: the one test-database provisioner owned by the TEST-DB-GUARD lane.
 *
 * The canaries at the end prove the scan itself: a copy of the real tree plus one synthetic
 * violation (a new script, a new hardcoded relation, a Python and a PowerShell variant, a relation
 * newly added to the definition) FAILS, and so does a copy where a gate call is removed from an
 * existing path. Read-only: no database, no process other than the file scan.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { SPATIAL_LAYER_REGISTRY } from '../../packages/spatial-provider-postgis/src/SpatialLayerRegistry';
import {
  PROTECTED_RELATIONS,
  parseProtectedRelationsDefinition,
  type ProtectedRelationsDefinition,
} from '../../packages/spatial-provider-postgis/src/ProtectedRelations';
import {
  RETIRED_DESTRUCTIVE_SCRIPTS,
  validateRetiredDestructiveScripts,
} from '../../packages/spatial-provider-postgis/src/ProtectedRelationGate';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCOPE = ['scripts', 'packages', 'server'] as const;
const EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.py', '.sh', '.ps1', '.psm1', '.sql']);
/**
 * Test sources are outside this inventory: they run only against the disposable test database behind
 * TEST-DB-GUARD (W-TDG). Applied as one rule, never per file.
 */
const TEST_SOURCE = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/;

/** The gate itself (and its governed doors): they hold the destructive statements on purpose. */
const GATE_IMPLEMENTATION: readonly string[] = [
  'packages/spatial-provider-postgis/src/ProtectedRelationGate.ts',
  'packages/spatial-provider-postgis/src/ProtectedRelations.ts',
  'packages/spatial-provider-postgis/src/SpatialDatasetRetention.ts',
  'packages/spatial-provider-postgis/src/StagingCleanupProtection.ts',
];

/** Governed users of the gate's governed doors (retain-before-replace, per-relation staging decisions). */
const GOVERNED: readonly string[] = ['scripts/import/import-librarian-manifest.ts'];

/**
 * Guarded by a different mechanism. Each entry needs a justification and the marker of its guard. MAY
 * shrink; growing it is a reviewed change of this file.
 */
const SEPARATELY_GUARDED: readonly { readonly file: string; readonly marker: RegExp; readonly justification: string }[] = [
  {
    file: 'scripts/db/provision-spatial-test-db.ts',
    marker: /assertDisposableGisTestDatabase/,
    justification:
      'Provisions the disposable GIS test database (INSERT/DELETE of a probe row in env.sgu_well there). It refuses any ' +
      'target that is not the configured test database (assertDisposableGisTestDatabase, TEST-DB-GUARD lane W-TDG).',
  },
];

/** Pinned: the retired list MAY shrink, and growing it is a reviewed change of this number (U30F F1). */
const RETIRED_COUNT = 13;

// ---------------------------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------------------------

const SQL_DESTRUCTIVE = [
  /\bTRUNCATE\b/i,
  /\bDROP\s+(?:TABLE|VIEW|MATERIALIZED\s+VIEW|SCHEMA|FOREIGN\s+TABLE)\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bCREATE\s+OR\s+REPLACE\s+(?:TEMP(?:ORARY)?\s+)?(?:RECURSIVE\s+)?VIEW\b/i,
  /\bALTER\s+(?:TABLE|VIEW|MATERIALIZED\s+VIEW|FOREIGN\s+TABLE)\b[^;]*\bRENAME\b/i,
  /\bINSERT\s+INTO\b/i,
  /(?<!\bDO\s)\bUPDATE\s+[\w."]+\s+SET\b/i,
  /\bMERGE\s+INTO\b/i,
  /\bCOPY\s+[\w."]+[^;]*\bFROM\b/i,
  /\bDropGeometryTable\s*\(/i,
];
const OGR_WRITE = [/(^|['"\s,[])-overwrite\b/i, /(^|['"\s,[])-append\b/i, /(^|['"\s,[])-update\b/i, /(^|['"\s,[])-upsert\b/i, /OVERWRITE=YES/i];
const MENTIONS_OGR = /ogr2ogr|OGR2OGR|\bOGR\b/;

type Lang = 'ts' | 'py' | 'ps' | 'sh' | 'sql';
function languageOf(file: string): Lang {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.py') return 'py';
  if (ext === '.ps1' || ext === '.psm1') return 'ps';
  if (ext === '.sh') return 'sh';
  if (ext === '.sql') return 'sql';
  return 'ts';
}

/** Source lines without comments (heuristic per language; strings are kept). */
function codeLines(text: string, lang: Lang): string[] {
  let t = text;
  if (lang === 'ts' || lang === 'sql') t = t.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  if (lang === 'ps') t = t.replace(/<#[\s\S]*?#>/g, (m) => m.replace(/[^\n]/g, ' '));
  return t.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (lang === 'ts' && trimmed.startsWith('//')) return '';
    if ((lang === 'py' || lang === 'ps' || lang === 'sh') && trimmed.startsWith('#')) return '';
    if (lang === 'sql' && trimmed.startsWith('--')) return '';
    return line;
  });
}

function protectedNamePattern(definition: ProtectedRelationsDefinition): RegExp {
  const names = [...new Set([...definition.relations.map((r) => r.table), ...definition.retained_staging_schemas])];
  return new RegExp(`\\b(?:${names.join('|')})\\b|getRegistryEntry|IMPORT_REGISTRY`);
}

function collectFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'build' || e.name === 'coverage' || e.name.startsWith('.')) continue;
      const child = path.join(dir, e.name);
      if (e.isDirectory()) walk(child);
      else if (EXTENSIONS.has(path.extname(e.name).toLowerCase())) {
        const rel = path.relative(root, child).split(path.sep).join('/');
        if (!TEST_SOURCE.test(rel)) found.push(rel);
      }
    }
  };
  for (const dir of SCOPE) walk(path.join(root, dir));
  return found.sort();
}

function relativeImports(root: string, file: string, text: string): string[] {
  const specs = [...text.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => m[1]!);
  const out: string[] = [];
  for (const spec of specs) {
    const base = path.resolve(root, path.dirname(file), spec);
    for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, path.join(base, 'index.ts'), base.replace(/\.js$/, '.ts')]) {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) {
        out.push(c);
        break;
      }
    }
  }
  return out;
}

const TS_GATE_IMPORT = /(?:from|import\()\s*['"][^'"]*ProtectedRelationGate['"]/;
const TS_GATE_CALL = /\b(?:assertSqlWriteAllowed|gatedSql|assertOgr2ogrWriteAllowed|assertOgr2ogrCommandAllowed|assertUngovernedDestructiveWriteAllowed|assertSanctionedDerivedRebuild)\s*\(/;
const TS_GOVERNED_CALL = /\b(?:retainOutgoingThenReplace|dropStagingRelationGoverned|assertStagingImportOverwriteAllowed|planStagingCleanup)\s*\(/;
const PY_GATE = /^\s*(?:from\s+protected_relation_gate\s+import|import\s+protected_relation_gate)\b/m;
const PY_GATE_CALL = /\bassert_ungoverned_write_allowed\s*\(/;
const PS_GATE = /ProtectedRelationGate\.ps1/;
const PS_GATE_CALL = /\bAssert-UngovernedWriteAllowed\b/;

export interface InventoryFinding {
  readonly file: string;
  readonly problem: string;
}

interface ScanOptions {
  readonly definition?: ProtectedRelationsDefinition;
  readonly retired?: readonly string[];
}

/** Every destructive path against a protected relation that is not gated, retired or listed. */
function scanInventory(root: string, options: ScanOptions = {}): { findings: InventoryFinding[]; destructive: string[] } {
  const definition = options.definition ?? PROTECTED_RELATIONS;
  const retired = new Set(options.retired ?? RETIRED_DESTRUCTIVE_SCRIPTS.map((r) => r.script));
  const names = protectedNamePattern(definition);
  const findings: InventoryFinding[] = [];
  const destructive: string[] = [];
  for (const file of collectFiles(root)) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const lang = languageOf(file);
    const lines = codeLines(text, lang);
    const code = lines.join('\n');
    const ogr = MENTIONS_OGR.test(code);
    const hasDestructive = lines.some((l) => SQL_DESTRUCTIVE.some((re) => re.test(l)) || (ogr && OGR_WRITE.some((re) => re.test(l))));
    if (!hasDestructive) continue;
    const associated =
      names.test(code) || (lang === 'ts' && relativeImports(root, file, text).some((m) => names.test(fs.readFileSync(m, 'utf8'))));
    if (!associated) continue;
    destructive.push(file);

    if (GATE_IMPLEMENTATION.includes(file)) continue;
    const guarded = SEPARATELY_GUARDED.find((g) => g.file === file);
    if (guarded) {
      if (!guarded.marker.test(code)) findings.push({ file, problem: `listed as separately guarded but ${guarded.marker} is gone` });
      continue;
    }
    if (retired.has(file)) {
      if (lang === 'sql') {
        const first = lines.map((l) => l.trim()).filter((l) => l.length > 0);
        if (first[0] !== '\\set ON_ERROR_STOP on' || !first[1]?.startsWith(`DO $$ BEGIN RAISE EXCEPTION 'REJECT_RETIRED_DESTRUCTIVE_SCRIPT: ${file}`)) {
          findings.push({ file, problem: 'retired SQL without the refusal header' });
        }
      } else {
        const refusal = code.indexOf(`refuseRetiredDestructiveScript('${file}')`);
        const firstUse = code.search(/new PrismaClient\(|\$executeRaw|\$queryRaw|\bspawn(?:Sync)?\(|\bexec(?:File)?Sync\(|\.query\(|\bmain\(\)|\bverify\(\)|\brunBenchmark\(\)/);
        if (refusal < 0 || (firstUse >= 0 && firstUse < refusal)) findings.push({ file, problem: 'retired but not refused before its first database or process call' });
      }
      continue;
    }
    if (lang === 'sql' || lang === 'sh') {
      findings.push({ file, problem: `${lang} cannot call the gate: retire it (RETIRED_DESTRUCTIVE_SCRIPTS) or move the operation into a gated script` });
      continue;
    }
    if (lang === 'py') {
      if (!PY_GATE.test(code) || !PY_GATE_CALL.test(code)) findings.push({ file, problem: 'destructive path without protected_relation_gate' });
      continue;
    }
    if (lang === 'ps') {
      if (!PS_GATE.test(code) || !PS_GATE_CALL.test(code)) findings.push({ file, problem: 'destructive path without ProtectedRelationGate.ps1' });
      continue;
    }
    // TS/JS
    if (!TS_GATE_IMPORT.test(code)) {
      findings.push({ file, problem: 'destructive path that does not import ProtectedRelationGate' });
      continue;
    }
    if (GOVERNED.includes(file)) {
      if (!TS_GOVERNED_CALL.test(code)) findings.push({ file, problem: 'governed path without a governed gate call' });
      continue;
    }
    if (!TS_GATE_CALL.test(code)) {
      findings.push({ file, problem: 'imports the gate but never calls it' });
      continue;
    }
    // Every call site: an ogr2ogr process and a destructive raw statement must be gated where they are made.
    lines.forEach((line, i) => {
      const spawnsOgr = /\b(?:spawn|spawnSync|execSync|execFileSync)\s*\(/.test(line) && /OGR2OGR|ogr2ogr|ogrCmd|cmd\b|args\b|pgArgs/.test(line);
      const nearbyGate = lines.slice(Math.max(0, i - 2), i + 1).some((l) => /assertOgr2ogr(?:Write|Command)Allowed\s*\(/.test(l));
      const multiLineCall = /\(\s*$/.test(line) && lines.slice(i + 1, i + 4).some((l) => /assertOgr2ogr(?:Write|Command)Allowed\s*\(/.test(l));
      if (ogr && spawnsOgr && !nearbyGate && !multiLineCall && !/OGRINFO|ogrinfo|'powershell'|'docker'/.test(line)) {
        findings.push({ file, problem: `line ${i + 1}: ogr2ogr process not gated: ${line.trim().slice(0, 100)}` });
      }
      const rawWrite = /\$executeRawUnsafe\s*\(|\$executeRaw`/.test(line) && SQL_DESTRUCTIVE.some((re) => re.test(line));
      if (rawWrite && !/\bgatedSql\s*\(/.test(line)) findings.push({ file, problem: `line ${i + 1}: destructive statement not gated: ${line.trim().slice(0, 100)}` });
    });
  }
  return { findings, destructive };
}

// ---------------------------------------------------------------------------------------------
// The repository
// ---------------------------------------------------------------------------------------------

describe('protected relation gate inventory (U30F F1)', () => {
  const result = scanInventory(REPO_ROOT);

  it('the scan sees the repository (it cannot pass vacuously)', () => {
    expect(fs.existsSync(path.join(REPO_ROOT, 'scripts', 'import', 'import-librarian-manifest.ts'))).toBe(true);
    expect(result.destructive.length).toBeGreaterThan(30);
    expect(result.destructive).toEqual(
      expect.arrayContaining([
        'packages/spatial-provider-postgis/src/ProtectedRelationGate.ts',
        'packages/spatial-provider-postgis/src/SpatialDatasetRetention.ts',
        'packages/spatial-provider-postgis/src/StagingCleanupProtection.ts',
        ...GOVERNED,
        'scripts/db/drop-staging-tables.ts',
        'scripts/import/sguBulkImportEngine.ts',
        'scripts/data-pipeline/import_all_datasets.py',
        'scripts/import/sanitize-postgis-failed-imports.ps1',
      ]),
    );
  });

  it('every destructive path against a protected relation goes through the gate, is retired, or is listed', () => {
    expect(result.findings).toEqual([]);
  });

  it('the retired list is pinned, justified, and every entry refuses', () => {
    expect(RETIRED_DESTRUCTIVE_SCRIPTS.length).toBe(RETIRED_COUNT);
    for (const entry of RETIRED_DESTRUCTIVE_SCRIPTS) {
      expect(fs.existsSync(path.join(REPO_ROOT, entry.script)), entry.script).toBe(true);
      expect(entry.justification.trim().length, entry.script).toBeGreaterThanOrEqual(40);
      expect(result.destructive, entry.script).toContain(entry.script);
    }
    expect(() =>
      validateRetiredDestructiveScripts([
        { script: 'scripts/x.ts', protected_relations: ['env.sgu_well'], justification: 'too short', replacement: 'x', retired_by: 'x' },
      ]),
    ).toThrow(/needs a justification/);
  });

  it('no script refuses itself without being on the retired list', () => {
    const listed = new Set(RETIRED_DESTRUCTIVE_SCRIPTS.map((r) => r.script));
    for (const file of collectFiles(REPO_ROOT)) {
      const text = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
      const m = text.match(/refuseRetiredDestructiveScript\('([^']+)'\)/);
      if (m && !GATE_IMPLEMENTATION.includes(file)) {
        expect(m[1], file).toBe(file);
        expect(listed.has(file), file).toBe(true);
      }
    }
  });

  it('every separately guarded entry is justified', () => {
    for (const g of SEPARATELY_GUARDED) expect(g.justification.length, g.file).toBeGreaterThanOrEqual(40);
  });

  it('the definition covers every SpatialLayerRegistry table and every ADMIT-V1 PostGIS target', () => {
    const relations = new Set(PROTECTED_RELATIONS.relations.map((r) => r.relation));
    for (const binding of Object.values(SPATIAL_LAYER_REGISTRY)) expect(relations.has(binding.table), binding.table).toBe(true);
    const contracts = fs.readFileSync(path.join(REPO_ROOT, 'docs/architecture/admit-v1/LAYER-ID-CONTRACTS-V1.md'), 'utf8');
    const admitted = contracts
      .split(/\r?\n/)
      .filter((l) => /^\| `lu\.[a-z_]+` \|/.test(l) && l.split('|').length >= 12) // the ADMIT contracts table rows
      .flatMap((l) => [...l.split('|')[10]!.matchAll(/`([a-z_]+\.[a-z_0-9]+)`/g)].map((m) => m[1]!));
    expect(admitted.length).toBeGreaterThanOrEqual(11);
    for (const target of admitted) expect(relations.has(target), target).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Canaries: the scan fails on a synthetic violation in a copy of the tree
// ---------------------------------------------------------------------------------------------

describe('canaries: the inventory FAILS on a new ungated destructive path', () => {
  // ONE copy of the scanned tree; every canary adds or changes one file and undoes it afterwards.
  let copy: string | null = null;
  afterAll(() => {
    if (copy) fs.rmSync(copy, { recursive: true, force: true });
  }, 120_000);

  function copyOfTree(): string {
    if (copy) return copy;
    copy = fs.mkdtempSync(path.join(os.tmpdir(), 'wu30f-inventory-'));
    for (const file of collectFiles(REPO_ROOT)) {
      const target = path.join(copy, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(REPO_ROOT, file), target);
    }
    return copy;
  }

  const added: string[] = [];
  const changed = new Map<string, string>();
  afterEach(() => {
    if (!copy) return;
    for (const file of added.splice(0)) fs.rmSync(path.join(copy, file), { force: true });
    for (const [file, original] of changed) fs.writeFileSync(path.join(copy, file), original, 'utf8');
    changed.clear();
  });

  function addFile(root: string, file: string, content: string): void {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content, 'utf8');
    added.push(file);
  }

  it('the copy of the real tree is clean (the canaries below fail only because of what they add)', () => {
    expect(scanInventory(copyOfTree()).findings).toEqual([]);
  });

  it.each([
    [
      'a new script that truncates an LU layer',
      'scripts/rogue/truncate-wells.ts',
      "import { PrismaClient } from '@prisma/client';\nconst p = new PrismaClient();\nawait p.$executeRawUnsafe('TRUNCATE TABLE env.sgu_well CASCADE');\n",
    ],
    [
      'a new hardcoded retained relation dropped',
      'scripts/rogue/drop-retained.ts',
      "import { PrismaClient } from '@prisma/client';\nconst p = new PrismaClient();\nawait p.$executeRawUnsafe('DROP TABLE IF EXISTS \"lm_staging\".\"natura2000_area_deadbeef\"');\n",
    ],
    [
      'an ogr2ogr -overwrite into an LU layer',
      'scripts/rogue/overwrite-ebh.ts',
      "import { spawnSync } from 'child_process';\nspawnSync('ogr2ogr', ['-f', 'PostgreSQL', 'PG:dbname=x', 'a.gpkg', '-nln', 'env.ebh_potentiellt_fororenade_omraden', '-overwrite']);\n",
    ],
    [
      'a Python importer appending to natura2000',
      'scripts/data-pipeline/rogue_natura.py',
      "import subprocess\nsubprocess.run(['ogr2ogr', '-f', 'PostgreSQL', 'PG:x', 'a.shp', '-nln', 'env.natura2000_area', '-append'])\n",
    ],
    ['a PowerShell sweep dropping protected areas', 'scripts/rogue/sweep.ps1', "psql -c 'DROP TABLE env.protected_area CASCADE;'\n"],
    ['a SQL migration redefining the property root', 'scripts/db/rogue.sql', 'CREATE OR REPLACE VIEW core.property_unit AS SELECT 1;\n'],
    [
      'a server module deleting from the derived property table',
      'server/rogue/propertyCleanup.ts',
      "export async function clean(db: { query(s: string): Promise<unknown> }) {\n  await db.query('DELETE FROM core.property_unit');\n}\n",
    ],
  ])('%s', (_label, file, content) => {
    const root = copyOfTree();
    addFile(root, file, content);
    const { findings } = scanInventory(root);
    expect(findings.map((f) => f.file)).toEqual([file]);
  });

  it('a relation newly added to the definition is protected by the scan at once', () => {
    const root = copyOfTree();
    addFile(root, 'scripts/rogue/new-layer.ts', "import { PrismaClient } from '@prisma/client';\nawait new PrismaClient().$executeRawUnsafe('TRUNCATE env.msb_new_layer');\n");
    expect(scanInventory(root).findings).toEqual([]); // not protected yet
    const extended = parseProtectedRelationsDefinition({
      contract: 'mimer-protected-relations-v1',
      retained_staging_schemas: [...PROTECTED_RELATIONS.retained_staging_schemas],
      relations: [
        ...PROTECTED_RELATIONS.relations.map((r) => ({ relation: r.relation, class: r.class, basis: r.basis, derived_from: r.derived_from, sanctioned_rebuild: r.sanctioned_rebuild })),
        { relation: 'env.msb_new_layer', class: 'LU_LIVE_LAYER', basis: 'canary: a newly admitted LU layer' },
      ],
    });
    expect(scanInventory(root, { definition: extended }).findings.map((f) => f.file)).toEqual(['scripts/rogue/new-layer.ts']);
  });

  it.each([
    [
      'the gate call removed from an existing ogr2ogr path',
      'scripts/import/bulk-import-sgu-api-all.ts',
      'execSync(assertOgr2ogrCommandAllowed({ caller: GATE_CALLER, command: ogrCmd }), ',
      'execSync(ogrCmd, ',
    ],
    [
      'one gated statement of several un-gated',
      'scripts/import/sguBulkImportEngine.ts',
      'await prisma.$executeRawUnsafe(gatedSql(GATE_CALLER, `DROP TABLE IF EXISTS ${tableRef} CASCADE`));',
      'await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${tableRef} CASCADE`);',
    ],
    [
      'the Python gate call removed',
      'scripts/data-pipeline/import_lm_stac_resume.py',
      "    assert_ungoverned_write_allowed(GATE_CALLER, 'OGR2OGR_WRITE', table)\n",
      '',
    ],
    ["a retired script's refusal removed", 'scripts/db/drop-staging-tables.ts', "refuseRetiredDestructiveScript('scripts/db/drop-staging-tables.ts');", ''],
    ["a retired SQL script's refusal header removed", 'scripts/db/partition-spatial-grid.sql', '\\set ON_ERROR_STOP on', ''],
    ['a retired script dropped from the list', 'scripts/verify-jordarter.ts', '', ''],
  ])('mutation: %s -> the inventory fails', (label, file, from, to) => {
    const root = copyOfTree();
    const target = path.join(root, file);
    const original = fs.readFileSync(target, 'utf8');
    changed.set(file, original);
    const before = original.replace(/\r\n/g, '\n');
    let retired: string[] | undefined;
    if (from === '') {
      retired = RETIRED_DESTRUCTIVE_SCRIPTS.map((r) => r.script).filter((s) => s !== file);
    } else {
      expect(before.split(from).length - 1, `${label}: anchor`).toBe(1);
      fs.writeFileSync(target, before.replace(from, () => to), 'utf8');
    }
    const files = scanInventory(root, { retired }).findings.map((f) => f.file);
    expect(files).toContain(file);
  });
});
