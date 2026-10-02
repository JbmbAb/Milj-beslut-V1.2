import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TEST_DB_GUARD_LABEL } from './testDatabaseTargetPolicy';

/**
 * TEST-DB-GUARD (OD-K0-5), TDG-4 (owner decision 2026-10-03 (4) point 8; SWEEP-REPORT "Skrivningar i
 * arbetskatalogen"): in a test process no write lands in a LIVE data root of a product tree. Product code
 * and tests write to cwd-relative defaults that no setting redirects -- `storage/drafts`
 * (documentGenerator), `storage/manifests/import-qa` (import-librarian-manifest), `tmp-artifacts`,
 * `tests/fixtures/...` -- and with cwd in the demonstrator's worktree that IS the live tree: the
 * demonstrator runs with that cwd. Where a module supports a root setting, the test setup gives it a
 * fresh temp root (testDataRootIsolation.ts); this guard is the backstop for every root, whether or not
 * a setting exists: a write, a mkdir, a rename, a copy, a link, a removal, a truncation or a metadata
 * change -- sync, callback or promise -- whose target is inside a protected root is refused BEFORE
 * anything happens, with a TestDataRootWriteRefusedError (code TEST_DATA_ROOT_WRITE_REFUSED) that names
 * the operation, the path and the root.
 *
 * KNOWN LIMITATION (TDG-5, TDG4-VERIFICATION finding 7) -- skyddar bara fs-anrop i processen och barn som
 * laddar guardens preload; breda körningar ska ha cwd utanför arbetsträdet. In words: the guard patches
 * node:fs in THIS process only. A child that does not load it (the Vitest setup file or
 * server/loadEnvFirst.ts) -- cmd `>` / `copy`, bash `tee`, PowerShell `Out-File`, python, git, `node -e`
 * without loadEnvFirst -- and a worker_threads Worker (its own fs bindings) write unguarded; so do writes
 * through a file descriptor or FileHandle opened before, and native addons. It is a backstop in the
 * process, not an isolation: broad runs (sweeps, integration) keep cwd OUTSIDE the worktree (an export).
 *
 * Protected: every root below under the product tree of this checkout (the repo root this module lives in),
 * under the current working directory when that is a product tree (package.json + server/ + packages/) and
 * under the known live product trees of this workstation; the absolute live locations (data-root fallbacks,
 * the demonstrator's D:\mimer-demo, the archives on H:, D:, E: ...); and the live directories under the home
 * directory (~/.mimers ...), resolved with os.homedir() at run time. A target is compared as written
 * (canonical: \\?\ and \\.\ prefixes, a local administrative share, an NTFS stream suffix and trailing dots
 * removed, case-folded on Windows/macOS) AND, when that is allowed, through its real path (junctions,
 * symbolic links, 8.3 short names). Reads are never refused.
 *
 * Exceptions: the reviewed list TEST_DATA_ROOT_WRITE_EXCEPTIONS -- each one exact file, owned by one test
 * file (it applies only while that Vitest test file runs, matched by its full path), with the reason it
 * cannot get a temp root in this unit. The inventory test locks its size: a new entry fails it until the
 * lock is changed in review.
 *
 * Installed in a test runtime only (the Vitest setup file, server/loadEnvFirst.ts in a NODE_ENV=test /
 * MIMER_TEST_MODE process, playwright.config.ts). Outside a test runtime nothing here runs.
 */

export type ProtectedDataRoot = { readonly root: string; readonly why: string };

