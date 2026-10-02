import { mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isCasEnvKey } from './testCasIsolation';
import { TEST_DB_GUARD_LABEL } from './testDatabaseTargetPolicy';

/**
 * TEST-DB-GUARD (OD-K0-5), TDG-4 (owner decision 2026-10-03 (4) point 8): a test never inherits ANY
 * live, mutable data root -- not only the CAS (TDG-3). A data root set in the caller's shell (or an
 * env file) went as it was to the Vitest workers, to every process a test starts, to the Playwright
 * runner and its servers; and a key left unset makes the code fall back to its DEFAULT location,
 * which is cwd-relative (`.quarantine`, `.data/admin-role-grants`, `storage/import-archive` ...) or
 * an absolute live path (`H:\...\GEO_Master_Archive`, `C:\Users\...\Downloads` ...) -- with cwd in a
 * product worktree that is the live tree.
 *
 * The ONE declarative list below names every data-root key product code reads (derived from the
 * code by tests/unit/testDbGuardDataRootInventory.scan.mjs; the inventory test
 * tests/unit/testDbGuardDataRootInventory.test.ts fails when a key is read that is neither here nor,
 * reviewed, on the list of keys that are not data roots). In a test process every listed key -- and,
 * as in TDG-3, every CAS key (MIMERS_*, *_CAS*) -- is removed from the inherited environment, then:
 *
 *   - `fresh-temp-root`: the key is set to a NEW directory path inside a temp directory created by
 *     this run (absolute; one run directory per Vitest test file, one per Playwright run for its
 *     servers). Required for every key whose unset default is a LOCATION -- otherwise removing it
 *     would send the code to that default. The directory itself is not created (the code creates
 *     what it writes, exactly as it does for its default), only the run directory is.
 *   - `removed`: the key stays unset. Allowed only where unset means no location at all: the code
 *     fails closed or the feature is off (e.g. MIMERS_ROOT: U30-A refuses to start without it; a
 *     test that needs a CAS creates its own temp root), or the key is a mode/flag, not a path.
 *   - `remote-store` (TDG-5): a REMOTE bucket (GCS_DOCUMENTS_BUCKET, BACKUP_S3_BUCKET, and by pattern
 *     every *_BUCKET* key): never given any value in a test process, and also removed by
 *     server/loadEnvFirst.ts in every test runtime -- so a bucket never reaches a tested server, however
 *     that server was started (the E2E API server is a MIMER_TEST_MODE process). Unset, the code stores
 *     locally (documentObjectStorage) or skips the upload (backupService); the local paths are guarded.
 *
 * Every key has exactly ONE handling (the inventory test checks it). Keys are matched without regard
 * to case (Windows environment names are case-insensitive: `Quarantine_Root` is QUARANTINE_ROOT).
 *
 * Env files: a test runtime never takes any of these keys from an env file either (server/loadEnv.ts,
 * the dotenv guard in installTestDatabaseConnectionGuard.ts), so `.env`/`.env.test` cannot refill
 * what was scrubbed. Outside a test runtime nothing here runs: product behaviour is unchanged.
 */

export type TestDataRootEnvHandling = 'fresh-temp-root' | 'removed' | 'remote-store';

export type TestDataRootEnvEntry = {
  readonly key: string;
  readonly handling: TestDataRootEnvHandling;
  /** Where the unset default leads (for `fresh-temp-root`) or why unset is safe (for `removed`). */
  readonly why: string;
};

const fresh = (key: string, why: string): TestDataRootEnvEntry => ({ key, handling: 'fresh-temp-root', why });
const removed = (key: string, why: string): TestDataRootEnvEntry => ({ key, handling: 'removed', why });
const remote = (key: string, why: string): TestDataRootEnvEntry => ({ key, handling: 'remote-store', why });

