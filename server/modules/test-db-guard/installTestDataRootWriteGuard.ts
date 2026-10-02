import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { URL as NodeURL, fileURLToPath } from 'node:url';

import { TEST_DB_GUARD_LABEL } from './testDatabaseTargetPolicy';

/**
 * TEST-DB-GUARD (OD-K0-5), TDG-4 (owner decision 2026-10-03 (4) point 8; SWEEP-REPORT "Skrivningar i
 * arbetskatalogen"): the GOAL is that no write of a test lands in a LIVE data root of a product tree. Product code
 * and tests write to cwd-relative defaults that no setting redirects -- `storage/drafts`
 * (documentGenerator), `storage/manifests/import-qa` (import-librarian-manifest), `tmp-artifacts`,
 * `tests/fixtures/...` -- and with cwd in the demonstrator's worktree that IS the live tree: the
 * demonstrator runs with that cwd. Where a module supports a root setting, the test setup gives it a
 * fresh temp root (testDataRootIsolation.ts); this guard is the in-process backstop for every root, whether
 * or not a setting exists.
 *
 * What it does, exactly (TDG-6: no more than this is claimed): in a test process it wraps the node:fs
 * functions in TEST_DATA_ROOT_GUARDED_FS_CALLS -- sync, callback and promise forms -- and judges the path
 * arguments listed there before the original function runs. A call is refused with a
 * TestDataRootWriteRefusedError (code TEST_DATA_ROOT_WRITE_REFUSED, naming the operation, the path and the
 * root) when a target, judged as written AND through its real path, is inside a protected root -- for a
 * removal, a rename's or a copy's destination and a new link's own path also when it is an ANCESTOR of one,
 * and for a recursive copy every destination path it writes. A target the guard cannot judge (a link chain
 * or loop, an uninspectable ancestor, a device-namespace form, a URL-like object whose href and pathname
 * differ, a byte path that is not UTF-8) is refused the same way (fail-closed). Every other function of
 * node:fs, node:fs/promises and a FileHandle is reviewed in TEST_FS_FUNCTIONS_NOT_GUARDED; a test enumerates
 * the installed Node and fails on a function on neither list. What is proven is what the tests try: the
 * forms in tests/unit/testDbGuardDataRootWriteGuard.test.ts, against FAKE trees. It is a drift guard and a
 * backstop in the process -- not a proof and not an isolation.
 *
 * KNOWN LIMITATIONS (not closed here; TDG-5 and TDG-6):
 *   1. skyddar bara fs-anrop i processen och barn som laddar guardens preload; breda körningar ska ha cwd
 *      utanför arbetsträdet. In words: a child that does not load the Vitest setup file or
 *      server/loadEnvFirst.ts -- cmd `>` / `copy`, bash `tee`, PowerShell `Out-File`, python, git, `node -e`
 *      without loadEnvFirst -- and a worker_threads Worker (its own fs bindings) write unguarded. Broad runs
 *      (sweeps, integration) keep cwd OUTSIDE the worktree (an export).
 *   2. A descriptor or FileHandle that is already open (write, ftruncate, futimes, fchmod -- fchmod lands
 *      even through a READ-only descriptor), and native addons.
 *   3. process.binding('fs') / the internal fs binding: reachable from JavaScript in the process
 *      (writeFileUtf8, mkdir ... write past every wrapper) and not closable from JavaScript. Deliberate
 *      abuse, not a form product code uses.
 *   4. A hard link made OUTSIDE the test process before the run.
 *   5. A recursive removal of a directory that CONTAINS a junction or link into a root: only the top target
 *      is judged; whether Node's native rm follows it is Node's -- NOT tried for real (it would be a real
 *      deletion).
 *   6. Other names of this machine than its own host name and 127.x.x.x (a LAN IP, an FQDN, a hosts
 *      alias), ordinary shares, `subst` and `net use` drives: not mapped lexically, NOT tried; the real-path
 *      pass may resolve some of them.
 *   7. An options or path object whose getters answer differently on each read (a URL-like object is
 *      handed to Node as the string it was judged as; options objects -- flag, recursive, dereference --
 *      are not).
 *   8. Paths over the Win32 limits, POSIX symbolic links of type 'dir' and Linux/macOS: not run here.
 *
 * Protected: every root below under the product tree of this checkout (the repo root this module lives in),
 * under the current working directory when that is a product tree (package.json + server/ + packages/) and
 * under the known live product trees of this workstation; the absolute live locations (data-root fallbacks,
 * the demonstrator's D:\mimer-demo, the archives on H:, D:, E: ...); and the live directories under the home
 * directory (~/.mimers ...), resolved with os.homedir() at run time. A target is compared as written
 * (canonical: \\?\ and \\.\ prefixes, a local administrative share, an NTFS stream suffix and trailing dots
 * removed, case-folded on Windows/macOS) AND, when that is allowed, through its real path (junctions,
 * symbolic links, 8.3 short names) -- and the roots are compared in their own real (long) form too. Reads
 * are never refused. A link TO an ancestor of a root (the tree root, D:\) is not refused when it is made
 * (scripts/audit/devgovPathBranchLock.test.ts makes one to process.cwd()); what is written through it is.
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
  // TDG-6 (TDG5-VERIFICATION finding 13)
  {
    root: '.git',
    why: "the checkout's git directory (in a worktree: its gitdir pointer file) -- history, config, hooks",
  },
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

/** TDG-6: the `protectedRoot` of a refusal the guard could not decide (fail-closed). */
export const UNDECIDABLE_TARGET = '(undecidable)';