/** Relative to a product tree. Derived from the code by tests/unit/testDbGuardDataRootInventory.scan.mjs. */
export const TEST_PROTECTED_RELATIVE_ROOTS: readonly ProtectedDataRoot[] = Object.freeze([
  {
    root: 'storage',
    why: 'drafts (documentGenerator), uploads (documentUploadService), temp (sewage.routes), import-archive/-cache (importPathService), ingest, manifests/import-qa, master-archive (scripts/import/*)',
  },
  {
    root: '.quarantine',
    why: 'quarantine store (governance.routes, QuarantineStorage, Harvest/LegalCorpus composition roots, scripts/ops)',
  },
  { root: '.data', why: 'admin role grants (adminRoleGrantService), the old .data/mimers CAS' },
  { root: 'tmp-artifacts', why: 'proof/evidence output of scripts/mimers/*, scripts/artifact/*' },
  {
    root: 'tmp-mimers',
    why: 'a CAS root default (scripts/mimers/migrate-artifact-store-to-cas.ts, scripts/evolve-integration-test.ts)',
  },
  { root: 'tests/fixtures', why: 'committed fixtures; a test writes only the listed exceptions' },
  { root: 'dossiers', why: 'KNOWLEDGE_BASE_ROOT default (importPathService)' },
  {
    root: 'downloads',
    why: 'IMPORT_SOURCE_ROOT default (importPathService), scripts/import/import-stability-mapping.ts',
  },
  {
    root: 'GEO_Master_Archive',
    why: 'the master archive in the main checkout (scripts/download-geokalkyl-sources.ts)',
  },
  {
    root: 'knowledge-base',
    why: 'exported service indexes (scripts/export_lansstyrelsen_geodata_service_index.ts, scripts/import/national-survey/*)',
  },
  { root: 'logs', why: 'backfill reports (scripts/backfill/*)' },
  { root: 'scratch', why: 'scripts/db/import-elevation.ts' },
  { root: 'archives', why: 'scripts/import/seed-core-legal-sfs.ts' },
  {
    root: 'docs',
    why: 'committed documents; scripts/import/master-walk-pass2-sha.mjs writes its ledger under docs/architecture',
  },
  {
    root: 'public',
    why: 'the UI assets the running Vite server serves live (written by scripts/capture_pwa_screenshots.ts)',
  },
  { root: 'lm_headers.txt', why: 'scripts/import/import-lantmateriet.ts' },
  { root: 'anna_vestling_utredning.md', why: 'scripts/generate-lokaliseringsutredning.ts' },
  // TDG-5 (scanner forms: a cwd variable, a ternary fallback, a path relative to the file)
  {
    root: '../Miljobeslut_Ops_Pipeline',
    why: 'OPS_PIPELINE_ROOT default, a sibling of the tree (scripts/ops/evaluate-ops-pipeline.ts)',
  },
  {
    root: '../../Geodata',
    why: 'the geodata zips two levels above the tree (scripts/db/import-sgu-geodata.ts)',
  },
  { root: 'output', why: 'the extract directory of scripts/db/import-sgu-geodata.ts' },
  {
    root: 'reference-vectors',
    why: 'the generated reference vectors (packages/mps-canonical/scripts/generate-reference-vectors.ts)',
  },
  // TDG-5 (TDG4-VERIFICATION finding 11): the tree's own root files -- live configuration and secrets
  { root: '.env', why: "the tree's environment file (live settings)" },
  { root: '.env.local', why: "the tree's local environment file (live settings and secrets)" },
  {
    root: '.env.test',
    why: 'the env file provisioning/benchmark scripts read (a test never takes DB or data-root keys from it, nor writes it)',
  },
  { root: 'package.json', why: "the tree's package manifest" },
  { root: 'package-lock.json', why: "the tree's dependency lock file" },
]);

/**
 * REVIEWED: cwd- or repo-relative directories product code names that are NOT live data roots -- source,
 * configuration and committed inputs it only reads, or build output. Not guarded. The inventory test derives
 * every relative root from the code, requires each to be protected or here, and locks this list.
 */
export const TEST_RELATIVE_ROOTS_NOT_LIVE: readonly ProtectedDataRoot[] = Object.freeze([
  { root: '.dockerignore', why: 'read by the pattern-proof Docker executor (mps-pattern-proof)' },
  {
    root: '.prettierrc.json',
    why: 'formatter configuration, only read (packages/mps-pattern-proof/scripts/gen-workflow-adapter.ts)',
  },
  { root: 'app', why: 'source scanned by scripts/ci/assert-data-classification-imports.ts' },
  { root: 'components', why: 'source scanned by scripts/ci/assert-data-classification-imports.ts' },
  {
    root: 'coverage',
    why: "Vitest's own coverage output (build output, read by scripts/report-coverage-gaps.mjs)",
  },
  { root: 'node_modules', why: 'installed tools started by import scripts (node_modules/.bin)' },
  {
    root: 'packages',
    why: "source: a package's own files and rules, only read (mps-compliance dependency rules, mps-pattern-proof)",
  },
  { root: 'prisma', why: 'schema and migrations, only read by db scripts' },
  { root: 'scripts', why: 'source: scripts that start or read other scripts' },
  { root: 'server', why: 'source: verify CLIs started by provisioning, CI scans' },
  { root: 'services', why: 'source scanned by scripts/ci/assert-data-classification-imports.ts' },
  {
    root: 'source-registry',
    why: 'the signed source registry, only read (SOURCE_REGISTRY_ARTIFACT_PATH default)',
  },
  { root: 'tests/setup', why: 'the Vitest setup source, only loaded (scripts/devgov/vitest.config.mjs)' },
  { root: 'training', why: 'source material only read (server/scripts/migrateToFirestore.ts)' },
  { root: 'tsconfig.json', why: 'compiler configuration, only read (luApiBoundary)' },
]);