export const TEST_DATA_ROOT_ENV: readonly TestDataRootEnvEntry[] = Object.freeze([
  fresh(
    'ADMIN_ROLE_GRANT_CAS_ROOT',
    "unset: '.data/admin-role-grants' under cwd (server/services/adminRoleGrantService.ts)",
  ),
  fresh(
    'ARCHIVE_SHADOW_ROOT',
    "unset: 'C:\\miljöbeslut\\storage\\geo_master_archive' (scripts/ops/diagnose-archive-root-divergence.mjs)",
  ),
  fresh('BACKUP_DIR', "unset: '/tmp/miljobeslut-backups' (server/services/backupService.ts)"),
  fresh(
    'GEODATA_DIR',
    'unset: <MASTER_ARCHIVE_ROOT>/Data/legacy_adopted (scripts/import/import-d-geodata-vectors.ts)',
  ),
  fresh('GEO_INLARNING_DIR', 'unset: <PATHS.DATA>/MCF (scripts/import/import-stability-mapping.ts)'),
  fresh(
    'HARVEST_QUARANTINE_ROOT',
    "unset: '.quarantine' under cwd (packages/mps-data-governance/scripts/harvest-live-pilot.ts); TDG-5",
  ),
  fresh(
    'GEO_MASTER_ARCHIVE',
    "unset: 'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive' (scripts/import/config/mimersBrunn.ts and others)",
  ),
  fresh(
    'H_DRIVE_ROOT',
    "unset: 'H:\\...\\GEO_Master_Archive' or 'storage/master-archive' under cwd (scripts/import/*)",
  ),
  fresh(
    'IMPORT_ARCHIVE_ROOT',
    "unset: 'storage/import-archive' under cwd (server/services/importPathService.ts)",
  ),
  fresh(
    'IMPORT_CACHE_ROOT',
    "unset: 'storage/import-cache' under cwd (server/services/importPathService.ts)",
  ),
  fresh('IMPORT_SOURCE_ROOT', "unset: 'downloads' under cwd (server/services/importPathService.ts)"),
  fresh(
    'INGEST_GPKG_ROOT',
    "unset: 'D:\\ingest-arkiv-2026-03-29\\dataportal-env' (scripts/import/import-ingest-gpkg-batch.ts)",
  ),
  fresh(
    'KNOWLEDGE_BASE_ROOT',
    "unset: 'dossiers/knowledge_base' under cwd (server/services/importPathService.ts)",
  ),
  fresh(
    'LASTKAJEN_INGEST_ROOT',
    "unset: 'storage/ingest/lastkajen' under the repo root (scripts/import/import-lastkajen-all-downloaded.ts)",
  ),
  fresh(
    'LOCAL_STAGING_DIR',
    'unset: a fixed directory under os.tmpdir() shared by every run (scripts/import/harvest-sks-markfuktighet.ts)',
  ),
  fresh(
    'MASTER_ARCHIVE_ROOT',
    "unset: 'C:\\miljöbeslut\\storage\\geo_master_archive', 'M:\\' or GEO_MASTER_ARCHIVE's default (scripts/import/*)",
  ),
  fresh(
    'OPS_PIPELINE_ROOT',
    "unset: '../Miljobeslut_Ops_Pipeline' next to cwd, a ternary fallback (scripts/ops/evaluate-ops-pipeline.ts); TDG-5, was removed",
  ),
  fresh(
    'OUTLOOK_BASE_DIR',
    "unset: 'D:\\Users\\jimmy\\Desktop\\OutlookExport' (scripts/backfill/run-outlook-ingest-pipeline.ts)",
  ),
  fresh(
    'OUTLOOK_MANIFEST_PATH',
    'unset: <OUTLOOK_BASE_DIR>\\manifest.csv (scripts/backfill/run-outlook-ingest-pipeline.ts)',
  ),
  fresh(
    'OUTLOOK_STORAGE_ROOT',
    "unset: '/tmp/outlook-attachments' (server/services/outlookSchedulerService.ts)",
  ),
  fresh(
    'QUARANTINE_ROOT',
    "unset: '.quarantine' under cwd (server/routes/governance.routes.ts) or next to the master archive (scripts/import/harvest/harvestRuntime.ts)",
  ),
  fresh(
    'SGU_DISCOVERED_MANIFEST_PATH',
    "unset: 'storage/ingest/sgu/discovered-manifest.json' under the repo root, the LIVE manifest (server/datasources/sguBulkImportManifest.ts); a fresh path is missing, so a Vitest run takes the fixture; TDG-5, was removed",
  ),
  fresh(
    'SGU_DOWNLOAD_DIR',
    "unset: 'C:\\Users\\jimmy\\Downloads' (scripts/import/sguBulkImportEngine.ts, discover-sgu-downloads.ts)",
  ),
  fresh(
    'SGU_JORDART_RASTER_DIR',
    "unset: 'storage/...' under cwd (server/services/sguJordartRasterService.ts DEFAULT_RASTER_DIR)",
  ),
  removed(
    'IMPORT_REIMPORT_SCAN_ROOTS',
    "unset: '' -- no extra scan roots (server/services/importPathService.ts)",
  ),
  removed(
    'LOCAL_DB_ROOT',
    "unset: '' -- the local DB lookup is off (server/services/openDataSourceService.ts, searchService.ts)",
  ),
  removed(
    'LU_MPS_CAS',
    'a CAS mode selector (memory), not a path (packages/mps-runtime/src/mimers/MimersIntegration.ts); TDG-3',
  ),
  removed('MIMERS_DURABILITY_MODE', "a durability mode ('best-effort'), not a path; TDG-3"),
  removed('MIMERS_NFS_ROOT', 'unset: the NFS proofs skip (scripts/mimers/prove-nfs-failover.ts); TDG-3'),
  removed('MIMERS_REQUIRED', 'a flag, not a path; TDG-3'),
  removed('MIMERS_REQUIRE_LINUX_STRICT', 'a flag, not a path; TDG-3'),
  removed(
    'MIMERS_ROOT',
    'unset: U30-A fails closed (MIMERS_ROOT_REQUIRED), no fallback; a test that needs a CAS creates its own temp root (tests/setup/casTestIsolationRoot.ts); the E2E API server gets a fresh existing one; TDG-3',
  ),
  removed(
    'MUNICIPAL_CONTACTS_CSV_PATH',
    "unset: '' -- falls back to LOCAL_DB_ROOT, itself removed (server/services/openDataSourceService.ts)",
  ),
  removed(
    'NMD_RASTER_PATH',
    "unset: '' -- the NMD raster lookup is off (server/services/nmdService.ts, markCoverService.ts)",
  ),
  removed(
    'OUTLOOK_FOLDER_PATH',
    'unset: the Outlook scheduler and status report it as not configured (server/services/outlookSchedulerService.ts, fullStatusService.ts)',
  ),
  removed('SMOKE_JSON_OUT', 'unset: the smoke scripts write no JSON report (scripts/smoke/*)'),
  remote(
    'BACKUP_S3_BUCKET',
    'a remote S3 bucket: unset, backupService skips the off-site upload (server/services/backupService.ts); TDG-5',
  ),
  remote(
    'GCS_DOCUMENTS_BUCKET',
    'a remote GCS bucket: unset, uploads are stored locally under the guarded storage/ (server/services/documentObjectStorage.ts); TDG-5',
  ),
]);