export class TestDataRootWriteRefusedError extends Error {
  readonly code = TEST_DATA_ROOT_WRITE_REFUSED;
  constructor(
    readonly operation: string,
    readonly target: string,
    readonly protectedRoot: string,
    /** TDG-6: why the guard could not decide where the write lands (then it is refused, fail-closed). */
    readonly undecidable?: string,
  ) {
    super(
      undecidable
        ? `[${TEST_DB_GUARD_LABEL}] TDG-6 refused ${operation} of ${target}: the guard cannot decide where it ` +
            `would land (${undecidable}), and a test write it cannot judge is refused (fail-closed) -- nothing ` +
            'was written. Use a plain path in a temp directory (fs.mkdtempSync(os.tmpdir())).'
        : `[${TEST_DB_GUARD_LABEL}] TDG-4 refused ${operation} of ${target}: it is inside the live data root ` +
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

/**
 * TDG-6 (TDG5-VERIFICATION finding 8): a Win32 device-namespace form that names neither a drive letter nor a
 * UNC share -- `\\?\GLOBALROOT\GLOBAL??\C:\...` (proven to land), `\\?\Volume{GUID}\...`,
 * `\\.\HarddiskVolumeN\...`, also with forward slashes -- is not mapped to a path lexically. A test write to one
 * is refused as undecidable, wherever it points.
 */
export function unmappedDeviceNamespaceForm(target: string): boolean {
  if (!isWindows) return false;
  const head = /^\\\\[?.]\\([^\\]*)/.exec(target.replace(/\//g, '\\'));
  return head !== null && !/^(?:[A-Za-z]:|UNC)$/i.test(head[1]);
}

const realpathNative = fs.realpathSync.native;
const lstatOriginal = fs.lstatSync;
const readlinkOriginal = fs.readlinkSync;

/** TDG-6: links the real-path lookup follows before the target is undecidable (a loop or a chain). */
export const REAL_PATH_MAX_LINK_HOPS = 32;
/** lstat answers that mean "no such entry here": the lookup goes on with the parent. */
const ABSENT_CODES = new Set(['ENOENT', 'ENOTDIR']);
/**
 * lstat answers for an entry that exists but cannot be inspected right now (Windows: a file pending deletion,
 * an entry locked or denied). Tolerated for the TARGET itself only -- its location is then its parent's real
 * path plus its name -- so a Windows retry on EPERM still sees EPERM; for an ancestor it is undecidable.
 */
const UNINSPECTABLE_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
/** A name that looks like an 8.3 short name (`STORAG~1`): never taken as written when it has no real path. */
const SHORT_NAME = /~\d/;

export type RealTarget = { readonly path: string } | { readonly undecidable: string } | null;

/**
 * The real location a write to `canonical` reaches: the real path of its nearest existing ancestor (a
 * junction, a symbolic link -- dangling ones followed -- or an 8.3 short name resolved) plus the rest.
 * TDG-6 (TDG5-VERIFICATION finding 4): FAIL-CLOSED. It climbs to the nearest existing ancestor WITHOUT a level
 * limit (it used to give up after 64 levels and answer "allowed"); it is `undecidable` -- the write is refused --
 * after more than REAL_PATH_MAX_LINK_HOPS links, for a link that cannot be read, for an ancestor that cannot be
 * inspected, for an 8.3-looking name without a real path, and for any other lookup error. Null only when
 * nothing exists, not even the volume root: nothing can land there. Uses only the unguarded originals.
 */
export function realTargetPath(canonical: string): RealTarget {
  let probe = canonical;
  const rest: string[] = [];
  let hops = 0;
  for (;;) {
    const real = safe(() => realpathNative(probe));
    if (real !== null) return { path: canonicalTargetPath(path.join(real, ...rest)) };
    let stat: fs.Stats | null = null;
    let code: string | null = null;
    try {
      stat = lstatOriginal(probe);
    } catch (error) {
      code = errorCode(error);
    }
    const climb = () => {
      const parent = path.dirname(probe);
      if (parent === probe) return false;
      rest.unshift(path.basename(probe));
      probe = parent;
      return true;
    };
    if (stat?.isSymbolicLink()) {
      hops += 1;
      if (hops > REAL_PATH_MAX_LINK_HOPS)
        return { undecidable: `more than ${REAL_PATH_MAX_LINK_HOPS} links to follow from ${canonical}` };
      let link: string;
      try {
        link = readlinkOriginal(probe);
      } catch (error) {
        return { undecidable: `the link ${probe} cannot be read (${errorCode(error)})` };
      }
      probe = canonicalTargetPath(path.resolve(path.dirname(probe), link));
      continue;
    }
    const isTarget = rest.length === 0;
    if (stat !== null || (code !== null && UNINSPECTABLE_CODES.has(code))) {
      // it exists (or cannot be inspected now) but has no real path
      if (SHORT_NAME.test(path.basename(probe)))
        return { undecidable: `${probe} looks like an 8.3 short name and has no real path` };
      if (stat === null && !isTarget) return { undecidable: `the ancestor ${probe} cannot be inspected (${code})` };
      if (!climb()) return { undecidable: `the volume root ${probe} has no real path` };
      continue;
    }
    if (code !== null && !ABSENT_CODES.has(code)) return { undecidable: `${code} looking up ${probe}` };
    if (!climb()) return null; // not even the volume root exists: nothing can land there
  }
}

const rootRealForms = new Map<string, string | null>();
/**
 * TDG-6 (finding 4): a protected root's own real path when it differs from the root as written (an 8.3 name
 * or a junction in the root's own path) -- the real target is compared with roots in their long form too.
 * Memoized per process; only a metadata lookup of the root's existing part, never a listing, never a write.
 */
function rootRealForm(root: string): string | null {
  const key = norm(root);
  if (!rootRealForms.has(key)) {
    if (rootRealForms.size > 20_000) rootRealForms.clear();
    const real = realTargetPath(canonicalTargetPath(root));
    rootRealForms.set(key, real !== null && 'path' in real && norm(real.path) !== key ? real.path : null);
  }
  return rootRealForms.get(key) ?? null;
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
  /** TDG-6: set when the guard could not decide where the write lands -- it is refused (fail-closed). */
  readonly undecidable?: string;
};

const undecidableRefusal = (operation: string, target: string, why: string): WriteRefusal => ({
  operation,
  target,
  protectedRoot: UNDECIDABLE_TARGET,
  undecidable: why,
});

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
  if (unmappedDeviceNamespaceForm(target))
    return undecidableRefusal(operation, target, 'a device-namespace path that names no drive and no UNC share');
  const lexical = canonicalTargetPath(target);
  const refusal = decide(operation, kind, lexical, target, trees, testFile, false);
  if (refusal || options.resolveLinks === false) return refusal;
  // TDG-6 (finding 4): the real path is fail-closed, and it is compared with every root in its long form too
  const real = realTargetPath(lexical);
  if (real === null) return null; // nothing exists there, not even the volume root: nothing can land
  if ('undecidable' in real) return undecidableRefusal(operation, path.resolve(target), real.undecidable);
  return decide(operation, kind, real.path, target, trees, testFile, true);
}

type RootEntry = { readonly abs: string; readonly root: string; readonly inTree: boolean };

/** Every protected root now, normalized; with `realForms`, also by its real path where that differs. */
function rootEntries(trees: readonly string[], realForms: boolean): RootEntry[] {
  const entries: RootEntry[] = [];
  const add = (root: string, inTree: boolean) => {
    entries.push({ abs: norm(root), root, inTree });
    const real = realForms ? rootRealForm(root) : null;
    if (real !== null) entries.push({ abs: norm(real), root, inTree });
  };
  for (const tree of trees) for (const { root } of TEST_PROTECTED_RELATIVE_ROOTS) add(path.join(tree, root), true);
  for (const root of protectedAbsoluteRootsNow()) add(root, false);
  return entries;
}

function decide(
  operation: string,
  kind: WriteKind,
  candidate: string,
  original: string,
  trees: readonly string[],
  testFile: string | null,
  realForms: boolean,
): WriteRefusal | null {
  const abs = norm(candidate);
  for (const entry of rootEntries(trees, realForms)) {
    const inside = isInsideOrSame(abs, entry.abs);
    const ancestor = reachesAncestors(kind) && isInsideOrSame(entry.abs, abs);
    if (!inside && !ancestor) continue;
    if (inside && entry.inTree && isExcepted(abs, kind, trees, testFile, realForms)) continue;
    return { operation, target: path.resolve(original), protectedRoot: entry.root };
  }
  return null;
}

/**
 * An exception allows `write` of exactly its file and `mkdir` of exactly the file's own ancestors, only
 * while its owner test file runs -- the owner compared by its FULL path, never by its name. A uniquely named
 * directory (mkdtemp), a removal, a recursive copy or a link is never excepted. In the real-path pass the
 * exception's file is also compared by its real path.
 */
function isExcepted(
  abs: string,
  kind: WriteKind,
  trees: readonly string[],
  testFile: string | null,
  realForms: boolean,
): boolean {
  if ((kind !== 'write' && kind !== 'mkdir') || !testFile) return false;
  const testAbs = norm(canonicalTargetPath(testFile));
  for (const tree of trees) {
    for (const exception of TEST_DATA_ROOT_WRITE_EXCEPTIONS) {
      if (testAbs !== norm(path.join(tree, exception.testFile))) continue;
      const file = path.join(tree, exception.path);
      const real = realForms ? rootRealForm(file) : null;
      for (const allowed of real === null ? [norm(file)] : [norm(file), norm(real)]) {
        if (kind === 'write' && abs === allowed) return true;
        // creating the exception's own parent directories -- nothing beside them
        if (kind === 'mkdir' && abs !== allowed && isInsideOrSame(allowed, abs)) return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------------------------------
// Installation: patches node:fs (sync, callback) and node:fs/promises, then syncs the ESM named exports.

type AnyFn = (...args: unknown[]) => unknown;
const GUARD_MARK = Symbol.for('mimer.testDbGuard.dataRootWriteGuard');

/** How a call names a target: no path (a descriptor, a FileHandle -- or a value Node itself refuses), a path, or undecidable. */
type PathArgument =
  | { readonly kind: 'none' }
  | { readonly kind: 'path'; readonly path: string; readonly substitute: boolean }
  | { readonly kind: 'undecidable'; readonly why: string };

const NO_PATH: PathArgument = Object.freeze({ kind: 'none' });

/** Node's own test (internal/url isURL): such an object is turned into a path with fileURLToPath, never read as bytes. */
function isUrlLike(value: object): boolean {
  const v = value as { href?: unknown; protocol?: unknown; auth?: unknown; path?: unknown };
  return Boolean(v.href && v.protocol && v.auth === undefined && v.path === undefined);
}

/**
 * TDG-6 (TDG5-VERIFICATION findings 2 and 6): the ONE normalizer of a path argument, in Node's order --
 *   - a string;
 *   - a URL or a URL-like object (what Node accepts as one): the path Node itself computes from it
 *     (fileURLToPath reads hostname and pathname). Its href must name the same path, else it is undecidable;
 *     an object that is not a plain node:url URL is handed to Node as the judged string (`substitute`), so a
 *     getter cannot answer differently after the decision;
 *   - any byte view (Buffer, Uint8Array -- Node takes these -- and every other TypedArray or DataView, which
 *     Node refuses): its bytes as UTF-8; bytes that are not valid UTF-8 are undecidable;
 *   - anything else (a descriptor, a FileHandle): no path -- already opened, nothing new is reached.
 * A path with a NUL is no path either: Node refuses it before any file-system call.
 */
function pathArgument(value: unknown): PathArgument {
  if (typeof value === 'string') return value.includes('\u0000') ? NO_PATH : { kind: 'path', path: value, substitute: false };
  if (value === null || typeof value !== 'object') return NO_PATH;
  try {
    if (isUrlLike(value)) {
      const plainUrl = Object.getPrototypeOf(value) === NodeURL.prototype && Reflect.ownKeys(value).length === 0;
      let viaNode: string;
      try {
        viaNode = fileURLToPath(value as URL);
      } catch {
        // Node refuses the same plain URL the same way (a non-file: URL); any other object is not trusted to
        return plainUrl
          ? NO_PATH
          : { kind: 'undecidable', why: 'a URL-like object Node cannot turn into a path' };
      }
      let viaHref: string | null;
      try {
        viaHref = fileURLToPath(String((value as { href: unknown }).href));
      } catch {
        viaHref = null;
      }
      if (viaHref === null || norm(viaHref) !== norm(viaNode))
        return { kind: 'undecidable', why: 'a URL-like object whose href and hostname/pathname name different paths' };
      return viaNode.includes('\u0000') ? NO_PATH : { kind: 'path', path: viaNode, substitute: !plainUrl };
    }
  } catch {
    return { kind: 'undecidable', why: 'a path object whose properties cannot be read' };
  }
  if (ArrayBuffer.isView(value)) {
    const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) return { kind: 'undecidable', why: 'a byte path that is not UTF-8' };
    return text.includes('\u0000') ? NO_PATH : { kind: 'path', path: text, substitute: false };
  }
  return NO_PATH;
}

/** A path argument for a message: never an object dump. */
function describePathArgument(value: unknown): string {
  if (typeof value === 'string') return value;
  if (ArrayBuffer.isView(value)) return `<${value.constructor.name} path>`;
  return '<URL-like path object>';
}

function isWriteFlag(flags: unknown): boolean {
  if (typeof flags === 'string') return /[wa+]/.test(flags);
  if (typeof flags === 'number') {
    const c = fs.constants;
    return (flags & (c.O_WRONLY | c.O_RDWR | c.O_CREAT | c.O_TRUNC | c.O_APPEND)) !== 0;
  }
  return false;
}

/** The `flag` (readFile) or `flags` (createReadStream) of an options object; a string option is an encoding. */
const optionFlag = (options: unknown, key: 'flag' | 'flags'): unknown =>
  options !== null && typeof options === 'object' ? (options as Record<string, unknown>)[key] : undefined;

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

const writesByFlag = (at: number, key?: 'flag' | 'flags') => (args: unknown[]) =>
  isWriteFlag(key ? optionFlag(args[at], key) : args[at]);

/** Which argument of which function is a target, and how it is written. */
const CHECKS: Record<string, readonly Check[]> = {
  writeFile: [{ index: 0, kind: 'write' }],
  appendFile: [{ index: 0, kind: 'write' }],
  truncate: [{ index: 0, kind: 'write' }],
  // TDG-6 (TDG5-VERIFICATION finding 1): readFile with flag w/w+/a/a+/r+ creates or truncates -- Node opens
  // it through the binding, past the guarded fs.open
  readFile: [{ index: 0, kind: 'write', when: writesByFlag(1, 'flag') }],
  mkdir: [{ index: 0, kind: 'mkdir' }],
  mkdtemp: [{ index: 0, kind: 'mkdtemp' }],
  // TDG-6 (finding 5): Node 24's disposable variants make the same uniquely named directory
  mkdtempDisposable: [{ index: 0, kind: 'mkdtemp' }],
  copyFile: [{ index: 1, kind: 'write' }],
  // TDG-5 (finding 3): a recursive copy onto an ANCESTOR of a root lands in it (Node's cpSync copies a
  // directory natively, past every JS-level function). TDG-6 (TDG5-VERIFICATION finding 3): and every path a
  // recursive copy writes is judged too (recursiveCopyRefusal) -- a destination that CONTAINS a link to an
  // ancestor of a root is written through that link.
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
  // A symbolic link or junction INTO a root is an alias for writing it; a link placed in a root changes it.
  // TDG-6: a link to an ANCESTOR of a root (the tree root, D:\) is NOT refused when it is made -- a test makes
  // one (scripts/audit/devgovPathBranchLock.test.ts: a junction to process.cwd()); every write THROUGH it is
  // judged by its real path instead, and a recursive copy by every path it writes.
  symlink: [
    { index: 0, kind: 'write', relativeToDirOf: 1 },
    { index: 1, kind: 'tree' },
  ],
  rm: [{ index: 0, kind: 'remove' }],
  rmdir: [{ index: 0, kind: 'remove' }],
  unlink: [{ index: 0, kind: 'remove' }],
  open: [{ index: 0, kind: 'write', when: writesByFlag(1) }],
  createWriteStream: [{ index: 0, kind: 'write' }],
  // TDG-6 (finding 1): a read stream opened with a write flag (it also opens through fs.open, guarded too)
  createReadStream: [{ index: 0, kind: 'write', when: writesByFlag(1, 'flags') }],
  // TDG-5 (finding 9): metadata of a live file
  utimes: [{ index: 0, kind: 'write' }],
  lutimes: [{ index: 0, kind: 'write' }],
  chmod: [{ index: 0, kind: 'write' }],
  lchmod: [{ index: 0, kind: 'write' }],
  chown: [{ index: 0, kind: 'write' }],
  lchown: [{ index: 0, kind: 'write' }],
};

/** TDG-6: the guarded functions -- base name -> how each argument is judged (sync, callback and promise forms alike). Locked by the write-guard test. */
export const TEST_DATA_ROOT_GUARDED_FS_CALLS: Readonly<Record<string, readonly string[]>> = Object.freeze(
  Object.fromEntries(
    Object.entries(CHECKS).map(([name, checks]) => [
      name,
      Object.freeze([
        ...checks.map(
          (c) =>
            `${c.index}:${c.kind}` +
            (c.when ? ' if its flag writes' : '') +
            (c.relativeToDirOf !== undefined ? ' (a relative target also against the link)' : ''),
        ),
        ...(name === 'cp' ? ['1:tree for every path a recursive copy writes'] : []),
      ]),
    ]),
  ),
);

/**
 * REVIEWED (TDG-6, TDG5-VERIFICATION finding 1): every function of node:fs, node:fs/promises and a FileHandle
 * that the guard does NOT wrap, with the reason it cannot create, change or remove a file by a path. The
 * write-guard test enumerates the three surfaces of the INSTALLED Node and fails on a function that is on
 * neither side -- a new Node API (as mkdtempDisposable in Node 24) is a decision, never a silent pass. An entry
 * that this Node does not have is kept (another Node version may have it).
 */
const READS = 'reads by its path: opens nothing for writing, creates, changes or removes nothing';
const BY_FD =
  'works on a descriptor or handle that is already open: no path, nothing new is reached (the open itself is guarded) -- KNOWN LIMITATION 2: metadata through a read-only descriptor is not seen';
const STREAM_CLASS =
  'a stream class: it opens its path through fs.open/fs.openSync (and fs.mkdir) looked up on node:fs when it is made, i.e. the guarded ones (pinned by the TDG-6 stream test)';
const DATA_CLASS = 'a data class (an entry, a stat result, an open directory): no file-system call by a path of its own';
const HANDLE_METHOD =
  'a FileHandle method: works on the handle the guarded fs.promises.open opened (a write handle into a root was refused there) -- KNOWN LIMITATION 2 for metadata through a read handle';
export const TEST_FS_FUNCTIONS_NOT_GUARDED: Readonly<Record<string, string>> = Object.freeze({
  // node:fs -- by path, reading only
  'fs.access': READS,
  'fs.accessSync': READS,
  'fs.exists': READS,
  'fs.existsSync': READS,
  'fs.lstat': READS,
  'fs.lstatSync': READS,
  'fs.stat': READS,
  'fs.statSync': READS,
  'fs.statfs': READS,
  'fs.statfsSync': READS,
  'fs.readdir': READS,
  'fs.readdirSync': READS,
  'fs.opendir': READS,
  'fs.opendirSync': READS,
  'fs.readlink': READS,
  'fs.readlinkSync': READS,
  'fs.realpath': READS,
  'fs.realpathSync': READS,
  'fs.realpath.native': READS,
  'fs.realpathSync.native': READS,
  'fs.glob': READS,
  'fs.globSync': READS,
  'fs.watch': READS,
  'fs.watchFile': READS,
  'fs.unwatchFile': 'stops a watcher: no file-system write',
  'fs.openAsBlob': 'reads a file into a Blob: opens it for reading only',
  // node:fs -- by descriptor
  'fs.close': BY_FD,
  'fs.closeSync': BY_FD,
  'fs.fchmod': BY_FD,
  'fs.fchmodSync': BY_FD,
  'fs.fchown': BY_FD,
  'fs.fchownSync': BY_FD,
  'fs.fdatasync': BY_FD,
  'fs.fdatasyncSync': BY_FD,
  'fs.fstat': BY_FD,
  'fs.fstatSync': BY_FD,
  'fs.fsync': BY_FD,
  'fs.fsyncSync': BY_FD,
  'fs.ftruncate': BY_FD,
  'fs.ftruncateSync': BY_FD,
  'fs.futimes': BY_FD,
  'fs.futimesSync': BY_FD,
  'fs.read': BY_FD,
  'fs.readSync': BY_FD,
  'fs.readv': BY_FD,
  'fs.readvSync': BY_FD,
  'fs.write': BY_FD,
  'fs.writeSync': BY_FD,
  'fs.writev': BY_FD,
  'fs.writevSync': BY_FD,
  // node:fs -- classes and helpers
  'fs.ReadStream': STREAM_CLASS,
  'fs.FileReadStream': STREAM_CLASS,
  'fs.WriteStream': STREAM_CLASS,
  'fs.FileWriteStream': STREAM_CLASS,
  'fs.Utf8Stream': STREAM_CLASS,
  'fs.Dir': DATA_CLASS,
  'fs.Dirent': DATA_CLASS,
  'fs.Stats': DATA_CLASS,
  'fs._toUnixTimestamp': 'converts a date to seconds: no file-system call at all',
  // node:fs/promises -- by path, reading only
  'fs.promises.access': READS,
  'fs.promises.lstat': READS,
  'fs.promises.stat': READS,
  'fs.promises.statfs': READS,
  'fs.promises.readdir': READS,
  'fs.promises.opendir': READS,
  'fs.promises.readlink': READS,
  'fs.promises.realpath': READS,
  'fs.promises.glob': READS,
  'fs.promises.watch': READS,
  // a FileHandle (fs.promises.open)
  'FileHandle.constructor': 'the FileHandle class: made by the guarded fs.promises.open only, it names no new path',
  'FileHandle.getAsyncId': 'an id for async hooks: no file-system call at all',
  'FileHandle.close': HANDLE_METHOD,
  'FileHandle.appendFile': HANDLE_METHOD,
  'FileHandle.chmod': HANDLE_METHOD,
  'FileHandle.chown': HANDLE_METHOD,
  'FileHandle.datasync': HANDLE_METHOD,
  'FileHandle.sync': HANDLE_METHOD,
  'FileHandle.read': HANDLE_METHOD,
  'FileHandle.readv': HANDLE_METHOD,
  'FileHandle.readFile': HANDLE_METHOD,
  'FileHandle.readLines': HANDLE_METHOD,
  'FileHandle.readableWebStream': HANDLE_METHOD,
  'FileHandle.createReadStream': HANDLE_METHOD,
  'FileHandle.createWriteStream': HANDLE_METHOD,
  'FileHandle.stat': HANDLE_METHOD,
  'FileHandle.truncate': HANDLE_METHOD,
  'FileHandle.utimes': HANDLE_METHOD,
  'FileHandle.write': HANDLE_METHOD,
  'FileHandle.writev': HANDLE_METHOD,
  'FileHandle.writeFile': HANDLE_METHOD,
});

const readdirOriginal = fs.readdirSync;
const statOriginal = fs.statSync;
/** More entries than this in one recursive copy: undecidable (fail-closed). */
const RECURSIVE_COPY_ENTRY_LIMIT = 50_000;

/**
 * TDG-6 (TDG5-VERIFICATION finding 3): a recursive copy of a directory writes `dest/<rel>` for every entry
 * `<rel>` under the source -- through any link that already exists in the destination (Node's copy follows a
 * junction there: a link in `dest` to an ancestor of a root lands the copy in the root). Each of those paths
 * is judged like a destination of its own (kind `tree`, real path included). The source is only listed, with
 * the unguarded originals; its links are followed only with `dereference`, as Node does.
 */
function recursiveCopyRefusal(operation: string, args: unknown[]): WriteRefusal | null {
  const src = pathArgument(args[0]);
  const dest = pathArgument(args[1]);
  if (src.kind !== 'path' || dest.kind !== 'path') return null; // judged above, or Node refuses it
  const options = (args[2] !== null && typeof args[2] === 'object' ? args[2] : {}) as { dereference?: unknown };
  const dereference = options.dereference === true;
  const top = safe(() => (dereference ? statOriginal(src.path) : lstatOriginal(src.path)));
  if (!top?.isDirectory()) return null; // a file (its destination is judged above) or nothing (Node fails)
  const seen = new Set<string>();
  const stack: Array<readonly [string, string]> = [[src.path, dest.path]];
  let entries = 0;
  while (stack.length > 0) {
    const [fromDir, toDir] = stack.pop() as readonly [string, string];
    if (dereference) {
      const real = safe(() => norm(realpathNative(fromDir)));
      if (real === null) return undecidableRefusal(operation, toDir, `the copy's source ${fromDir} has no real path`);
      if (seen.has(real)) continue;
      seen.add(real);
    }
    let listed: fs.Dirent[];
    try {
      listed = readdirOriginal(fromDir, { withFileTypes: true });
    } catch (error) {
      return undecidableRefusal(operation, toDir, `the copy's source ${fromDir} cannot be listed (${errorCode(error)})`);
    }
    for (const entry of listed) {
      entries += 1;
      if (entries > RECURSIVE_COPY_ENTRY_LIMIT)
        return undecidableRefusal(operation, dest.path, `more than ${RECURSIVE_COPY_ENTRY_LIMIT} entries to copy`);
      const from = path.join(fromDir, entry.name);
      const to = path.join(toDir, entry.name);
      const refusal = testDataRootWriteRefusal(operation, 'tree', to);
      if (refusal) return refusal;
      const isDirectory =
        entry.isDirectory() ||
        (dereference && entry.isSymbolicLink() && Boolean(safe(() => statOriginal(from))?.isDirectory()));
      if (isDirectory) stack.push([from, to]);
    }
  }
  return null;
}

const errorCode = (error: unknown): string => {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' ? code : 'an unknown error';
};

const toError = (refusal: WriteRefusal) =>
  new TestDataRootWriteRefusedError(refusal.operation, refusal.target, refusal.protectedRoot, refusal.undecidable);

/**
 * The decision for one call: the refusal, or the arguments to call Node with (a URL-like object that is not a
 * plain URL is replaced by the path it was judged as, so Node writes exactly what was judged).
 */
function judgeCall(name: string, args: unknown[]): { readonly error: Error | null; readonly args: unknown[] } {
  const base = name.replace(/Sync$/, '');
  const operation = `fs.${name}`;
  let callArgs = args;
  for (const check of CHECKS[base] ?? []) {
    if (check.when && !check.when(args)) continue;
    const target = pathArgument(args[check.index]);
    if (target.kind === 'none') continue;
    if (target.kind === 'undecidable')
      return {
        error: toError(undecidableRefusal(operation, describePathArgument(args[check.index]), target.why)),
        args,
      };
    if (target.substitute) {
      if (callArgs === args) callArgs = [...args];
      callArgs[check.index] = target.path;
    }
    const targets = [target.path];
    if (check.relativeToDirOf !== undefined && !path.isAbsolute(target.path)) {
      const link = pathArgument(args[check.relativeToDirOf]);
      if (link.kind === 'path') targets.push(path.resolve(path.dirname(path.resolve(link.path)), target.path));
    }
    for (const candidate of targets) {
      const refusal = testDataRootWriteRefusal(operation, check.kind, candidate);
      if (refusal) return { error: toError(refusal), args };
    }
  }
  if (base === 'cp') {
    const refusal = recursiveCopyRefusal(operation, callArgs);
    if (refusal) return { error: toError(refusal), args };
  }
  return { error: null, args: callArgs };
}

function wrap(
  target: Record<string, unknown>,
  name: string,
  style: 'sync' | 'callback' | 'promise' | 'stream',
): void {
  const original = target[name];
  if (typeof original !== 'function') return;
  const guarded = function guardedFsCall(this: unknown, ...args: unknown[]): unknown {
    const { error, args: callArgs } = judgeCall(name, args);
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
    return (original as AnyFn).apply(this, callArgs);
  };
  Object.defineProperty(guarded, 'name', { value: (original as AnyFn).name });
  // TDG-6: the mark the enumeration test reads (a wrapped function is guarded, every other one is reviewed)
  Object.defineProperty(guarded, GUARD_MARK, { value: true });
  target[name] = guarded;
}

const BASES = Object.keys(CHECKS);
const STREAM_BASES = new Set(['createWriteStream', 'createReadStream']);

/**
 * Idempotent. Installs the write guard on node:fs and node:fs/promises in this process.
 *
 * KNOWN LIMITATION: skyddar bara fs-anrop i processen och barn som laddar guardens preload; breda körningar
 * ska ha cwd utanför arbetsträdet (see the module comment: children that do not load the Vitest setup file
 * or server/loadEnvFirst.ts, shell redirection, worker_threads, already opened descriptors and
 * process.binding('fs') are outside).
 */
export function installTestDataRootWriteGuard(): void {
  const fsObj = fs as unknown as Record<string | symbol, unknown>;
  if (fsObj[GUARD_MARK]) return;
  for (const base of BASES) {
    if (STREAM_BASES.has(base)) {
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
