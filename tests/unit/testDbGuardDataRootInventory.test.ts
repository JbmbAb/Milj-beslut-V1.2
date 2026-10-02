// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  KNOWN_LIVE_PRODUCT_TREES,
  TEST_ABSOLUTE_PATHS_NOT_LIVE,
  TEST_DATA_ROOT_WRITE_EXCEPTIONS,
  TEST_PROTECTED_ABSOLUTE_ROOTS,
  TEST_PROTECTED_HOME_ROOTS,
  TEST_PROTECTED_RELATIVE_ROOTS,
  TEST_RELATIVE_ROOTS_NOT_LIVE,
} from '../../server/modules/test-db-guard/installTestDataRootWriteGuard';
import {
  TEST_DATA_ROOT_ENV,
  TEST_ENV_KEYS_NOT_DATA_ROOTS,
} from '../../server/modules/test-db-guard/testDataRootIsolation';
import { homeRelative, scanDataRoots, type DataRootInventory } from './testDbGuardDataRootInventory.scan.mjs';

/**
 * TEST-DB-GUARD (OD-K0-5), TDG-4 step 4: the inventory is DERIVED from the code (server/, src/, services/,
 * packages/*\/src/, packages/*\/scripts/, scripts/) by testDbGuardDataRootInventory.scan.mjs, never written by
 * hand, and every data root found must be handled:
 *
 *   - every data-root-shaped environment key a product file reads is on the scrub list
 *     (TEST_DATA_ROOT_ENV) or, reviewed, on TEST_ENV_KEYS_NOT_DATA_ROOTS -- and a key built at run time
 *     (`process.env[`${p}_STORE_ROOT`]`) is never accepted: it cannot be scrubbed by name;
 *   - a key whose unset default is a LOCATION is scrubbed to a fresh temp root, never merely removed;
 *   - every cwd-/repo-relative default directory is protected by the write guard or, reviewed, on
 *     TEST_RELATIVE_ROOTS_NOT_LIVE;
 *   - TDG-5: EVERY absolute path literal and every path under the home directory is protected (an absolute
 *     root, a root of a known live tree, a home root) or, reviewed, on TEST_ABSOLUTE_PATHS_NOT_LIVE;
 *   - the reviewed lists and the write exceptions are LOCKED: a new entry fails here until the lock is
 *     changed in review, and an entry the code no longer needs fails as stale.
 *
 * A NEW data root without handling makes this test fail -- proven by the canaries on a temporary copy.
 * TDG-5: the scanner is a drift guard, not a proof: a form it does not recognise is not seen (see the
 * scanner's header); the write guard is the protection.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

type Lists = {
  readonly env: readonly { key: string; handling: string }[];
  readonly notDataRoots: readonly { key: string }[];
  readonly protectedRelative: readonly { root: string }[];
  readonly notLiveRelative: readonly { root: string }[];
  readonly protectedAbsolute: readonly { root: string }[];
  readonly protectedHome: readonly { root: string }[];
  readonly knownTrees: readonly { root: string }[];
  readonly notLiveAbsolute: readonly { root: string }[];
};

const LISTS: Lists = {
  env: TEST_DATA_ROOT_ENV,
  notDataRoots: TEST_ENV_KEYS_NOT_DATA_ROOTS,
  protectedRelative: TEST_PROTECTED_RELATIVE_ROOTS,
  notLiveRelative: TEST_RELATIVE_ROOTS_NOT_LIVE,
  protectedAbsolute: TEST_PROTECTED_ABSOLUTE_ROOTS,
  protectedHome: TEST_PROTECTED_HOME_ROOTS,
  knownTrees: KNOWN_LIVE_PRODUCT_TREES,
  notLiveAbsolute: TEST_ABSOLUTE_PATHS_NOT_LIVE,
};

const slashed = (p: string) => p.toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '');
const isUnder = (p: string, root: string) => {
  const a = slashed(p);
  const r = slashed(root);
  return a === r || a.startsWith(`${r}/`);
};
/** `~/x` for a home root `x`. */
const home = (root: string) => `~/${root.replace(/\\/g, '/')}`;
/** The live roots of a known tree (a relative root with `..` is resolved against the tree). */
const knownTreeRoots = (lists: Lists) =>
  lists.knownTrees.flatMap(({ root: tree }) =>
    lists.protectedRelative.map(({ root }) => path.win32.join(tree, ...root.split('/'))),
  );