/**
 * The demonstrator's live directory on this workstation: its CAS (cas/, MIMERS_ROOT of the demonstrator)
 * and its key material (secrets/) -- scripts/demo/provision-lu-demo-cas.ts,
 * scripts/demo/provision-lu-demo-viewer-identity.ts and the demonstrator's start script. A documented
 * CONSTANT, deliberately not a setting: nothing a test process sets can move or switch off this protection.
 * Every level below it is protected.
 */
export const MIMER_DEMO_LIVE_ROOT = 'D:\\mimer-demo';

/**
 * Absolute live locations outside a product tree (derived from the code: every absolute path literal the
 * inventory scanner finds must be under one of these or on TEST_ABSOLUTE_PATHS_NOT_LIVE).
 */
export const TEST_PROTECTED_ABSOLUTE_ROOTS: readonly ProtectedDataRoot[] = Object.freeze([
  {
    root: MIMER_DEMO_LIVE_ROOT,
    why: "the demonstrator's live CAS (cas) and key material (secrets): scripts/demo/provision-lu-demo-*.ts",
  },
  {
    root: 'H:\\Delade enheter',
    why: 'the shared drive: GEO_MASTER_ARCHIVE / MASTER_ARCHIVE_ROOT / H_DRIVE_ROOT default, scripts/db/migrate-d-to-h-*, archive scripts',
  },
  { root: 'M:\\', why: 'MASTER_ARCHIVE_ROOT default (scripts/import/run-sks-import.ts)' },
  { root: 'G:\\Min enhet', why: 'scripts/import/download-historiska-g.ts' },
  {
    root: 'D:\\Users',
    why: 'the old installation profiles: OUTLOOK_BASE_DIR default, MiljoBeslut_Produktdata, Downloads (scripts/db/migrate-d-to-h-*)',
  },
  {
    root: 'D:\\ingest-arkiv-2026-03-29',
    why: 'INGEST_GPKG_ROOT default, the ingest archive (scripts/import/*, scripts/db/migrate-d-to-h-*)',
  },
  { root: 'D:\\GEodata', why: 'scripts/db/migrate-d-to-h-*, scripts/ops/dedupe-d-against-master.mjs' },
  { root: 'D:\\Geo inlärning', why: 'scripts/ops/dedupe-d-against-master.mjs' },
  { root: 'D:\\miljobeslut_staging', why: 'scripts/ops/dedupe-d-against-master.mjs' },
  { root: 'D:\\GEO_Master_Archive_Runtime', why: 'scripts/ops/setup-geo-master-runtime-mirror.cjs' },
  { root: 'D:\\temp-cog-extract', why: 'scripts/import/convert-nmd-to-cog.ts' },
  {
    root: 'E:\\MiljoBeslut_Produktdata_Sources',
    why: 'source data (scripts/import/import-heavy-geodata.ts, diagnose-system.ts, verify-jordarter.ts)',
  },
  {
    root: 'E:\\GIS-Utbildning',
    why: 'source data (scripts/import/import-heavy-geodata.ts, import-topo10-only.ts)',
  },
  {
    root: 'C:\\miljöbeslut\\scripts\\db\\.puh-scale-01-results.jsonl',
    why: 'appended by scripts/db/legal-corpus-materialization-puh-scale-01.ts in the main checkout',
  },
  { root: 'C:\\GEO PDF', why: 'scripts/db/migrate-d-to-h-*' },
  { root: 'C:\\Millbygard_from_D', why: 'source data (scripts/import/platform-datasources.ts)' },
  { root: 'C:\\GEO_Master_Archive_Runtime', why: 'scripts/ops/setup-geo-master-runtime-mirror.cjs' },
  { root: 'C:\\temp-cog-historical', why: 'scripts/import/convert-historiska-to-cog.ts' },
  { root: 'C:\\Dev\\miljobeslut-platform-recovery', why: 'another checkout (scripts/categorize-zips.ts)' },
  { root: '/tmp/outlook-attachments', why: 'OUTLOOK_STORAGE_ROOT default' },
  { root: '/tmp/miljobeslut-backups', why: 'BACKUP_DIR default' },
]);

/**
 * Live directories under the HOME directory of the user who runs the test -- relative to it, resolved at
 * run time with os.homedir() (and os.userInfo().homedir, and the home at load time: a test that points
 * HOME/USERPROFILE elsewhere does not move the protection). No user name is written here.
 */
