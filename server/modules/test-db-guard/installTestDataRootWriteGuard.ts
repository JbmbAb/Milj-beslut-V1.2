import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
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
 * a setting exists: a write, a mkdir, a rename, a copy, a removal -- sync, callback or promise -- whose
 * target is inside a protected root is refused BEFORE anything happens, with a TestDataRootWriteRefusedError
 * (code TEST_DATA_ROOT_WRITE_REFUSED) that names the operation, the path and the root.
 *
 * Protected: every root below under the product tree of this checkout (the repo root this module lives in)
 * and under the current working directory when that is a product tree (package.json + server/ + packages/),
 * and the absolute live locations data-root keys fall back to. Reads are never refused.
 *
 * Exceptions: the reviewed list TEST_DATA_ROOT_WRITE_EXCEPTIONS -- each one exact file, owned by one test
 * file (it applies only while that Vitest test file runs), with the reason it cannot get a temp root in
 * this unit. The inventory test locks its size: a new entry fails it until the lock is changed in review.
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
  { root: 'lm_headers.txt', why: 'scripts/import/import-lantmateriet.ts' },
  { root: 'anna_vestling_utredning.md', why: 'scripts/generate-lokaliseringsutredning.ts' },
]);

/** Absolute live locations a data-root key falls back to when unset (derived from the code). */
export const TEST_PROTECTED_ABSOLUTE_ROOTS: readonly ProtectedDataRoot[] = Object.freeze([
  {
    root: 'C:\\miljöbeslut\\storage\\geo_master_archive',
    why: 'MASTER_ARCHIVE_ROOT / ARCHIVE_SHADOW_ROOT default',
  },
  {
    root: 'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive',
    why: 'GEO_MASTER_ARCHIVE / MASTER_ARCHIVE_ROOT / H_DRIVE_ROOT default',
  },
  { root: 'M:\\', why: 'MASTER_ARCHIVE_ROOT default (scripts/import/run-sks-import.ts)' },
  { root: 'D:\\Users\\jimmy\\Desktop\\OutlookExport', why: 'OUTLOOK_BASE_DIR default' },
  { root: 'D:\\ingest-arkiv-2026-03-29\\dataportal-env', why: 'INGEST_GPKG_ROOT default' },
  { root: 'C:\\Users\\jimmy\\Downloads', why: 'SGU_DOWNLOAD_DIR default' },
  { root: '/tmp/outlook-attachments', why: 'OUTLOOK_STORAGE_ROOT default' },
  { root: '/tmp/miljobeslut-backups', why: 'BACKUP_DIR default' },
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

const caseFold = process.platform === 'win32' || process.platform === 'darwin';
const norm = (p: string) => {
  const resolved = path.resolve(p);
  return caseFold ? resolved.toLowerCase() : resolved;
};
const isInsideOrSame = (target: string, root: string) =>
  target === root || target.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

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

function currentVitestTestFile(): string | null {
  const state = (globalThis as { __vitest_worker__?: { filepath?: unknown } }).__vitest_worker__;
  return typeof state?.filepath === 'string' ? state.filepath : null;
}

export type WriteKind = 'write' | 'mkdir' | 'remove';

export type WriteRefusal = {
  readonly operation: string;
  readonly target: string;
  readonly protectedRoot: string;
};

/**
 * The decision, pure but for the product-tree check of cwd: null (allowed) or the refusal. `remove`
 * (rm, rmdir, unlink, the source of a rename) is also refused for an ANCESTOR of a protected root.
 */
export function testDataRootWriteRefusal(
  operation: string,
  kind: WriteKind,
  target: string,
  options: {
    readonly cwd?: string;
    readonly testFile?: string | null;
    readonly trees?: readonly string[];
  } = {},
): WriteRefusal | null {
  const abs = norm(target);
  const cwd = options.cwd ?? process.cwd();
  const trees = options.trees ?? [THIS_PRODUCT_TREE, ...(isProductTree(cwd) ? [cwd] : [])];
  const testFile = options.testFile === undefined ? currentVitestTestFile() : options.testFile;
  for (const tree of new Set(trees.map(norm))) {
    for (const { root } of TEST_PROTECTED_RELATIVE_ROOTS) {
      const rootAbs = norm(path.join(tree, root));
      const inside = isInsideOrSame(abs, rootAbs);
      const ancestor = kind === 'remove' && isInsideOrSame(rootAbs, abs);
      if (!inside && !ancestor) continue;
      if (inside && isExcepted(abs, kind, tree, testFile)) continue;
      return { operation, target: path.resolve(target), protectedRoot: path.join(tree, root) };
    }
  }
  for (const { root } of TEST_PROTECTED_ABSOLUTE_ROOTS) {
    // A drive-letter root exists only on Windows; a POSIX root is also reached there (on the current drive).
    if (process.platform !== 'win32' && /^[A-Za-z]:\\/.test(root)) continue;
    const rootAbs = norm(root);
    if (isInsideOrSame(abs, rootAbs) || (kind === 'remove' && isInsideOrSame(rootAbs, abs))) {
      return { operation, target: path.resolve(target), protectedRoot: root };
    }
  }
  return null;
}

function isExcepted(abs: string, kind: WriteKind, tree: string, testFile: string | null): boolean {
  if (kind === 'remove' || !testFile) return false;
  const testAbs = norm(testFile);
  for (const exception of TEST_DATA_ROOT_WRITE_EXCEPTIONS) {
    if (testAbs !== norm(path.join(tree, exception.testFile))) continue;
    const allowed = norm(path.join(tree, exception.path));
    if (abs === allowed && kind === 'write') return true;
    // creating the exception's own parent directories
    if (kind === 'mkdir' && isInsideOrSame(allowed, abs) && abs !== allowed) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------------
// Installation: patches node:fs (sync, callback) and node:fs/promises, then syncs the ESM named exports.

type AnyFn = (...args: unknown[]) => unknown;
const GUARD_MARK = Symbol.for('mimer.testDbGuard.dataRootWriteGuard');

function pathArg(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString();
  if (value instanceof URL) return value.protocol === 'file:' ? fileURLToPath(value) : null;
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
};

/** Which argument of which function is a target, and how it is written. */
const CHECKS: Record<string, readonly Check[]> = {
  writeFile: [{ index: 0, kind: 'write' }],
  appendFile: [{ index: 0, kind: 'write' }],
  truncate: [{ index: 0, kind: 'write' }],
  mkdir: [{ index: 0, kind: 'mkdir' }],
  mkdtemp: [{ index: 0, kind: 'mkdir' }],
  copyFile: [{ index: 1, kind: 'write' }],
  cp: [{ index: 1, kind: 'write' }],
  rename: [
    { index: 0, kind: 'remove' },
    { index: 1, kind: 'write' },
  ],
  link: [{ index: 1, kind: 'write' }],
  symlink: [{ index: 1, kind: 'write' }],
  rm: [{ index: 0, kind: 'remove' }],
  rmdir: [{ index: 0, kind: 'remove' }],
  unlink: [{ index: 0, kind: 'remove' }],
  open: [{ index: 0, kind: 'write', when: (args) => isWriteFlag(args[1]) }],
  createWriteStream: [{ index: 0, kind: 'write' }],
};

function refusalFor(name: string, args: unknown[]): TestDataRootWriteRefusedError | null {
  const base = name.replace(/Sync$/, '');
  for (const check of CHECKS[base] ?? []) {
    if (check.when && !check.when(args)) continue;
    const target = pathArg(args[check.index]);
    if (target === null) continue;
    const refusal = testDataRootWriteRefusal(`fs.${name}`, check.kind, target);
    if (refusal)
      return new TestDataRootWriteRefusedError(refusal.operation, refusal.target, refusal.protectedRoot);
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

/** Idempotent. Installs the write guard on node:fs and node:fs/promises in this process. */
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
