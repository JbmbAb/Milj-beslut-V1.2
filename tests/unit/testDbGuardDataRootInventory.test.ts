// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  TEST_DATA_ROOT_WRITE_EXCEPTIONS,
  TEST_PROTECTED_ABSOLUTE_ROOTS,
  TEST_PROTECTED_RELATIVE_ROOTS,
  TEST_RELATIVE_ROOTS_NOT_LIVE,
} from '../../server/modules/test-db-guard/installTestDataRootWriteGuard';
import {
  TEST_DATA_ROOT_ENV,
  TEST_ENV_KEYS_NOT_DATA_ROOTS,
} from '../../server/modules/test-db-guard/testDataRootIsolation';
import { scanDataRoots, type DataRootInventory } from './testDbGuardDataRootInventory.scan.mjs';

/**
 * TEST-DB-GUARD (OD-K0-5), TDG-4 step 4: the inventory is DERIVED from the code (server/, src/, services/,
 * packages/*\/src/, scripts/) by testDbGuardDataRootInventory.scan.mjs, never written by hand, and every data
 * root found must be handled:
 *
 *   - every data-root-shaped environment key a product file reads is on the scrub list
 *     (TEST_DATA_ROOT_ENV) or, reviewed, on TEST_ENV_KEYS_NOT_DATA_ROOTS;
 *   - a key whose unset default is a LOCATION is scrubbed to a fresh temp root, never merely removed;
 *   - every cwd-/repo-relative default directory is protected by the write guard or, reviewed, on
 *     TEST_RELATIVE_ROOTS_NOT_LIVE;
 *   - every absolute location a data-root key falls back to is protected by the write guard;
 *   - the reviewed lists and the write exceptions are LOCKED: a new entry fails here until the lock is
 *     changed in review, and an entry the code no longer needs fails as stale.
 *
 * A NEW data root without handling makes this test fail -- proven by the canary on a temporary copy.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

type Lists = {
  readonly env: readonly { key: string; handling: string }[];
  readonly notDataRoots: readonly { key: string }[];
  readonly protectedRelative: readonly { root: string }[];
  readonly notLiveRelative: readonly { root: string }[];
  readonly protectedAbsolute: readonly { root: string }[];
};

const LISTS: Lists = {
  env: TEST_DATA_ROOT_ENV,
  notDataRoots: TEST_ENV_KEYS_NOT_DATA_ROOTS,
  protectedRelative: TEST_PROTECTED_RELATIVE_ROOTS,
  notLiveRelative: TEST_RELATIVE_ROOTS_NOT_LIVE,
  protectedAbsolute: TEST_PROTECTED_ABSOLUTE_ROOTS,
};

const slashed = (p: string) => p.toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '');
const isUnder = (p: string, root: string) => {
  const a = slashed(p);
  const r = slashed(root);
  return a === r || a.startsWith(`${r}/`);
};

/** What the inventory found that no list handles. Empty in every field = fully handled. */
function unhandled(inv: DataRootInventory, lists: Lists) {
  const scrub = new Map(lists.env.map((e) => [e.key, e.handling]));
  const notRoots = new Set(lists.notDataRoots.map((e) => e.key));
  const relHandled = new Set([...lists.protectedRelative, ...lists.notLiveRelative].map((e) => e.root));
  const keys = Object.keys(inv.envKeys);
  return {
    keysOnNoList: keys.filter((key) => !scrub.has(key) && !notRoots.has(key)).sort(),
    locationDefaultButOnlyRemoved: keys
      .filter((key) => inv.envKeys[key].fallsBackToLocation && scrub.get(key) === 'removed')
      .sort(),
    relativeRootsOnNoList: Object.keys(inv.relativeRoots)
      .filter((root) => !relHandled.has(root))
      .sort(),
    absoluteDefaultsNotProtected: Object.entries(inv.absoluteDefaults)
      .filter(([, uses]) => uses.some((use) => !notRoots.has(use.key)))
      .map(([abs]) => abs)
      .filter((abs) => !lists.protectedAbsolute.some(({ root }) => isUnder(abs, root)))
      .sort(),
  };
}

/** Entries the code no longer needs (a list tracks the code, it does not only grow). */
function stale(inv: DataRootInventory, lists: Lists) {
  return {
    scrubKeysNotInCode: lists.env.map((e) => e.key).filter((key) => !inv.envKeys[key]),
    notDataRootKeysNotInCode: lists.notDataRoots.map((e) => e.key).filter((key) => !inv.envKeys[key]),
    notLiveRootsNotInCode: lists.notLiveRelative
      .map((e) => e.root)
      .filter((root) => !inv.relativeRoots[root]),
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
});