/** Is an absolute literal (or a `~/...` home path) protected by the write guard? */
function isProtectedPath(p: string, lists: Lists): boolean {
  if (p.startsWith('~/')) return lists.protectedHome.some(({ root }) => isUnder(p, home(root)));
  return (
    lists.protectedAbsolute.some(({ root }) => isUnder(p, root)) ||
    knownTreeRoots(lists).some((root) => isUnder(p, root))
  );
}
const isNotLivePath = (p: string, lists: Lists) => lists.notLiveAbsolute.some(({ root }) => isUnder(p, root));

/** What the inventory found that no list handles. Empty in every field = fully handled. */
function unhandled(inv: DataRootInventory, lists: Lists) {
  const scrub = new Map(lists.env.map((e) => [e.key, e.handling]));
  const notRoots = new Set(lists.notDataRoots.map((e) => e.key));
  const relHandled = new Set([...lists.protectedRelative, ...lists.notLiveRelative].map((e) => e.root));
  const keys = Object.keys(inv.envKeys);
  return {
    keysOnNoList: keys.filter((key) => !scrub.has(key) && !notRoots.has(key)).sort(),
    dynamicKeyPatterns: Object.keys(inv.dynamicEnvKeys).sort(),
    locationDefaultButOnlyRemoved: keys
      .filter(
        (key) =>
          inv.envKeys[key].fallsBackToLocation && scrub.has(key) && scrub.get(key) !== 'fresh-temp-root',
      )
      .sort(),
    relativeRootsOnNoList: Object.keys(inv.relativeRoots)
      .filter((root) => !relHandled.has(root))
      .sort(),
    absoluteDefaultsNotProtected: Object.entries(inv.absoluteDefaults)
      .filter(([, uses]) => uses.some((use) => !notRoots.has(use.key)))
      .map(([abs]) => abs)
      .filter((abs) => !isProtectedPath(homeRelative(abs) ?? abs, lists))
      .sort(),
    absolutePathsNotHandled: [...Object.keys(inv.absolutePaths), ...Object.keys(inv.homePaths)]
      .filter((p) => !isProtectedPath(p, lists) && !isNotLivePath(p, lists))
      .sort(),
  };
}

/** Entries the code no longer needs (a list tracks the code, it does not only grow). */
function stale(inv: DataRootInventory, lists: Lists) {
  const literals = [...Object.keys(inv.absolutePaths), ...Object.keys(inv.homePaths)];
  return {
    scrubKeysNotInCode: lists.env.map((e) => e.key).filter((key) => !inv.envKeys[key]),
    notDataRootKeysNotInCode: lists.notDataRoots.map((e) => e.key).filter((key) => !inv.envKeys[key]),
    notLiveRootsNotInCode: lists.notLiveRelative
      .map((e) => e.root)
      .filter((root) => !inv.relativeRoots[root]),
    notLiveAbsoluteNotInCode: lists.notLiveAbsolute
      .map((e) => e.root)
      .filter((root) => !literals.some((p) => isUnder(p, root))),
  };
}

let inventory: DataRootInventory;

beforeAll(() => {
  inventory = scanDataRoots(REPO_ROOT);
}, 120_000);

