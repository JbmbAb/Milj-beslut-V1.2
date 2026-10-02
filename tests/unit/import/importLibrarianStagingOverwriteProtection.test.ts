/**
 * U30F F1 (PRES-05): `--mode import-staging` writes lm_staging.<table>_<first 24 hex> (U30F2 M3; before: <hash8>) with
 * `ogr2ogr -overwrite`. That name is also the retained relation of the SUCCESS version with the same
 * hash (and, on an 8-hex collision, of another version). The import must decide protection for the
 * relation BEFORE anything is written -- no ledger row, no ogr2ogr -- and refuse a protected one.
 *
 * Hermetic: the real script (processManifest) runs against a scripted fake Prisma client
 * (server/db/prisma is replaced, never evaluated), a mocked child_process (ogrinfo/ogr2ogr are never
 * spawned) and an in-memory CAS. The manifest lives in a temp directory.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const HASH = 'aaaabbbb00000000000000000000000000000000000000000000000000000002';
/** U30F2 M3: import-staging writes the CURRENT name, <table>_<first 24 hex>. */
const RELATION = 'sgu_well_aaaabbbb0000000000000000';
const OTHER = 'aaaabbbb0000000000000000' + 'f'.repeat(40); // same 24-hex prefix, another version
const LEGACY_RELATION = 'sgu_well_aaaabbbb';

const h = vi.hoisted(() => {
  type Row = { id: string; status: string; target_schema: string; target_table: string; content_bundle_sha256: string; started_at: Date };
  const state = {
    ledger: [] as Row[],
    relationExists: true,
    created: [] as unknown[],
    statements: [] as string[],
    spawned: [] as string[],
    regclass: [] as string[],
    casCreateFails: false,
    casOpened: 0,
    repo: null as unknown,
  };
  const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim();
  const namesOf = (r: Row) => [8, 24].map((n) => `${r.target_table}_${r.content_bundle_sha256.substring(0, n)}`);
  const fake = {
    postgisImportBatch: {
      async findFirst(args: { where: { status: string; content_bundle_sha256: string } }) {
        return state.ledger.find((r) => r.status === args.where.status && r.content_bundle_sha256 === args.where.content_bundle_sha256) ?? null;
      },
      async create(args: { data: unknown }) {
        state.created.push(args.data);
        return { id: 'new-batch' };
      },
      async update() {
        return {};
      },
    },
    async $queryRawUnsafe(sql: string, ...params: unknown[]) {
      const s = normalize(sql);
      if (s.startsWith('SELECT to_regclass')) {
        state.regclass.push(String(params[0]));
        return [{ exists: state.relationExists }];
      }
      if (s.includes('FROM "PostgisImportBatch"') && s.includes('EXISTS')) {
        return [{ protected: state.ledger.some((r) => r.status === 'SUCCESS' && namesOf(r).includes(String(params[0]))) }];
      }
      if (s.includes('FROM "PostgisImportBatch"')) return state.ledger.filter((r) => namesOf(r).includes(String(params[0])));
      return [];
    },
    async $executeRawUnsafe(sql: string) {
      state.statements.push(normalize(sql));
      return 0;
    },
    async $disconnect() {},
  };
  return { state, fake };
});

vi.mock('../../../server/db/prisma', () => ({ prisma: h.fake }));
vi.mock('../../../scripts/db/sync-property-unit-from-env', () => ({ syncPropertyUnitFromEnv: vi.fn() }));
vi.mock('../../../packages/mps-runtime/src/mimers/MimersIntegration', () => ({
  MimersIntegration: {
    create: vi.fn(async () => {
      h.state.casOpened += 1;
      if (h.state.casCreateFails) throw new Error('MIMERS_ROOT_REQUIRED: simulated');
      return { artifactRepository: h.state.repo };
    }),
  },
}));
// ogrinfo/ogr2ogr are never spawned for real: both builtin specifiers are replaced.
const fakeSpawnSync = (cmd: string, args?: readonly string[]) => {
  h.state.spawned.push([String(cmd), ...(args ?? []).map(String)].join(' '));
  return { status: 0, stdout: 'Coordinate System is: EPSG:3006', stderr: '' };
};
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  default: { ...((await importOriginal<{ default: Record<string, unknown> }>()).default ?? {}), spawnSync: (cmd: string, args?: string[]) => fakeSpawnSync(cmd, args) },
  spawnSync: (cmd: string, args?: string[]) => fakeSpawnSync(cmd, args),
}));
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  default: { ...((await importOriginal<{ default: Record<string, unknown> }>()).default ?? {}), spawnSync: (cmd: string, args?: string[]) => fakeSpawnSync(cmd, args) },
  spawnSync: (cmd: string, args?: string[]) => fakeSpawnSync(cmd, args),
}));