export const TEST_PROTECTED_HOME_ROOTS: readonly ProtectedDataRoot[] = Object.freeze([
  {
    root: '.mimers',
    why: 'the operator CAS and key material (~/.mimers/secrets: 25 scripts under scripts/ops, scripts/db, scripts/demo write key pairs there)',
  },
  { root: 'Downloads', why: 'SGU_DOWNLOAD_DIR default, scripts/import/import-downloads-vector.ts' },
  {
    root: '.gemini',
    why: 'agent notes written by scripts/categorize-zips.ts, scripts/export-full-stats.cjs',
  },
  {
    root: 'AppData/Roaming/gcloud',
    why: 'application default credentials (scripts/test-models.ts, scripts/test-vertex.ts)',
  },
]);

/**
 * Product trees on this workstation whose live roots are protected wherever a test runs from (an export
 * with cwd outside the worktree still never writes into them).
 */
export const KNOWN_LIVE_PRODUCT_TREES: readonly ProtectedDataRoot[] = Object.freeze([
  {
    root: 'C:\\miljöbeslut',
    why: 'the main checkout (scripts/db/legal-corpus-* read its .quarantine; its storage holds the local master archive)',
  },
  {
    root: 'C:\\wt-lu-demo',
    why: "the demonstrator's worktree: the demonstrator runs with this cwd (start-lu-demo.ps1)",
  },
]);

/**
 * REVIEWED: absolute paths product code names that are NOT live data -- binaries it only executes, fonts
 * it only reads, paths inside a container. Not guarded. Locked by the inventory test; an entry may never
 * be a bare drive root nor contain a protected root.
 */
export const TEST_ABSOLUTE_PATHS_NOT_LIVE: readonly ProtectedDataRoot[] = Object.freeze([
  { root: 'C:\\Program Files\\GDAL', why: 'GDAL binaries (ogr2ogr, ogrinfo, gdal_translate), only executed' },
  {
    root: 'C:\\Program Files\\QGIS 4.0.2',
    why: "QGIS's GDAL binaries, only executed (mps-data-governance scripts)",
  },
  { root: 'C:\\Windows\\Fonts', why: 'system fonts, only read (pdfUnicodeFont)' },
  { root: '/usr/share/fonts', why: 'system fonts, only read (pdfUnicodeFont)' },
  { root: '~/AppData/Local/Microsoft/Windows/Fonts', why: 'user fonts, only read (pdfUnicodeFont)' },
  { root: '/mnt/drive', why: 'a path INSIDE the PostGIS container (the POSTGIS_MOUNT_ROOT default)' },
  {
    root: '/mnt/geo_master_archive',
    why: 'a path INSIDE the PostGIS container (check-postgis-prerequisites)',
  },
  {
    root: '/var/lib/postgresql/data',
    why: 'a path inside the database container, named in a generated context text',
  },
  {
    root: '/tmp/manifest.json',
    why: 'a path INSIDE the rclone container (docker run -v ...:/tmp/manifest.json)',
  },
  { root: '/tmp/out', why: 'a path INSIDE the rclone container (docker run -v ...:/tmp/out)' },
]);

export type TestDataRootWriteException = {
  /** The one file (relative to the product tree, POSIX) that may be written; its parent dirs may be created. */
  readonly path: string;
  /** The test file (relative, POSIX) during which the exception applies -- and only then. */
  readonly testFile: string;
  readonly why: string;
};

/**
 * REVIEWED exceptions: tests that still write into a protected root and cannot get a temp root in TDG-4.
 * Locked by tests/unit/testDbGuardDataRootInventory.test.ts (count and content); never extend silently.
 */
export const TEST_DATA_ROOT_WRITE_EXCEPTIONS: readonly TestDataRootWriteException[] = Object.freeze([
  {
    path: 'tests/fixtures/EndToEnd/Case_Fusion/original/beslut.txt',
    testFile: 'packages/mps-lu/tests/LUEndToEnd.test.ts',
    why: 'rewrites a COMMITTED fixture with the same bytes (beforeAll, :38); mps-lu is outside TDG-4 -- move it to a temp dir in an mps-lu hygiene unit',
  },
  {
    path: 'tests/fixtures/EndToEnd/VerticalProof/original/beslut.txt',
    testFile: 'packages/mps-lu/tests/VerticalProof.test.ts',
    why: 'writes a fixed-content fixture (beforeAll, :57); mps-lu is outside TDG-4 -- move it to a temp dir in an mps-lu hygiene unit',
  },
  {
    path: 'tests/fixtures/National_Archive/VISS/2024/Karlstad/Case_123/original/beslut_grundvatten.txt',
    testFile: 'packages/mps-lu/tests/RawSourceIngestion.test.ts',
    why: 'writes a fixed-content fixture (beforeAll, :9); mps-lu is outside TDG-4 -- move it to a temp dir in an mps-lu hygiene unit',
  },
  {
    path: 'storage/manifests/import-qa/batch-v2.json',
    testFile: 'tests/unit/import/importLibrarianManifestRetention.test.ts',
    why: "the script's QA log dir is hard-wired to <cwd>/storage/manifests/import-qa (scripts/import/import-librarian-manifest.ts:119,175) with no setting; import scripts are outside TDG-4 -- give it a root setting in the import lane",
  },
]);