describe('the inventory is derived from the code, and it is not vacuous', () => {
  it('finds the anchors TDG3-VERIFICATION V1 and the SWEEP named', () => {
    expect(inventory.fileCount).toBeGreaterThan(500);
    expect(inventory.envKeys.QUARANTINE_ROOT?.reads.map((r) => r.file)).toContain(
      'server/routes/governance.routes.ts',
    );
    expect(inventory.envKeys.ADMIN_ROLE_GRANT_CAS_ROOT?.fallsBackToLocation).toBe(true);
    expect(inventory.envKeys.MIMERS_ROOT?.fallsBackToLocation).toBe(false);
    // read through a helper (readPathEnv('KNOWLEDGE_BASE_ROOT') ?? path.join(process.cwd(), 'dossiers', ...))
    expect(inventory.envKeys.KNOWLEDGE_BASE_ROOT?.fallsBackToLocation).toBe(true);
    expect(inventory.relativeRoots.dossiers?.map((r) => r.how)).toContain('KNOWLEDGE_BASE_ROOT fallback');
    expect(inventory.relativeRoots['.quarantine']?.map((r) => r.file)).toEqual(
      expect.arrayContaining([
        'packages/mimers-brunn-core/src/governance/QuarantineStorage.ts',
        'packages/mps-data-governance/src/HarvestRuntimeCompositionRoot.ts',
        'server/modules/legal/materialization/LegalCorpusMaterializationCompositionRoot.ts',
      ]),
    );
    expect(inventory.relativeRoots.storage?.map((r) => r.file)).toEqual(
      expect.arrayContaining([
        'server/services/documentGenerator.ts',
        'scripts/import/import-librarian-manifest.ts',
      ]),
    );
    expect(inventory.relativeRoots['tmp-artifacts']?.map((r) => r.file)).toContain(
      'scripts/mimers/prove-nfs-failover.ts',
    );
    expect(Object.keys(inventory.absoluteDefaults)).toContain(
      'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive',
    );
  });

  it('TDG-5: finds the roots TDG4-VERIFICATION named (findings 4, 5, 6)', () => {
    // a ternary fallback (`X ? path.resolve(X) : defaultRoot`), the root it falls back to
    expect(inventory.envKeys.OPS_PIPELINE_ROOT?.fallsBackToLocation).toBe(true);
    expect(inventory.relativeRoots['../Miljobeslut_Ops_Pipeline']?.map((r) => r.file)).toContain(
      'scripts/ops/evaluate-ops-pipeline.ts',
    );
    // packages/*/scripts and `${process.cwd()}/.quarantine`
    expect(inventory.envKeys.HARVEST_QUARANTINE_ROOT?.reads.map((r) => r.file)).toContain(
      'packages/mps-data-governance/scripts/harvest-live-pilot.ts',
    );
    expect(inventory.envKeys.HARVEST_QUARANTINE_ROOT?.fallsBackToLocation).toBe(true);
    // remote buckets by the BUCKET token
    expect(Object.keys(inventory.envKeys)).toEqual(
      expect.arrayContaining(['GCS_DOCUMENTS_BUCKET', 'BACKUP_S3_BUCKET']),
    );
    // hard-coded absolute paths that are no key's fallback: the demonstrator's secrets, ~/.mimers/secrets
    expect(Object.keys(inventory.absolutePaths)).toContain('D:\\mimer-demo\\secrets');
    expect(inventory.homePaths['~/.mimers/secrets']?.length).toBeGreaterThanOrEqual(10);
  });
});

describe('every data root found is handled', () => {
  it('nothing is on no list, no location default is merely removed, every absolute path is protected or reviewed', () => {
    expect(unhandled(inventory, LISTS)).toEqual({
      keysOnNoList: [],
      dynamicKeyPatterns: [],
      locationDefaultButOnlyRemoved: [],
      relativeRootsOnNoList: [],
      absoluteDefaultsNotProtected: [],
      absolutePathsNotHandled: [],
    });
  });

  it('no list keeps an entry the code no longer needs', () => {
    expect(stale(inventory, LISTS)).toEqual({
      scrubKeysNotInCode: [],
      notDataRootKeysNotInCode: [],
      notLiveRootsNotInCode: [],
      notLiveAbsoluteNotInCode: [],
    });
  });
});