/**
 * REVIEWED: keys whose NAME looks like a data root (a ROOT/PATH/DIR/DATA/OUT ... token) but that name no
 * live, mutable data location -- a binary, a certificate or font that is only read, a remote path, key
 * material, a version or an id. They are not scrubbed. The inventory test
 * (tests/unit/testDbGuardDataRootInventory.test.ts) derives every such key from the code, requires each to
 * be here or on TEST_DATA_ROOT_ENV, and locks this list: a new entry fails it until the lock is changed in
 * review.
 */
export const TEST_ENV_KEYS_NOT_DATA_ROOTS: readonly { readonly key: string; readonly why: string }[] =
  Object.freeze([
    { key: 'ALLOW_SEARCH_MANIFEST_PATH_OVERRIDE', why: 'a flag (search/datasource routes), not a path' },
    { key: 'BANKID_CA_PATH', why: 'a CA certificate, only read (bankIdService, security/env)' },
    { key: 'BANKID_CERT_PATH', why: 'a client certificate, only read' },
    { key: 'BANKID_KEY_PATH', why: 'a client key file, only read' },
    { key: 'BANKID_PFX_PATH', why: 'a PFX bundle, only read' },
    {
      key: 'GDAL_BIN_PATH',
      why: 'the GDAL binaries directory (nmdService, sguJordartRasterService), only executed',
    },
    {
      key: 'GDAL_DATA',
      why: "GDAL's own library data, set by import scripts for the GDAL child, only read by GDAL",
    },
    {
      key: 'GDAL_HTTP_HEADER_FILE',
      why: 'a header file GDAL reads for its HTTP requests, set for the GDAL child (scripts/import/import-lantmateriet.ts)',
    },
    {
      key: 'GDAL_TRANSLATE',
      why: 'the gdal_translate binary, only executed (scripts/db/promote-raster-cog.mjs)',
    },
    {
      key: 'INTERACTIONS_STORE',
      why: "an on/off flag ('true'/'false') for storing AI interactions, not a path",
    },
    {
      key: 'LEGAL_RERANKER_PROMPT_FILE',
      why: 'a prompt file, only read (server/services/rerankPromptService.ts)',
    },
    { key: 'LOG_LEVEL', why: 'a log level, not a path (server/logger.ts)' },
    {
      key: 'LIMS_SFTP_PATH',
      why: 'a path on the remote LIMS SFTP server, not on this machine (scripts/smoke)',
    },
    { key: 'LU_EXECUTION_AUTHORITY_ROOT_KEY_ID', why: 'ROOT = trust root: a key id, not a location' },
    {
      key: 'LU_EXECUTION_AUTHORITY_ROOT_PRIVATE_KEY_PEM',
      why: 'ROOT = trust root: key material, not a location',
    },
    {
      key: 'LU_EXECUTION_AUTHORITY_ROOT_PUBLIC_KEY_PEM',
      why: 'ROOT = trust root: key material, not a location',
    },
    { key: 'MCF_OUTPUT_VERSION', why: "a dataset version string ('2026-06-26'), not a path" },
    { key: 'OGR2OGR_PATH', why: 'the ogr2ogr binary, only executed' },
    { key: 'OGRINFO_PATH', why: 'the ogrinfo binary, only executed' },
    {
      key: 'OUTLOOK_GRAPH_FOLDER',
      why: "a mailbox folder name in Microsoft Graph ('Inbox'), not a file-system path",
    },
    { key: 'PDF_UNICODE_FONT_PATH', why: 'a font file, only read (pdfUnicodeFont)' },
    {
      key: 'POSTGIS_MOUNT_ROOT',
      why: 'a path INSIDE the PostGIS container handed to docker exec; this process never opens it',
    },
    { key: 'SEARCH_DRAFT_WATERMARK', why: 'watermark text, not a path' },
    { key: 'SEARCH_OCR_MAX_FILE_BYTES', why: 'a size limit in bytes, not a path' },
    { key: 'SEWAGE_DATA_STORE_ID', why: 'a Vertex data-store id, not a path' },
    { key: 'SLU_ARTFAKTA_BASE_PATH', why: 'a URL path of the SLU API, not a file-system path' },
    { key: 'SLU_METODKATALOG_BASE_PATH', why: 'a URL path of the SLU API, not a file-system path' },
    { key: 'SLU_SPECIES_OBS_BASE_PATH', why: 'a URL path of the SLU API, not a file-system path' },
    { key: 'SLU_TAXONOMY_BASE_PATH', why: 'a URL path of the SLU API, not a file-system path' },
    {
      key: 'SOURCE_REGISTRY_ARTIFACT_PATH',
      why: 'the signed source registry, only read and verified (SourceRegistry); never written by product code',
    },
    {
      key: 'SOURCE_REGISTRY_TRUSTED_KEYS_FILE',
      why: 'the trusted governor public keys, only read (packages/mps-data-governance/src/SourceRegistry.ts)',
    },
  ]);