export const TEST_DATA_ROOT_WRITE_REFUSED = 'TEST_DATA_ROOT_WRITE_REFUSED';

export class TestDataRootWriteRefusedError extends Error {
  readonly code = TEST_DATA_ROOT_WRITE_REFUSED;
  constructor(
    readonly operation: string,
    readonly target: string,
    readonly protectedRoot: string,
  ) {
    super(
      `[${TEST_DB_GUARD_LABEL}] TDG-4 refused ${operation} of ${target}: it is inside the live data root ` +
        `${protectedRoot}. A test never writes into a live data root of a product tree -- nothing was written. ` +
        'Use a temp directory (fs.mkdtempSync(os.tmpdir())) or the module root setting; reviewed exceptions: ' +
        'TEST_DATA_ROOT_WRITE_EXCEPTIONS in server/modules/test-db-guard/installTestDataRootWriteGuard.ts.',
    );
    this.name = 'TestDataRootWriteRefusedError';
  }
}

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
/** The product tree this module belongs to: server/modules/test-db-guard -> repo root. */
export const THIS_PRODUCT_TREE = path.resolve(MODULE_DIR, '..', '..', '..');

const isWindows = process.platform === 'win32';
const caseFold = isWindows || process.platform === 'darwin';
const norm = (p: string) => {
  const resolved = path.resolve(p);
  return caseFold ? resolved.toLowerCase() : resolved;
};
const isInsideOrSame = (target: string, root: string) =>
  target === root || target.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

// ---------------------------------------------------------------------------------------------------
// TDG-5: canonical forms of a target (TDG4-VERIFICATION findings 8 and 10).

const safe = <T>(fn: () => T): T | null => {
  try {
    return fn();
  } catch {
    return null;
  }
};

/** Names of THIS machine in a UNC path (an administrative share \\<name>\C$ is the local drive C:). */
function localHostNames(): Set<string> {
  const names = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0--1.ipv6-literal.net']);
  const host = safe(() => os.hostname());
  if (host) names.add(host.toLowerCase());
  return names;
}

/**
 * The path as Windows resolves it, lexically: `\\?\C:\x` and `\\.\C:\x` -> `C:\x`; `\\?\UNC\h\s` -> `\\h\s`;
 * `\\localhost\C$\x` (an administrative share of this machine) -> `C:\x`; an NTFS stream (`storage:ads`,
 * `x.txt:s:$DATA`) and trailing dots/spaces of a segment (`storage.`) removed. Elsewhere: path.resolve.
 */