describe('the reviewed lists are locked (a new entry fails here until the lock is changed in review)', () => {
  it('write exceptions: exactly these four, each one file inside a protected root, owned by an existing test that still writes it', () => {
    expect(TEST_DATA_ROOT_WRITE_EXCEPTIONS.map((e) => `${e.testFile} -> ${e.path}`)).toEqual([
      'packages/mps-lu/tests/LUEndToEnd.test.ts -> tests/fixtures/EndToEnd/Case_Fusion/original/beslut.txt',
      'packages/mps-lu/tests/VerticalProof.test.ts -> tests/fixtures/EndToEnd/VerticalProof/original/beslut.txt',
      'packages/mps-lu/tests/RawSourceIngestion.test.ts -> tests/fixtures/National_Archive/VISS/2024/Karlstad/Case_123/original/beslut_grundvatten.txt',
      'tests/unit/import/importLibrarianManifestRetention.test.ts -> storage/manifests/import-qa/batch-v2.json',
    ]);
    const generic = new Set(['tests', 'fixtures', 'original', 'storage', 'manifests', 'EndToEnd']);
    for (const exception of TEST_DATA_ROOT_WRITE_EXCEPTIONS) {
      expect(TEST_PROTECTED_RELATIVE_ROOTS.some(({ root }) => isUnder(exception.path, root))).toBe(true);
      expect(exception.why.length).toBeGreaterThan(40);
      const source = fs.readFileSync(path.join(REPO_ROOT, exception.testFile), 'utf8');
      const marks = exception.path
        .replace(/\.[a-z]+$/i, '')
        .split('/')
        .filter((segment) => !generic.has(segment));
      expect({
        exception: exception.path,
        stillWritten: marks.some((mark) => source.includes(mark)),
      }).toEqual({
        exception: exception.path,
        stillWritten: true,
      });
    }
  });

  it('keys that are not data roots: exactly these 31', () => {
    expect(TEST_ENV_KEYS_NOT_DATA_ROOTS.map((e) => e.key)).toEqual([
      'ALLOW_SEARCH_MANIFEST_PATH_OVERRIDE',
      'BANKID_CA_PATH',
      'BANKID_CERT_PATH',
      'BANKID_KEY_PATH',
      'BANKID_PFX_PATH',
      'GDAL_BIN_PATH',
      'GDAL_DATA',
      'GDAL_HTTP_HEADER_FILE',
      'GDAL_TRANSLATE',
      'INTERACTIONS_STORE',
      'LEGAL_RERANKER_PROMPT_FILE',
      'LOG_LEVEL',
      'LIMS_SFTP_PATH',
      'LU_EXECUTION_AUTHORITY_ROOT_KEY_ID',
      'LU_EXECUTION_AUTHORITY_ROOT_PRIVATE_KEY_PEM',
      'LU_EXECUTION_AUTHORITY_ROOT_PUBLIC_KEY_PEM',
      'MCF_OUTPUT_VERSION',
      'OGR2OGR_PATH',
      'OGRINFO_PATH',
      'OUTLOOK_GRAPH_FOLDER',
      'PDF_UNICODE_FONT_PATH',
      'POSTGIS_MOUNT_ROOT',
      'SEARCH_DRAFT_WATERMARK',
      'SEARCH_OCR_MAX_FILE_BYTES',
      'SEWAGE_DATA_STORE_ID',
      'SLU_ARTFAKTA_BASE_PATH',
      'SLU_METODKATALOG_BASE_PATH',
      'SLU_SPECIES_OBS_BASE_PATH',
      'SLU_TAXONOMY_BASE_PATH',
      'SOURCE_REGISTRY_ARTIFACT_PATH',
      'SOURCE_REGISTRY_TRUSTED_KEYS_FILE',
    ]);
    for (const e of TEST_ENV_KEYS_NOT_DATA_ROOTS) expect(e.why.length).toBeGreaterThan(10);
  });

  it('relative roots that are not live: exactly these 16', () => {
    expect(TEST_RELATIVE_ROOTS_NOT_LIVE.map((e) => e.root)).toEqual([
      '.dockerignore',
      '.env.test',
      '.prettierrc.json',
      'app',
      'components',
      'coverage',
      'node_modules',
      'packages',
      'prisma',
      'scripts',
      'server',
      'services',
      'source-registry',
      'tests/setup',
      'training',
      'tsconfig.json',
    ]);
  });

  it('absolute paths that are not live: exactly these 10, none a drive root, none over or under a protected root', () => {
    expect(TEST_ABSOLUTE_PATHS_NOT_LIVE.map((e) => e.root)).toEqual([
      'C:\\Program Files\\GDAL',
      'C:\\Program Files\\QGIS 4.0.2',
      'C:\\Windows\\Fonts',
      '/usr/share/fonts',
      '~/AppData/Local/Microsoft/Windows/Fonts',
      '/mnt/drive',
      '/mnt/geo_master_archive',
      '/var/lib/postgresql/data',
      '/tmp/manifest.json',
      '/tmp/out',
    ]);
    const protectedRoots = [
      ...TEST_PROTECTED_ABSOLUTE_ROOTS.map(({ root }) => root),
      ...TEST_PROTECTED_HOME_ROOTS.map(({ root }) => home(root)),
      ...knownTreeRoots(LISTS),
    ];
    for (const { root, why } of TEST_ABSOLUTE_PATHS_NOT_LIVE) {
      expect(why.length).toBeGreaterThan(10);
      expect({ root, driveRoot: /^(?:[A-Za-z]:[\\/]?|\/|~\/?)$/.test(root) }).toEqual({
        root,
        driveRoot: false,
      });
      const overlap = protectedRoots.filter((p) => isUnder(p, root) || isUnder(root, p));
      expect({ root, overlap }).toEqual({ root, overlap: [] });
    }
  });

  it('every key of the shared list has exactly ONE handling; the three classes are locked', () => {
    const all = [...TEST_DATA_ROOT_ENV.map((e) => e.key), ...TEST_ENV_KEYS_NOT_DATA_ROOTS.map((e) => e.key)];
    expect(all.filter((key, i) => all.indexOf(key) !== i)).toEqual([]);
    for (const e of TEST_DATA_ROOT_ENV)
      expect({ key: e.key, ok: ['fresh-temp-root', 'removed', 'remote-store'].includes(e.handling) }).toEqual(
        {
          key: e.key,
          ok: true,
        },
      );
    const byClass = (handling: string) =>
      TEST_DATA_ROOT_ENV.filter((e) => e.handling === handling)
        .map((e) => e.key)
        .sort();
    // left unset: none has a location default (checked derived above); no temp root silently turns a feature on
    expect(byClass('removed')).toEqual([
      'IMPORT_REIMPORT_SCAN_ROOTS',
      'LOCAL_DB_ROOT',
      'LU_MPS_CAS',
      'MIMERS_DURABILITY_MODE',
      'MIMERS_NFS_ROOT',
      'MIMERS_REQUIRED',
      'MIMERS_REQUIRE_LINUX_STRICT',
      'MIMERS_ROOT',
      'MUNICIPAL_CONTACTS_CSV_PATH',
      'NMD_RASTER_PATH',
      'OUTLOOK_FOLDER_PATH',
      'SMOKE_JSON_OUT',
    ]);
    expect(byClass('remote-store')).toEqual(['BACKUP_S3_BUCKET', 'GCS_DOCUMENTS_BUCKET']);
    // TDG-5: moved from "removed" to a fresh temp root per test file
    expect(byClass('fresh-temp-root')).toEqual(
      expect.arrayContaining([
        'HARVEST_QUARANTINE_ROOT',
        'OPS_PIPELINE_ROOT',
        'SGU_DISCOVERED_MANIFEST_PATH',
      ]),
    );
    expect(
      byClass('fresh-temp-root').length + byClass('removed').length + byClass('remote-store').length,
    ).toBe(TEST_DATA_ROOT_ENV.length);
  });

  it('a key is on one list only, and a protected root is never also "not live"', () => {
    const scrub = new Set(TEST_DATA_ROOT_ENV.map((e) => e.key));
    expect(TEST_ENV_KEYS_NOT_DATA_ROOTS.filter((e) => scrub.has(e.key))).toEqual([]);
    const notLive = new Set(TEST_RELATIVE_ROOTS_NOT_LIVE.map((e) => e.root));
    expect(TEST_PROTECTED_RELATIVE_ROOTS.filter((e) => notLive.has(e.root))).toEqual([]);
  });
});