const ENTRY_BY_KEY: ReadonlyMap<string, TestDataRootEnvEntry> = new Map(
  TEST_DATA_ROOT_ENV.map((entry) => [entry.key, entry]),
);

/** TDG-5: any key naming a bucket is a remote store (a new one is never inherited before it is listed). */
export function isRemoteStoreEnvKey(key: string): boolean {
  return /(^|_)BUCKETS?(_|$)/.test(String(key).toUpperCase());
}

/**
 * How a test process treats `key` -- case-insensitively (Windows environment names): the listed handling,
 * `removed` for any other CAS key (TDG-3: MIMERS_*, *_CAS*), `remote-store` for any other bucket key, or
 * null when the key is not a data root.
 */
export function testDataRootEnvHandling(key: string): TestDataRootEnvHandling | null {
  const upper = String(key).toUpperCase();
  const entry = ENTRY_BY_KEY.get(upper);
  if (entry) return entry.handling;
  if (isCasEnvKey(upper)) return 'removed';
  return isRemoteStoreEnvKey(upper) ? 'remote-store' : null;
}

/** A data-root key: listed above, any CAS or bucket key. Never taken from the shell or an env file in tests. */
export function isTestDataRootEnvKey(key: string): boolean {
  return testDataRootEnvHandling(key) !== null;
}