describe('every data root found is handled', () => {
  it('nothing is on no list, no location default is merely removed, every absolute default is protected', () => {
    expect(unhandled(inventory, LISTS)).toEqual({
      keysOnNoList: [],
      locationDefaultButOnlyRemoved: [],
      relativeRootsOnNoList: [],
      absoluteDefaultsNotProtected: [],
    });
  });

  it('no list keeps an entry the code no longer needs', () => {
    expect(stale(inventory, LISTS)).toEqual({
      scrubKeysNotInCode: [],
      notDataRootKeysNotInCode: [],
      notLiveRootsNotInCode: [],
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

  it('keys that are not data roots: exactly these 23', () => {
    expect(TEST_ENV_KEYS_NOT_DATA_ROOTS.map((e) => e.key)).toEqual([
      'ALLOW_SEARCH_MANIFEST_PATH_OVERRIDE',
      'BANKID_CA_PATH',
      'BANKID_CERT_PATH',
      'BANKID_KEY_PATH',
      'BANKID_PFX_PATH',
      'GDAL_BIN_PATH',
      'GDAL_DATA',
      'LIMS_SFTP_PATH',
      'LU_EXECUTION_AUTHORITY_ROOT_KEY_ID',
      'LU_EXECUTION_AUTHORITY_ROOT_PRIVATE_KEY_PEM',
      'LU_EXECUTION_AUTHORITY_ROOT_PUBLIC_KEY_PEM',
      'MCF_OUTPUT_VERSION',
      'OGR2OGR_PATH',
      'OGRINFO_PATH',
      'PDF_UNICODE_FONT_PATH',
      'POSTGIS_MOUNT_ROOT',
      'SEARCH_DRAFT_WATERMARK',
      'SEWAGE_DATA_STORE_ID',
      'SLU_ARTFAKTA_BASE_PATH',
      'SLU_METODKATALOG_BASE_PATH',
      'SLU_SPECIES_OBS_BASE_PATH',
      'SLU_TAXONOMY_BASE_PATH',
      'SOURCE_REGISTRY_ARTIFACT_PATH',
    ]);
    for (const e of TEST_ENV_KEYS_NOT_DATA_ROOTS) expect(e.why.length).toBeGreaterThan(10);
  });

  it('relative roots that are not live: exactly these 13', () => {
    expect(TEST_RELATIVE_ROOTS_NOT_LIVE.map((e) => e.root)).toEqual([
      '.dockerignore',
      '.env.test',
      'app',
      'components',
      'coverage',
      'node_modules',
      'prisma',
      'scripts',
      'server',
      'services',
      'source-registry',
      'training',
      'tsconfig.json',
    ]);
  });

  it('keys left unset instead of a temp root: exactly these 14, none with a location default', () => {
    expect(
      TEST_DATA_ROOT_ENV.filter((e) => e.handling === 'removed')
        .map((e) => e.key)
        .sort(),
    ).toEqual([
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
      'OPS_PIPELINE_ROOT',
      'OUTLOOK_FOLDER_PATH',
      'SGU_DISCOVERED_MANIFEST_PATH',
      'SMOKE_JSON_OUT',
    ]);
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
  });

  afterAll(() => {
    fs.rmSync(copy, { recursive: true, force: true });
  });

  it('exactly the canary is reported -- the key, its cwd-relative root and its absolute live default', () => {
    const inv = scanDataRoots(copy, { how: 'walk' });
    expect(inv.how).toBe('walk');
    expect(inv.envKeys.QUARANTINE_ROOT).toBeDefined(); // the copied real files were scanned
    expect(unhandled(inv, LISTS)).toEqual({
      keysOnNoList: ['WTDG4_CANARY_ARCHIVE_DIR', 'WTDG4_CANARY_ROOT'],
      locationDefaultButOnlyRemoved: [],
      relativeRootsOnNoList: ['wtdg4-canary-live-root'],
      absoluteDefaultsNotProtected: ['D:\\wtdg4-canary\\live-archive'],
    });
  });

  it('handled by the lists, the canary passes; scrubbed but only "removed", it still fails', () => {
    const inv = scanDataRoots(copy, { how: 'walk' });
    const handled: Lists = {
      ...LISTS,
      env: [
        ...LISTS.env,
        { key: 'WTDG4_CANARY_ROOT', handling: 'fresh-temp-root' },
        { key: 'WTDG4_CANARY_ARCHIVE_DIR', handling: 'fresh-temp-root' },
      ],
      protectedRelative: [...LISTS.protectedRelative, { root: 'wtdg4-canary-live-root' }],
      protectedAbsolute: [...LISTS.protectedAbsolute, { root: 'D:\\wtdg4-canary' }],
    };
    expect(Object.values(unhandled(inv, handled)).flat()).toEqual([]);
    const onlyRemoved: Lists = {
      ...handled,
      env: [
        ...LISTS.env,
        { key: 'WTDG4_CANARY_ROOT', handling: 'removed' },
        { key: 'WTDG4_CANARY_ARCHIVE_DIR', handling: 'fresh-temp-root' },
      ],
    };
    expect(unhandled(inv, onlyRemoved).locationDefaultButOnlyRemoved).toEqual(['WTDG4_CANARY_ROOT']);
  });
});
