/**
 * U30-B2 (PRES-05): scripts/import/import-librarian-manifest.ts must retain the OUTGOING dataset
 * version before its `replace` promote truncates the live table, record the INCOMING version's
 * retention after SUCCESS, and never delete SUCCESS ledger rows on --retry-failed.
 *
 * Behavioural, hermetic: the real script module (processManifest) and the real retention module
 * run against a scripted fake Prisma client (server/db/prisma is replaced, so the real client is
 * never evaluated), an in-memory CAS (MimersIntegration.create is replaced) and stubbed QA/indexing
 * helpers. The manifest lives in a temp directory. Every SQL statement and every CAS write lands in
 * one ordered call log, so "record before TRUNCATE" and "no TRUNCATE at all" are observable.
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const HASH_V1 = '2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc';
const HASH_V2 = 'aaaabbbb00000000000000000000000000000000000000000000000000000002';

const h = vi.hoisted(() => {
  type Table = { columns: Array<{ name: string; type: string; typname: string }>; digest: { row_count: number; digest: string } };
  type Batch = { id: string; content_bundle_sha256: string; dataset_version: string | null; status: string; target_schema: string; target_table: string };
  const state = {
    log: [] as string[],
    tables: new Map<string, Table>(),
    batches: [] as Batch[],
    updates: [] as Array<{ id: string; status?: string; error_message?: string }>,
    deleteManyCalls: 0,
    casStore: new Map<string, { content_hash: { value: string }; body: unknown }>(),
    casCreateFails: false,
    failIncomingRecord: false,
    failIncomingRecordId: '',
  };
  const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim();
  const fake = {
    postgisImportBatch: {
      async findFirst(args: { where: { status: string; content_bundle_sha256: string } }) {
        return state.batches.find((b) => b.status === args.where.status && b.content_bundle_sha256 === args.where.content_bundle_sha256) ?? null;
      },
      async update(args: { where: { id: string }; data: { status?: string; error_message?: string } }) {
        state.updates.push({ id: args.where.id, ...args.data });
        const row = state.batches.find((b) => b.id === args.where.id);
        if (row && args.data.status) row.status = args.data.status;
        state.log.push(`ledger:${args.data.status}`);
        return row;
      },
      async deleteMany() {
        state.deleteManyCalls += 1;
        state.log.push('ledger:deleteMany');
        return { count: 0 };
      },
    },
    async $queryRawUnsafe(sql: string, ...params: unknown[]) {
      const s = normalize(sql);
      if (s.includes('FROM "PostgisImportBatch"') && s.includes('LIMIT 1')) {
        const success = state.batches.filter((b) => b.status === 'SUCCESS' && b.target_schema === params[0] && b.target_table === params[1]);
        const last = success[success.length - 1];
        state.log.push('query:current-batch');
        return last ? [{ id: last.id, content_bundle_sha256: last.content_bundle_sha256, dataset_version: last.dataset_version }] : [];
      }
      if (s.startsWith('SELECT to_regclass')) return [{ exists: state.tables.has(String(params[0]).replace(/"/g, '')) }];
      // U30F2 H3: the first-import trail reads (the whole ledger of the target, the retained relations by prefix).
      if (s.startsWith('SELECT id, status, content_bundle_sha256 FROM "PostgisImportBatch"')) {
        state.log.push('query:target-ledger');
        return state.batches.filter((b) => b.target_schema === params[0] && b.target_table === params[1]).map((b) => ({ id: b.id, status: b.status, content_bundle_sha256: b.content_bundle_sha256 }));
      }
      if (s.includes('FROM pg_class c JOIN pg_namespace n')) {
        const [schema, prefix] = params as string[];
        return [...state.tables.keys()].filter((k) => k.startsWith(`${schema}.${prefix}`)).map((k) => ({ relname: k.slice(schema!.length + 1) }));
      }
      if (s.startsWith('SELECT EXISTS (SELECT 1 FROM')) {
        const m = s.match(/FROM "([^"]+)"\."([^"]+)"/)!;
        state.log.push(`has-rows:${m[1]}.${m[2]}`);
        return [{ has_rows: (state.tables.get(`${m[1]}.${m[2]}`)?.digest.row_count ?? 0) > 0 }];
      }
      if (s.includes('FROM pg_attribute')) return state.tables.get(`${params[0]}.${params[1]}`)?.columns ?? [];
      if (s.startsWith('WITH row_hashes')) {
        const m = s.match(/FROM "([^"]+)"\."([^"]+)" src/)!;
        const key = `${m[1]}.${m[2]}`;
        state.log.push(`digest:${key}`);
        const t = state.tables.get(key)!;
        return [{ row_count: BigInt(t.digest.row_count), digest: t.digest.digest }];
      }
      throw new Error(`fake prisma: unexpected query ${s}`);
    },
    async $executeRawUnsafe(sql: string) {
      const s = normalize(sql);
      if (s.startsWith('LOCK TABLE')) state.log.push(`lock:${s.includes('ACCESS EXCLUSIVE') ? 'ACCESS EXCLUSIVE' : 'SHARE'}`);
      else if (s.startsWith('CREATE SCHEMA')) state.log.push('create-schema');
      else if (s.startsWith('CREATE TABLE "lm_staging"')) {
        const m = s.match(/^CREATE TABLE "([^"]+)"\."([^"]+)" AS SELECT \* FROM "([^"]+)"\."([^"]+)"$/)!;
        const src = state.tables.get(`${m[3]}.${m[4]}`)!;
        state.tables.set(`${m[1]}.${m[2]}`, { columns: [...src.columns], digest: { ...src.digest } });
        state.log.push(`ctas:${m[1]}.${m[2]}`);
      } else if (s.startsWith('TRUNCATE')) state.log.push('TRUNCATE');
      else if (s.startsWith('INSERT INTO env.sgu_well')) {
        // the promoted live table now holds exactly the staged rows (of the staging relation the INSERT reads)
        const staging = s.match(/FROM (\S+)$/)![1]!;
        state.tables.set('env.sgu_well', { ...state.tables.get('env.sgu_well')!, digest: { ...state.tables.get(staging)!.digest } });
        state.log.push('INSERT');
      } else throw new Error(`fake prisma: unexpected statement ${s}`);
      return 0;
    },
    async $transaction(arg: unknown) {
      if (typeof arg === 'function') {
        state.log.push('BEGIN');
        try {
          const result = await (arg as (tx: unknown) => Promise<unknown>)(fake);
          state.log.push('COMMIT');
          return result;
        } catch (error) {
          state.log.push('ROLLBACK');
          throw error;
        }
      }
      return Promise.all(arg as Promise<unknown>[]);
    },
    async $disconnect() {},
  };
  const repo = {
    async put(artifact: { artifact_id: string; content_hash: { value: string }; body: unknown }) {
      if (state.failIncomingRecord && artifact.artifact_id === state.failIncomingRecordId) throw new Error('ENOSPC: CAS volume full');
      state.log.push(`cas:put:${artifact.artifact_id}`);
      const existing = state.casStore.get(artifact.artifact_id);
      if (existing && existing.content_hash.value !== artifact.content_hash.value) throw new Error(`WORM violation: ${artifact.artifact_id}`);
      state.casStore.set(artifact.artifact_id, { content_hash: artifact.content_hash, body: artifact.body });
    },
    async resolve(ref: { artifact_id: string }) {
      const hit = state.casStore.get(ref.artifact_id);
      if (!hit) throw new Error(`Artifact not found: ${ref.artifact_id}`);
      return hit.body;
    },
  };
  return { state, fake, repo };
});

vi.mock('../../../server/db/prisma', () => ({ prisma: h.fake }));
vi.mock('../../../scripts/db/sync-property-unit-from-env', () => ({ syncPropertyUnitFromEnv: vi.fn() }));
vi.mock('../../../packages/mps-runtime/src/mimers/MimersIntegration', () => ({
  MimersIntegration: {
    create: vi.fn(async () => {
      if (h.state.casCreateFails) throw new Error('MIMERS_ROOT_REQUIRED: MIMERS_REQUIRED set but MIMERS_ROOT missing for ExecutionKernel CAS');
      return { artifactRepository: h.repo };
    }),
  },
}));
vi.mock('../../../scripts/import/importLibrarianQa', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  tableExists: vi.fn(async () => true),
  countTableRows: vi.fn(async () => 3),
  buildPromoteInsertSql: vi.fn(
    async (_p: unknown, _ts: string, _tt: string, stagingSchema: string, stagingTable: string) =>
      `INSERT INTO env.sgu_well ("brunnsid") SELECT "brunnsid" FROM ${stagingSchema}.${stagingTable}`,
  ),
  applyPostImportIndexing: vi.fn(async () => ({ brinColumn: null, rowCount: 3 })),
  smokeMapLayerForTable: vi.fn(async () => ({ skipped: true, detail: 'hermetic test' })),
}));

import { retentionRecordId, type SpatialDatasetRetentionRecord } from '../../../packages/spatial-provider-postgis/src/SpatialDatasetRetention';
import { buildPromoteInsertSql, tableExists } from '../../../scripts/import/importLibrarianQa';

const LIVE_COLUMNS = [
  { name: 'id', type: 'integer', typname: 'int4' },
  { name: 'brunnsid', type: 'character varying(32)', typname: 'varchar' },
];
const STAGING_COLUMNS = [
  { name: 'ogc_fid', type: 'integer', typname: 'int4' },
  { name: 'brunnsid', type: 'character varying', typname: 'varchar' },
];

let workDir: string;
let manifestPath: string;
const savedArgv = process.argv;
const savedExitCode = process.exitCode;

async function loadScript(extraArgs: string[] = []) {
  vi.resetModules();
  process.argv = [process.argv[0]!, 'import-librarian-manifest.ts', '--mode', 'promote', '--execute', ...extraArgs];
  return import('../../../scripts/import/import-librarian-manifest');
}

function seed(options: { retainedDigest: string; staging?: boolean } = { retainedDigest: '1'.repeat(64) }) {
  h.state.tables.set('env.sgu_well', { columns: LIVE_COLUMNS, digest: { row_count: 3, digest: '1'.repeat(64) } });
  h.state.tables.set('lm_staging.sgu_well_2b4b514f', { columns: STAGING_COLUMNS, digest: { row_count: 3, digest: options.retainedDigest } });
  h.state.tables.set('lm_staging.sgu_well_aaaabbbb', { columns: STAGING_COLUMNS, digest: { row_count: 3, digest: '2'.repeat(64) } });
  h.state.batches.push(
    { id: 'batch-v1', content_bundle_sha256: HASH_V1, dataset_version: 'v1', status: 'SUCCESS', target_schema: 'env', target_table: 'sgu_well' },
    { id: 'batch-v2', content_bundle_sha256: HASH_V2, dataset_version: 'v2', status: 'STAGING_IMPORTED', target_schema: 'env', target_table: 'sgu_well' },
  );
}

beforeEach(() => {
  h.state.log.length = 0;
  h.state.tables.clear();
  h.state.batches.length = 0;
  h.state.updates.length = 0;
  h.state.deleteManyCalls = 0;
  h.state.casStore.clear();
  h.state.casCreateFails = false;
  h.state.failIncomingRecord = false;
  process.exitCode = undefined;
  workDir = mkdtempSync(path.join(tmpdir(), 'u30b-import-'));
  mkdirSync(path.join(workDir, 'SGU', 'Brunnar'), { recursive: true });
  manifestPath = path.join(workDir, 'SGU', 'Brunnar', 'manifest.json');
  writeFileSync(
    manifestPath,
    JSON.stringify({
      schema_version: '2.0',
      provider: 'SGU',
      dataset: 'Brunnar',
      version: 'v2',
      provenance: 'hermetic test fixture',
      content_bundle_sha256: HASH_V2,
      total_bytes: 1,
      files: ['brunnar.gpkg'],
      qa_status: 'staging_ok',
    }),
    'utf8',
  );
});

afterEach(() => {
  process.argv = savedArgv;
  process.exitCode = savedExitCode;
  rmSync(workDir, { recursive: true, force: true });
});

describe('import-librarian-manifest promote: retain before replace (U30-B2, PRES-05)', () => {
  it('outgoing version retained -> its CAS record is written BEFORE the TRUNCATE; incoming version recorded after SUCCESS', async () => {
    seed();
    const { processManifest } = await loadScript();
    await processManifest(manifestPath);

    const outgoingId = retentionRecordId({ schema: 'env', table: 'sgu_well' }, HASH_V1);
    const incomingId = retentionRecordId({ schema: 'env', table: 'sgu_well' }, HASH_V2);
    const log = h.state.log;
    expect(log.indexOf(`cas:put:${outgoingId}`)).toBeGreaterThan(-1);
    expect(log.indexOf(`cas:put:${outgoingId}`)).toBeLessThan(log.indexOf('TRUNCATE'));
    expect(log.indexOf('lock:ACCESS EXCLUSIVE')).toBeLessThan(log.indexOf('TRUNCATE'));
    expect(log.indexOf('ledger:SUCCESS')).toBeGreaterThan(log.indexOf('INSERT'));
    expect(log.indexOf(`cas:put:${incomingId}`)).toBeGreaterThan(log.indexOf('ledger:SUCCESS'));
    const outgoing = h.state.casStore.get(outgoingId)!.body as SpatialDatasetRetentionRecord;
    expect(outgoing.payload).toMatchObject({ import_batch_id: 'batch-v1', retained_relation: 'lm_staging.sgu_well_2b4b514f' });
    const incoming = h.state.casStore.get(incomingId)!.body as SpatialDatasetRetentionRecord;
    expect(incoming.payload).toMatchObject({ import_batch_id: 'batch-v2', retained_relation: 'lm_staging.sgu_well_aaaabbbb' });
    expect(process.exitCode).toBeUndefined();
  });

  it('outgoing version NOT retained (digest differs) -> promote refused: no TRUNCATE, batch FAILED with the reject code', async () => {
    seed({ retainedDigest: 'f'.repeat(64) });
    const { processManifest } = await loadScript();

    await expect(processManifest(manifestPath)).rejects.toThrow(/REJECT_PROMOTE_OUTGOING_VERSION_NOT_RETAINED/);
    expect(h.state.log).not.toContain('TRUNCATE');
    expect(h.state.log).not.toContain('INSERT');
    expect(h.state.updates.map((u) => u.status)).not.toContain('SUCCESS');
    const failed = h.state.updates.find((u) => u.status === 'FAILED');
    expect(failed?.error_message).toMatch(/REJECT_PROMOTE_OUTGOING_VERSION_NOT_RETAINED \[DIGEST_MISMATCH\]/);
  });

  it('durable CAS unavailable -> promote refused before anything is written to the ledger or the table', async () => {
    seed();
    h.state.casCreateFails = true;
    const { processManifest } = await loadScript();

    await expect(processManifest(manifestPath)).rejects.toThrow(/REJECT_PROMOTE_OUTGOING_VERSION_NOT_RETAINED \[CAS_UNAVAILABLE\]/);
    expect(h.state.log).not.toContain('TRUNCATE');
    expect(h.state.updates).toEqual([]);
  });

  it('F5: the ledger has no SUCCESS batch but live holds rows -> promote refused, no TRUNCATE, batch FAILED (a CAS record never stands in)', async () => {
    seed();
    h.state.batches.splice(h.state.batches.findIndex((b) => b.id === 'batch-v1'), 1);
    // CAS still records the version live holds; it must not matter.
    const outgoingId = retentionRecordId({ schema: 'env', table: 'sgu_well' }, HASH_V1);
    h.state.casStore.set(outgoingId, { content_hash: { value: 'x' }, body: { artifact_id: outgoingId } });
    const { processManifest } = await loadScript();

    await expect(processManifest(manifestPath)).rejects.toThrow(/REJECT_PROMOTE_OUTGOING_VERSION_NOT_RETAINED \[NO_SUCCESS_BATCH_FOR_LIVE_DATA\]/);
    expect(h.state.log).not.toContain('TRUNCATE');
    expect(h.state.log).not.toContain('INSERT');
    expect(h.state.updates.map((u) => u.status)).toEqual(['PROMOTE_STARTED', 'FAILED']);
  });

  it('F4: a replace promote of the property layer is refused before PROMOTE_STARTED while its digest time is unmeasured', async () => {
    const HASH_P = '7aff5455' + '0'.repeat(56);
    mkdirSync(path.join(workDir, 'LM'), { recursive: true });
    const propertyManifest = path.join(workDir, 'LM', 'manifest.json');
    writeFileSync(
      propertyManifest,
      JSON.stringify({
        schema_version: '2.0',
        provider: 'Lantmateriet',
        dataset: 'Fastighetsindelning_Nationell/Registerenhetsomradesytor',
        version: '2026-06-28',
        provenance: 'hermetic test fixture',
        content_bundle_sha256: HASH_P,
        total_bytes: 1,
        files: ['fastighet.gpkg'],
        qa_status: 'staging_ok',
      }),
      'utf8',
    );
    h.state.batches.push({ id: 'batch-p', content_bundle_sha256: HASH_P, dataset_version: '2026-06-28', status: 'STAGING_IMPORTED', target_schema: 'env', target_table: 'registerenhetsomradesytor' });
    const { processManifest } = await loadScript();

    await expect(processManifest(propertyManifest)).rejects.toThrow(/REJECT_RETENTION_DIGEST_TIME_UNMEASURED/);
    expect(h.state.updates).toEqual([]);
    expect(h.state.log).toEqual([]);
  });

  it('--retry-failed never deletes SUCCESS ledger rows', async () => {
    seed();
    const { processManifest } = await loadScript(['--retry-failed']);
    await processManifest(manifestPath);

    expect(h.state.deleteManyCalls).toBe(0);
    expect(h.state.log).not.toContain('ledger:deleteMany');
    expect(h.state.updates.map((u) => u.status)).toContain('SUCCESS');
  });

  it('a failure to record the INCOMING version after SUCCESS is loud (exit code 1) but never marks the promoted batch FAILED', async () => {
    seed();
    h.state.failIncomingRecord = true;
    h.state.failIncomingRecordId = retentionRecordId({ schema: 'env', table: 'sgu_well' }, HASH_V2);
    const { processManifest } = await loadScript();
    await processManifest(manifestPath);

    expect(h.state.log).toContain('TRUNCATE');
    expect(h.state.updates.map((u) => u.status)).toEqual(['PROMOTE_STARTED', 'SUCCESS']);
    expect(process.exitCode).toBe(1);
  });
});

describe('U30F2 M3: promote reads the version from the relation it was staged in (current name first, then legacy)', () => {
  it('a version staged after the switch is promoted from, and recorded in, its 24-hex staging relation', async () => {
    seed();
    const legacy = h.state.tables.get('lm_staging.sgu_well_aaaabbbb')!;
    h.state.tables.delete('lm_staging.sgu_well_aaaabbbb');
    h.state.tables.set('lm_staging.sgu_well_aaaabbbb0000000000000000', legacy);
    const { processManifest } = await loadScript();
    await processManifest(manifestPath);
    const calls = vi.mocked(buildPromoteInsertSql).mock.calls;
    expect(calls[calls.length - 1]!.slice(3)).toEqual(['lm_staging', 'sgu_well_aaaabbbb0000000000000000']);
    const incomingId = retentionRecordId({ schema: 'env', table: 'sgu_well' }, HASH_V2);
    expect((h.state.casStore.get(incomingId)!.body as SpatialDatasetRetentionRecord).payload).toMatchObject({
      retained_relation: 'lm_staging.sgu_well_aaaabbbb0000000000000000',
      retained_relation_naming: 'RETAINED_RELATION_NAME_V2_24HEX',
    });
  });

  it('a version staged before the switch is promoted from its legacy 8-hex relation, which is never renamed', async () => {
    seed();
    const { processManifest } = await loadScript();
    await processManifest(manifestPath);
    const calls = vi.mocked(buildPromoteInsertSql).mock.calls;
    expect(calls[calls.length - 1]!.slice(3)).toEqual(['lm_staging', 'sgu_well_aaaabbbb']);
    expect(h.state.log.some((e) => /rename|ctas:lm_staging\.sgu_well_aaaabbbb/i.test(e))).toBe(false);
  });

  it('no staging relation under either name -> the promote is refused before PROMOTE_STARTED', async () => {
    seed();
    h.state.tables.delete('lm_staging.sgu_well_aaaabbbb');
    const { processManifest } = await loadScript();
    await expect(processManifest(manifestPath)).rejects.toThrow(/REJECT_PROMOTE_STAGING_RELATION_MISSING/);
    expect(h.state.updates).toEqual([]);
    expect(h.state.log).not.toContain('TRUNCATE');
  });
});

describe('U30F2 H3: a MISSING live table is not a first import either', () => {
  it('the bootstrap (CREATE TABLE ... AS from staging) is refused without a committed admission; nothing is created', async () => {
    seed();
    h.state.batches.splice(h.state.batches.findIndex((b) => b.id === 'batch-v1'), 1); // no SUCCESS batch
    h.state.tables.delete('env.sgu_well');
    vi.mocked(tableExists).mockResolvedValueOnce(false);
    const { processManifest } = await loadScript();
    await expect(processManifest(manifestPath)).rejects.toThrow(/REJECT_FIRST_IMPORT_NOT_ADMITTED \[NO_ADMISSION\]/);
    expect(h.state.tables.has('env.sgu_well')).toBe(false);
    expect(h.state.log.some((e) => /^ctas:env\./.test(e))).toBe(false);
    expect(h.state.updates.map((u) => u.status)).toEqual(['PROMOTE_STARTED', 'FAILED']);
  });

  it('an emptied live table with an earlier version still in lm_staging is refused (the empty-table loophole is closed in the script path too)', async () => {
    seed();
    h.state.batches.splice(h.state.batches.findIndex((b) => b.id === 'batch-v1'), 1);
    h.state.tables.set('env.sgu_well', { ...h.state.tables.get('env.sgu_well')!, digest: { row_count: 0, digest: '0'.repeat(64) } });
    const { processManifest } = await loadScript();
    await expect(processManifest(manifestPath)).rejects.toThrow(/REJECT_FIRST_IMPORT_NOT_ADMITTED/);
    expect(h.state.log).not.toContain('TRUNCATE');
    expect(h.state.log).not.toContain('INSERT');
  });
});