/** Removes every data-root key from `env`; returns the removed key names (never values). */
export function removeInheritedDataRootEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const removedKeys = Object.keys(env).filter(isTestDataRootEnvKey).sort();
  for (const key of removedKeys) delete env[key];
  return removedKeys;
}

/**
 * TDG-5: removes every remote-store key (buckets) from `env`; returns the removed key names (never values).
 * server/loadEnvFirst.ts calls it in every test runtime, so a bucket never reaches a tested server -- even one
 * started outside Playwright with MIMER_TEST_MODE. Only buckets: the data roots a test process was GIVEN (the
 * E2E API server's fresh roots) are kept.
 */
export function removeTestRemoteStoreEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const removedKeys = Object.keys(env)
    .filter((key) => testDataRootEnvHandling(key) === 'remote-store')
    .sort();
  for (const key of removedKeys) delete env[key];
  return removedKeys;
}

export type FreshTestDataRoots = {
  /** The new run directory (absolute, created, empty, in the temp directory). */
  readonly runRoot: string;
  /** Every `fresh-temp-root` key -> `<runRoot>/<key>` (absolute; not created). */
  readonly roots: Readonly<Record<string, string>>;
};

const FRESH_RUN_DIR_PREFIX = 'miljobeslut-test-data-';

/** One new run directory per call (`mkdtemp`), never an existing one; a path per fresh-temp-root key. */
export function createFreshTestDataRoots(tmp: string = os.tmpdir()): FreshTestDataRoots {
  const base = path.resolve(tmp);
  mkdirSync(base, { recursive: true });
  const runRoot = mkdtempSync(path.join(base, FRESH_RUN_DIR_PREFIX));
  const roots: Record<string, string> = {};
  for (const entry of TEST_DATA_ROOT_ENV) {
    if (entry.handling === 'fresh-temp-root') roots[entry.key] = path.join(runRoot, entry.key.toLowerCase());
  }
  return { runRoot, roots: Object.freeze(roots) };
}

const NOTED = Symbol.for('mimer.testDbGuard.dataRootEnvNoted');

/** One stderr line per process and caller; names keys, never values. */
export function noteRemovedDataRootEnv(removedKeys: readonly string[], via: string): void {
  if (removedKeys.length === 0) return;
  const g = globalThis as { [NOTED]?: Set<string> };
  const seen = (g[NOTED] ??= new Set<string>());
  if (seen.has(via)) return;
  seen.add(via);
  process.stderr.write(
    `[${TEST_DB_GUARD_LABEL}] ${via}: inherited data-root settings removed (a test never uses the caller's ` +
      `live data roots): ${removedKeys.join(', ')}\n`,
  );
}

export type TestDataRootIsolation = {
  /** Keys removed from the inherited environment (names only). */
  readonly removed: readonly string[];
  /** The run directory the fresh roots live in, or null when `assignFreshRoots` was false. */
  readonly runRoot: string | null;
  /** The fresh roots now set in `env` (empty when `assignFreshRoots` was false). */
  readonly assigned: Readonly<Record<string, string>>;
};

/**
 * Scrubs every data-root key from `env` and, unless `assignFreshRoots` is false, sets each
 * `fresh-temp-root` key to a path in a NEW run directory. The Vitest setup calls this for every test
 * file; playwright.config.ts scrubs its runner and workers and gives its servers fresh roots.
 */
export function isolateTestDataRootEnv(
  env: NodeJS.ProcessEnv,
  via: string,
  options: { readonly assignFreshRoots?: boolean; readonly tmp?: string } = {},
): TestDataRootIsolation {
  // Only for the stderr note: a previous test file's fresh roots (this module's own run directories)
  // are not "inherited"; every listed key is removed either way.
  const fromOutside = Object.keys(env)
    .filter(isTestDataRootEnvKey)
    .filter((key) => !String(env[key]).includes(FRESH_RUN_DIR_PREFIX))
    .sort();
  const removedKeys = removeInheritedDataRootEnv(env);
  noteRemovedDataRootEnv(fromOutside, via);
  if (options.assignFreshRoots === false) return { removed: removedKeys, runRoot: null, assigned: {} };
  const created = createFreshTestDataRoots(options.tmp);
  for (const [key, value] of Object.entries(created.roots)) env[key] = value;
  return { removed: removedKeys, runRoot: created.runRoot, assigned: created.roots };
}