import { InMemoryArtifactRepository } from '../../../packages/mps-runtime/src/repository/InMemoryArtifactRepository';
import { sha256ContentHash } from '../../../packages/mps-runtime/src/kernel/ExecutionKernel';

let workDir: string;
let manifestPath: string;
const savedArgv = process.argv;

async function loadScript(extra: string[] = []) {
  vi.resetModules();
  process.argv = [process.argv[0]!, 'import-librarian-manifest.ts', '--mode', 'import-staging', '--execute', ...extra];
  return import('../../../scripts/import/import-librarian-manifest');
}

function ledgerRow(id: string, status: string, hash: string) {
  return { id, status, target_schema: 'env', target_table: 'sgu_well', content_bundle_sha256: hash, started_at: new Date(0) };
}

function claimId(relation: string): string {
  const digest = createHash('sha256').update(`spatial-dataset-retained-relation-claim-v1\u0000${relation}`, 'utf8').digest('hex');
  return `spatial-dataset-retained-relation-claim-${digest.slice(0, 40)}`;
}

beforeEach(() => {
  h.state.ledger.length = 0;
  h.state.relationExists = true;
  h.state.created.length = 0;
  h.state.statements.length = 0;
  h.state.spawned.length = 0;
  h.state.regclass.length = 0;
  h.state.casCreateFails = false;
  h.state.casOpened = 0;
  h.state.repo = new InMemoryArtifactRepository();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  workDir = mkdtempSync(path.join(tmpdir(), 'wu30f-import-staging-'));
  mkdirSync(path.join(workDir, 'SGU'), { recursive: true });
  manifestPath = path.join(workDir, 'SGU', 'manifest.json');
  writeFileSync(
    manifestPath,
    JSON.stringify({
      schema_version: '2.0',
      provider: 'SGU',
      dataset: 'Brunnar',
      version: 'v2',
      provenance: 'hermetic test fixture',
      content_bundle_sha256: HASH,
      total_bytes: 1,
      files: ['brunnar.gpkg'],
      qa_status: 'staging_ok',
    }),
    'utf8',
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  process.argv = savedArgv;
  rmSync(workDir, { recursive: true, force: true });
});

describe('import-staging never overwrites a retained relation (U30F F1)', () => {
  it('--retry-failed re-import of a SUCCESS version: refused before any ledger row or ogr2ogr', async () => {
    h.state.ledger.push(ledgerRow('batch-success', 'SUCCESS', HASH));
    const { processManifest } = await loadScript(['--retry-failed']);
    await expect(processManifest(manifestPath)).rejects.toThrow(/REJECT_STAGING_IMPORT_WOULD_OVERWRITE_RETAINED_RELATION \[SUCCESS_BATCH\]/);
    expect(h.state.created).toEqual([]);
    expect(h.state.spawned).toEqual([]);
    expect(h.state.statements).toEqual([]);
  });

  it('24-hex collision: the relation is claimed by another version in CAS (no ledger row for it) -> refused', async () => {
    const repo = new InMemoryArtifactRepository();
    const id = claimId(`lm_staging.${RELATION}`);
    const body = { artifact_id: id, payload: { retained_relation: `lm_staging.${RELATION}`, content_bundle_sha256: OTHER } };
    await repo.put({ artifact_id: id, content_hash: sha256ContentHash(body), body });
    h.state.repo = repo;
    const { processManifest } = await loadScript();
    await expect(processManifest(manifestPath)).rejects.toThrow(/REJECT_STAGING_IMPORT_WOULD_OVERWRITE_RETAINED_RELATION \[RETENTION_CLAIM\]/);
    expect(h.state.created).toEqual([]);
    expect(h.state.spawned).toEqual([]);
  });

  it('relation present, protection undecidable because the durable CAS is unavailable -> refused (fail-closed)', async () => {
    h.state.casCreateFails = true;
    const { processManifest } = await loadScript();
    await expect(processManifest(manifestPath)).rejects.toThrow(/REJECT_STAGING_IMPORT_WOULD_OVERWRITE_RETAINED_RELATION \[PROTECTION_UNVERIFIABLE\]/);
    expect(h.state.created).toEqual([]);
    expect(h.state.spawned).toEqual([]);
  });

  it('an unprotected leftover relation (a FAILED import of this version, no record) may be overwritten: the import proceeds', async () => {
    h.state.ledger.push(ledgerRow('batch-failed', 'FAILED', HASH));
    const { processManifest } = await loadScript();
    await processManifest(manifestPath).catch(() => undefined); // the stubbed ogrinfo output fails later QA; irrelevant here
    expect(h.state.created).toHaveLength(1);
    expect(h.state.spawned.length).toBeGreaterThan(0);
  });

  it('no relation yet: nothing to overwrite, the CAS is not even opened', async () => {
    h.state.relationExists = false;
    const { processManifest } = await loadScript();
    await processManifest(manifestPath).catch(() => undefined);
    expect(h.state.casOpened).toBe(0);
    expect(h.state.created).toHaveLength(1);
  });
});

describe('U30F2 M3: import-staging names every NEW staging relation with the current scheme', () => {
  it('every import-registry target fits <table>_<24 hex> within PostgreSQL\'s 63 bytes (no truncation, no suffix)', async () => {
    const { IMPORT_REGISTRY } = await import('../../../scripts/import/config/importRegistry');
    const { retainedRelationFor } = await import('../../../packages/spatial-provider-postgis/src/SpatialDatasetRetention');
    const tables = Object.values(IMPORT_REGISTRY).flatMap((datasets) => Object.values(datasets).map((e) => e.target_table));
    expect(tables.length).toBeGreaterThan(30);
    for (const table of tables) {
      const name = retainedRelationFor({ schema: 'env', table }, HASH).table;
      expect(Buffer.byteLength(name, 'utf8'), name).toBeLessThanOrEqual(63);
      expect(name, table).toBe(`${table}_${HASH.slice(0, 24)}`);
    }
  });

  it('the relation import-staging checks and writes is lm_staging.<table>_<first 24 hex>, never the legacy 8-hex name', async () => {
    h.state.relationExists = false;
    const { processManifest } = await loadScript();
    await processManifest(manifestPath).catch(() => undefined);
    expect(h.state.regclass).toEqual([`"lm_staging"."${RELATION}"`]);
    for (const c of h.state.spawned.filter((x) => x.includes('-nln'))) expect(c).toContain(`-nln lm_staging.${RELATION}`);
  });

  it('a claim on the legacy 8-hex name of another version does not block the new 24-hex relation', async () => {
    const repo = new InMemoryArtifactRepository();
    const id = claimId(`lm_staging.${LEGACY_RELATION}`);
    const body = { artifact_id: id, payload: { retained_relation: `lm_staging.${LEGACY_RELATION}`, content_bundle_sha256: 'aaaabbbb' + 'e'.repeat(56) } };
    await repo.put({ artifact_id: id, content_hash: sha256ContentHash(body), body });
    h.state.repo = repo;
    h.state.relationExists = false;
    const { processManifest } = await loadScript();
    await processManifest(manifestPath).catch(() => undefined);
    expect(h.state.created).toHaveLength(1);
  });
});