describe('canary: a NEW data root without handling makes the inventory fail (temporary copy)', () => {
  let copy: string;

  beforeAll(() => {
    copy = fs.mkdtempSync(path.join(os.tmpdir(), 'wtdg4-inventory-canary-'));
    // real product files whose roots are handled ...
    for (const rel of [
      'server/services/adminRoleGrantService.ts',
      'server/routes/governance.routes.ts',
      'server/services/importPathService.ts',
    ]) {
      fs.mkdirSync(path.dirname(path.join(copy, rel)), { recursive: true });
      fs.copyFileSync(path.join(REPO_ROOT, rel), path.join(copy, rel));
    }
    // ... and a new store nobody handled (plus the same patterns where they do not count)
    const canary = [
      "import path from 'node:path';",
      "export const CANARY_ROOT = process.env.WTDG4_CANARY_ROOT || path.join(process.cwd(), 'wtdg4-canary-live-root');",
      "export const CANARY_ARCHIVE = process.env.WTDG4_CANARY_ARCHIVE_DIR ?? 'D:\\\\wtdg4-canary\\\\live-archive';",
      "// process.env.WTDG4_COMMENTED_ROOT || path.join(process.cwd(), 'wtdg4-commented-root')",
      '',
    ].join('\n');
    fs.writeFileSync(path.join(copy, 'server/services/wtdg4CanaryStore.ts'), canary);
    fs.writeFileSync(
      path.join(copy, 'server/services/wtdg4CanaryStore.test.ts'),
      "const X = process.env.WTDG4_TEST_ONLY_ROOT || require('node:path').join(process.cwd(), 'wtdg4-test-only-root');\n",
    );
    // TDG-5: the twelve forms TDG4-VERIFICATION finding 5 showed passing unseen
    const evade = [
      "import os from 'node:os';",
      "import path from 'node:path';",
      "const p = 'WTDG5';",
      'const cwd = process.cwd();',
      'export const a = process.env[`${p}_STORE_ROOT`];', // 1 a key built in a template
      "export const b = process.env['WTDG5' + '_UPLOADS'];", // 2 a concatenated key
      'const { WTDG5_SPOOL_DIR, WTDG5_DEFAULTED_DIR: defaulted = path.join(cwd, "wtdg5-destructured-root") } = process.env;', // 3
      'export const c = [WTDG5_SPOOL_DIR, defaulted];',
      "export const d = process.env.WTDG5_SINK || path.join(process.cwd(), 'wtdg5-sink');", // 4 no name token
      'export const e = `${process.cwd()}/wtdg5-template-root/x`;', // 5
      "export const f = process.cwd() + '/wtdg5-concat-root';", // 6
      "export const g = new URL('../../wtdg5-url-root/', import.meta.url);", // 7
      "export const h = 'E:\\\\wtdg5\\\\hard-coded-archive';", // 8
      "export const i = path.join(os.homedir(), '.wtdg5-home', 'secrets');", // 9
      'export const j = process.env.WTDG5_PIPE_ROOT ? path.resolve(process.env.WTDG5_PIPE_ROOT) : path.resolve(cwd, "..", "wtdg5-sibling");', // 10
      "export const k = path.join(cwd, 'wtdg5-cwdvar-root');", // 11
      "export const m = 'C:\\\\Users\\\\someone\\\\.wtdg5-profile\\\\keys';",
      '',
    ].join('\n');
    fs.writeFileSync(path.join(copy, 'server/services/wtdg5CanaryEvade.ts'), evade);
    fs.mkdirSync(path.join(copy, 'packages', 'wtdg5pkg', 'scripts'), { recursive: true });
    fs.writeFileSync(
      path.join(copy, 'packages', 'wtdg5pkg', 'scripts', 'run.ts'),
      'export const l = process.env.WTDG5_PKG_SCRIPT_DIR ?? `${process.cwd()}/.wtdg5-pkg-quarantine`;\n', // 12
    );
  });

  afterAll(() => {
    fs.rmSync(copy, { recursive: true, force: true });
  });

  it('exactly the canary is reported -- every key, pattern, relative root, absolute and home path', () => {
    const inv = scanDataRoots(copy, { how: 'walk' });
    expect(inv.how).toBe('walk');
    expect(inv.envKeys.QUARANTINE_ROOT).toBeDefined(); // the copied real files were scanned
    expect(unhandled(inv, LISTS)).toEqual({
      keysOnNoList: [
        'WTDG4_CANARY_ARCHIVE_DIR',
        'WTDG4_CANARY_ROOT',
        'WTDG5_DEFAULTED_DIR',
        'WTDG5_PIPE_ROOT',
        'WTDG5_PKG_SCRIPT_DIR',
        'WTDG5_SINK',
        'WTDG5_SPOOL_DIR',
        'WTDG5_UPLOADS',
      ],
      dynamicKeyPatterns: ['*_STORE_ROOT'],
      locationDefaultButOnlyRemoved: [],
      relativeRootsOnNoList: [
        '../wtdg5-sibling',
        '.wtdg5-pkg-quarantine',
        'wtdg4-canary-live-root',
        'wtdg5-concat-root',
        'wtdg5-cwdvar-root',
        'wtdg5-destructured-root',
        'wtdg5-sink',
        'wtdg5-template-root',
        'wtdg5-url-root',
      ],
      absoluteDefaultsNotProtected: ['D:\\wtdg4-canary\\live-archive'],
      absolutePathsNotHandled: [
        'D:\\wtdg4-canary\\live-archive',
        'E:\\wtdg5\\hard-coded-archive',
        '~/.wtdg5-home/secrets',
        '~/.wtdg5-profile/keys',
      ],
    });
    // the ternary's and the destructuring default's fallbacks are locations
    expect(inv.envKeys.WTDG5_PIPE_ROOT.fallsBackToLocation).toBe(true);
    expect(inv.envKeys.WTDG5_DEFAULTED_DIR.fallsBackToLocation).toBe(true);
    expect(inv.envKeys.WTDG5_SINK.fallsBackToLocation).toBe(true);
  });

  it('handled by the lists, the canary passes; scrubbed but only "removed" (or a remote store), it still fails', () => {
    const inv = scanDataRoots(copy, { how: 'walk' });
    const canaryKeys = [
      'WTDG4_CANARY_ARCHIVE_DIR',
      'WTDG4_CANARY_ROOT',
      'WTDG5_DEFAULTED_DIR',
      'WTDG5_PIPE_ROOT',
      'WTDG5_PKG_SCRIPT_DIR',
      'WTDG5_SINK',
      'WTDG5_SPOOL_DIR',
      'WTDG5_UPLOADS',
    ];
    const handled: Lists = {
      ...LISTS,
      env: [...LISTS.env, ...canaryKeys.map((key) => ({ key, handling: 'fresh-temp-root' }))],
      protectedRelative: [
        ...LISTS.protectedRelative,
        ...unhandled(inv, LISTS).relativeRootsOnNoList.map((root) => ({ root })),
      ],
      protectedAbsolute: [...LISTS.protectedAbsolute, { root: 'D:\\wtdg4-canary' }, { root: 'E:\\wtdg5' }],
      protectedHome: [...LISTS.protectedHome, { root: '.wtdg5-home' }, { root: '.wtdg5-profile' }],
    };
    const left = unhandled(inv, handled);
    expect({ ...left, dynamicKeyPatterns: [] }).toEqual({
      keysOnNoList: [],
      dynamicKeyPatterns: [],
      locationDefaultButOnlyRemoved: [],
      relativeRootsOnNoList: [],
      absoluteDefaultsNotProtected: [],
      absolutePathsNotHandled: [],
    });
    // a key built at run time is never accepted by a list
    expect(left.dynamicKeyPatterns).toEqual(['*_STORE_ROOT']);
    for (const handling of ['removed', 'remote-store']) {
      const weaker: Lists = {
        ...handled,
        env: [
          ...LISTS.env,
          ...canaryKeys.map((key) => ({
            key,
            handling: key === 'WTDG4_CANARY_ROOT' ? handling : 'fresh-temp-root',
          })),
        ],
      };
      expect({ handling, left: unhandled(inv, weaker).locationDefaultButOnlyRemoved }).toEqual({
        handling,
        left: ['WTDG4_CANARY_ROOT'],
      });
    }
  });
});