export function canonicalTargetPath(target: string): string {
  if (!isWindows) return path.resolve(target);
  let s = target.replace(/\//g, '\\');
  const unc = /^\\\\[?.]\\UNC\\(.*)$/i.exec(s);
  if (unc) s = `\\\\${unc[1]}`;
  const device = /^\\\\[?.]\\([A-Za-z]:(?:\\.*)?)$/.exec(s);
  if (device) s = device[1];
  const share = /^\\\\([^\\]+)\\([A-Za-z])\$(\\.*)?$/.exec(s);
  if (share && (localHostNames().has(share[1].toLowerCase()) || /^127\.\d+\.\d+\.\d+$/.test(share[1])))
    s = `${share[2]}:${share[3] ?? '\\'}`;
  const resolved = path.win32.resolve(s);
  const { root } = path.win32.parse(resolved);
  const segments = resolved
    .slice(root.length)
    .split('\\')
    .filter(Boolean)
    .map((segment) => {
      const colon = segment.indexOf(':');
      const name = colon >= 0 ? segment.slice(0, colon) : segment;
      return name.replace(/[. ]+$/, '') || name;
    })
    .filter(Boolean);
  return path.win32.join(root, ...segments);
}

const realpathNative = fs.realpathSync.native;
const lstatOriginal = fs.lstatSync;
const readlinkOriginal = fs.readlinkSync;

/**
 * The real location a write to `canonical` reaches: the real path of its nearest existing ancestor (a
 * junction, a symbolic link -- dangling ones followed -- or an 8.3 short name resolved) plus the rest.
 * Null when nothing resolves. Uses only the unguarded originals.
 */
export function realTargetPath(canonical: string): string | null {
  let probe = canonical;
  const rest: string[] = [];
  for (let hops = 0; hops < 64; hops += 1) {
    const real = safe(() => realpathNative(probe));
    if (real !== null) return canonicalTargetPath(path.join(real, ...rest));
    const stat = safe(() => lstatOriginal(probe));
    if (stat?.isSymbolicLink()) {
      const link = safe(() => readlinkOriginal(probe));
      if (link !== null) {
        probe = canonicalTargetPath(path.resolve(path.dirname(probe), link));
        continue;
      }
    }
    const parent = path.dirname(probe);
    if (parent === probe) return null;
    rest.unshift(path.basename(probe));
    probe = parent;
  }
  return null;
}

const productTreeCache = new Map<string, boolean>();
/** package.json + server/ + packages/: a checkout or an export of this product. */
export function isProductTree(dir: string): boolean {
  const key = norm(dir);
  let known = productTreeCache.get(key);
  if (known === undefined) {
    known =
      fs.existsSync(path.join(dir, 'package.json')) &&
      fs.existsSync(path.join(dir, 'server')) &&
      fs.existsSync(path.join(dir, 'packages'));
    productTreeCache.set(key, known);
  }
  return known;
}

const realTreeCache = new Map<string, string>();
/** A tree and, when it exists and differs, its real path (memoized). */
function treeForms(tree: string): string[] {
  const key = norm(tree);
  let real = realTreeCache.get(key);
  if (real === undefined) {
    real = safe(() => canonicalTargetPath(realpathNative(tree))) ?? tree;
    realTreeCache.set(key, real);
  }
  return norm(real) === key ? [tree] : [tree, real];
}

const appliesHere = (root: string) => isWindows || !/^[A-Za-z]:\\/.test(root);

const HOME_AT_LOAD = safe(() => os.homedir());
let userInfoHome: string | null | undefined;
/** The home directory now (os.homedir()), at load time and of the account (os.userInfo()). */
function homeDirectories(): string[] {
  if (userInfoHome === undefined) userInfoHome = safe(() => os.userInfo().homedir);
  const homes = [safe(() => os.homedir()), HOME_AT_LOAD, userInfoHome].filter(
    (home): home is string => typeof home === 'string' && home.trim() !== '',
  );
  return [...new Map(homes.map((home) => [norm(home), home])).values()];
}

/** Every absolute protected root in force now: the absolute list (this platform) and the home roots. */
export function protectedAbsoluteRootsNow(): string[] {
  const roots = TEST_PROTECTED_ABSOLUTE_ROOTS.map(({ root }) => root).filter(appliesHere);
  for (const home of homeDirectories())
    for (const { root } of TEST_PROTECTED_HOME_ROOTS) roots.push(path.join(home, ...root.split('/')));
  return roots;
}

function currentVitestTestFile(): string | null {
  const state = (globalThis as { __vitest_worker__?: { filepath?: unknown } }).__vitest_worker__;
  return typeof state?.filepath === 'string' ? state.filepath : null;
}

/**
 * How a target is written. `write`: a file is created or changed (an exception may allow exactly its file).
 * `mkdir`: a directory is created (an exception's own parent directories only). `mkdtemp`: a uniquely named
 * directory is created next to the prefix (never excepted). `remove`: rm, rmdir, unlink, a rename's source --
 * also refused for an ANCESTOR of a protected root. `tree`: a recursive copy's or a rename's destination, a
 * new link -- also refused for an ancestor (it can land a whole tree, storage/ included).
 */
export type WriteKind = 'write' | 'mkdir' | 'mkdtemp' | 'remove' | 'tree';

export type WriteRefusal = {
  readonly operation: string;
  readonly target: string;
  readonly protectedRoot: string;
};

const reachesAncestors = (kind: WriteKind) => kind === 'remove' || kind === 'tree';

/**
 * The decision, pure but for the product-tree check of cwd and the real-path lookup: null (allowed) or the
 * refusal. The target is judged as written (canonical) first -- a refusal there needs no file-system access
 * at all -- and then, unless `resolveLinks` is false, through its real path.
 */
export function testDataRootWriteRefusal(
  operation: string,
  kind: WriteKind,
  target: string,
  options: {
    readonly cwd?: string;
    readonly testFile?: string | null;
    readonly trees?: readonly string[];
    readonly resolveLinks?: boolean;
  } = {},
): WriteRefusal | null {
  const cwd = options.cwd ?? process.cwd();
  const baseTrees = options.trees ?? [
    THIS_PRODUCT_TREE,
    ...(isProductTree(cwd) ? [cwd] : []),
    ...KNOWN_LIVE_PRODUCT_TREES.map(({ root }) => root).filter(appliesHere),
  ];
  const trees = [...new Map(baseTrees.flatMap(treeForms).map((tree) => [norm(tree), tree])).values()];
  const testFile = options.testFile === undefined ? currentVitestTestFile() : options.testFile;
  const lexical = canonicalTargetPath(target);
  const refusal = decide(operation, kind, lexical, target, trees, testFile);
  if (refusal || options.resolveLinks === false) return refusal;
  const real = realTargetPath(lexical);
  if (real === null || norm(real) === norm(lexical)) return null;
  return decide(operation, kind, real, target, trees, testFile);
}

function decide(
  operation: string,
  kind: WriteKind,
  candidate: string,
  original: string,
  trees: readonly string[],
  testFile: string | null,
): WriteRefusal | null {
  const abs = norm(candidate);
  const refusal = (protectedRoot: string): WriteRefusal => ({
    operation,
    target: path.resolve(original),
    protectedRoot,
  });
  for (const tree of trees) {
    for (const { root } of TEST_PROTECTED_RELATIVE_ROOTS) {
      const rootAbs = norm(path.join(tree, root));
      const inside = isInsideOrSame(abs, rootAbs);
      const ancestor = reachesAncestors(kind) && isInsideOrSame(rootAbs, abs);
      if (!inside && !ancestor) continue;
      if (inside && isExcepted(abs, kind, trees, testFile)) continue;
      return refusal(path.join(tree, root));
    }
  }
  for (const root of protectedAbsoluteRootsNow()) {
    const rootAbs = norm(root);
    if (isInsideOrSame(abs, rootAbs) || (reachesAncestors(kind) && isInsideOrSame(rootAbs, abs))) {
      return refusal(root);
    }
  }
  return null;
}

/**
 * An exception allows `write` of exactly its file and `mkdir` of exactly the file's own ancestors, only
 * while its owner test file runs -- the owner compared by its FULL path, never by its name. A uniquely named
 * directory (mkdtemp), a removal, a recursive copy or a link is never excepted.
 */
function isExcepted(
  abs: string,
  kind: WriteKind,
  trees: readonly string[],
  testFile: string | null,
): boolean {
  if ((kind !== 'write' && kind !== 'mkdir') || !testFile) return false;
  const testAbs = norm(canonicalTargetPath(testFile));
  for (const tree of trees) {
    for (const exception of TEST_DATA_ROOT_WRITE_EXCEPTIONS) {
      if (testAbs !== norm(path.join(tree, exception.testFile))) continue;
      const allowed = norm(path.join(tree, exception.path));
      if (kind === 'write' && abs === allowed) return true;
      // creating the exception's own parent directories -- nothing beside them
      if (kind === 'mkdir' && abs !== allowed && isInsideOrSame(allowed, abs)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------------------------------
// Installation: patches node:fs (sync, callback) and node:fs/promises, then syncs the ESM named exports.

type AnyFn = (...args: unknown[]) => unknown;
const GUARD_MARK = Symbol.for('mimer.testDbGuard.dataRootWriteGuard');

/** A path argument: a string, a Buffer or a file: URL (also a URL-shaped object, as Node accepts). */
function pathArg(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString();
  if (value !== null && typeof value === 'object') {
    const { href, protocol } = value as { href?: unknown; protocol?: unknown };
    if (typeof href === 'string' && typeof protocol === 'string') {
      // a non-file URL is refused by Node itself; a file: URL is the path it names
      return protocol === 'file:' ? safe(() => fileURLToPath(href)) : null;
    }
  }
  return null; // a file descriptor or a FileHandle: already opened, nothing new is reached
}

function isWriteFlag(flags: unknown): boolean {
  if (typeof flags === 'string') return /[wa+]/.test(flags);
  if (typeof flags === 'number') {
    const c = fs.constants;
    return (flags & (c.O_WRONLY | c.O_RDWR | c.O_CREAT | c.O_TRUNC | c.O_APPEND)) !== 0;
  }
  return false;
}

type Check = {
  readonly index: number;
  readonly kind: WriteKind;
  readonly when?: (args: unknown[]) => boolean;
  /**
   * A link target: Node resolves a relative one against the link's own directory (a junction's too); it is
   * judged that way AND, conservatively, against cwd.
   */
  readonly relativeToDirOf?: number;
};

/** Which argument of which function is a target, and how it is written. */
const CHECKS: Record<string, readonly Check[]> = {
  writeFile: [{ index: 0, kind: 'write' }],
  appendFile: [{ index: 0, kind: 'write' }],
  truncate: [{ index: 0, kind: 'write' }],
  mkdir: [{ index: 0, kind: 'mkdir' }],
  mkdtemp: [{ index: 0, kind: 'mkdtemp' }],
  copyFile: [{ index: 1, kind: 'write' }],
  // TDG-5 (finding 3): a recursive copy onto an ANCESTOR of a root lands in it (Node's cpSync copies a
  // directory natively, past every JS-level function)
  cp: [{ index: 1, kind: 'tree' }],
  rename: [
    { index: 0, kind: 'remove' },
    { index: 1, kind: 'tree' },
  ],
  // a hard link is a second name of the same file: neither name may be in a root
  link: [
    { index: 0, kind: 'write' },
    { index: 1, kind: 'write' },
  ],
  // a symbolic link or junction INTO a root is an alias for writing it; a link placed in a root changes it
  symlink: [
    { index: 0, kind: 'write', relativeToDirOf: 1 },
    { index: 1, kind: 'tree' },
  ],
  rm: [{ index: 0, kind: 'remove' }],
  rmdir: [{ index: 0, kind: 'remove' }],
  unlink: [{ index: 0, kind: 'remove' }],
  open: [{ index: 0, kind: 'write', when: (args) => isWriteFlag(args[1]) }],
  createWriteStream: [{ index: 0, kind: 'write' }],
  // TDG-5 (finding 9): metadata of a live file
  utimes: [{ index: 0, kind: 'write' }],
  lutimes: [{ index: 0, kind: 'write' }],
  chmod: [{ index: 0, kind: 'write' }],
  lchmod: [{ index: 0, kind: 'write' }],
  chown: [{ index: 0, kind: 'write' }],
  lchown: [{ index: 0, kind: 'write' }],
};

function refusalFor(name: string, args: unknown[]): TestDataRootWriteRefusedError | null {
  const base = name.replace(/Sync$/, '');
  for (const check of CHECKS[base] ?? []) {
    if (check.when && !check.when(args)) continue;
    const target = pathArg(args[check.index]);
    if (target === null) continue;
    const targets = [target];
    if (check.relativeToDirOf !== undefined && !path.isAbsolute(target)) {
      const link = pathArg(args[check.relativeToDirOf]);
      if (link !== null) targets.push(path.resolve(path.dirname(path.resolve(link)), target));
    }
    for (const candidate of targets) {
      const refusal = testDataRootWriteRefusal(`fs.${name}`, check.kind, candidate);
      if (refusal)
        return new TestDataRootWriteRefusedError(refusal.operation, refusal.target, refusal.protectedRoot);
    }
  }
  return null;
}

function wrap(
  target: Record<string, unknown>,
  name: string,
  style: 'sync' | 'callback' | 'promise' | 'stream',
): void {
  const original = target[name];
  if (typeof original !== 'function') return;
  const guarded = function guardedFsCall(this: unknown, ...args: unknown[]): unknown {
    const error = refusalFor(name, args);
    if (error) {
      if (style === 'promise') return Promise.reject(error);
      if (style === 'callback') {
        const callback = args[args.length - 1];
        if (typeof callback === 'function') {
          process.nextTick(() => (callback as AnyFn)(error));
          return undefined;
        }
      }
      throw error;
    }
    return (original as AnyFn).apply(this, args);
  };
  Object.defineProperty(guarded, 'name', { value: (original as AnyFn).name });
  target[name] = guarded;
}

const BASES = Object.keys(CHECKS);

/**
 * Idempotent. Installs the write guard on node:fs and node:fs/promises in this process.
 *
 * KNOWN LIMITATION: skyddar bara fs-anrop i processen och barn som laddar guardens preload; breda körningar
 * ska ha cwd utanför arbetsträdet (see the module comment: children that do not load the Vitest setup file
 * or server/loadEnvFirst.ts, shell redirection, worker_threads and already opened descriptors are outside).
 */
export function installTestDataRootWriteGuard(): void {
  const fsObj = fs as unknown as Record<string | symbol, unknown>;
  if (fsObj[GUARD_MARK]) return;
  for (const base of BASES) {
    if (base === 'createWriteStream') {
      wrap(fsObj as Record<string, unknown>, base, 'stream');
      continue;
    }
    wrap(fsObj as Record<string, unknown>, base, 'callback');
    wrap(fsObj as Record<string, unknown>, `${base}Sync`, 'sync');
    wrap(fs.promises as unknown as Record<string, unknown>, base, 'promise');
  }
  Object.defineProperty(fsObj, GUARD_MARK, { value: true });
  // ESM: `import { writeFileSync } from 'node:fs'` and `from 'node:fs/promises'` see the guarded functions.
  syncBuiltinESMExports();
}

/** For the proof tests. */
export function testDataRootWriteGuardInstalled(): boolean {
  return Boolean((fs as unknown as Record<symbol, unknown>)[GUARD_MARK]);
}
