/**
 * U30-B2 cleanup-staging (PRES-05): `--mode cleanup-staging` must never drop a staging relation that
 * is the retained relation of a SUCCESS version, or of a version with a retention record in CAS.
 *
 * The mocked ledger reproduces the situation observed on 2026-10-02 (U20-U30-SPEC §1.2 / §5, read-only
 * SELECTs): ebh has 2 FAILED rows and natura2000 has 5 FAILED rows with the same hash as their SUCCESS
 * version, and the property source env.registerenhetsomradesytor has a SUCCESS version 7aff5455.
 * The original cleanup dropped `lm_staging.<table>_<hash8>` for every FAILED row -- i.e. exactly those
 * versions' only materialisation.
 *
 * Fixture note: the 7aff5455 and 4ed76ac8 hashes are only known by their 8-hex prefix; the remainder
 * here is synthetic. The relation name (and so the SUCCESS-batch protection) depends on the prefix only.
 *
 * Behavioural and hermetic: the real script (cleanupStaging) and the real protection module run
 * against a scripted fake Prisma client (server/db/prisma is replaced, never evaluated) and an
 * in-memory CAS (MimersIntegration.create is replaced). Every DROP statement is recorded.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const EBH = '02fccffc07abaaf1775c8333d660fa60fdecea0c3bb664335892764c8486d186';
const NATURA = 'a5d665ae7bfde9ebeaa4883d5db7bbf70aea9cb7ad5a3f621c4cdbc003ad7f02';
const PROPERTY_LIVE = '7aff5455' + '0'.repeat(56); // prefix real, remainder synthetic (see header)
const PROPERTY_OLD = '4ed76ac8' + '0'.repeat(56); // prefix real, remainder synthetic
const UNBOUND = 'deadbeef' + '1'.repeat(56);
const STALE = 'cafebabe' + '2'.repeat(56);

const h = vi.hoisted(() => {
  type Row = { id: string; status: string; target_schema: string; target_table: string; content_bundle_sha256: string; started_at?: Date };
  const state = {
    successBatches: [] as Row[],
    badBatches: [] as Row[],
    drops: [] as string[],
    statements: [] as string[],
    findManyWhere: null as unknown,
    casCreateFails: false,
    protectionQueryFails: false,
    repo: null as unknown,
    /** U30F F9: every ledger protection read is counted; after `flipAfterReads` reads, `flipRow` becomes a SUCCESS row. */
    protectionReads: 0,
    flipAfterReads: 0,
    flipRow: null as Row | null,
  };
  const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim();
  const nameOf = (b: Row) => `${b.target_table}_${b.content_bundle_sha256.substring(0, 8)}`;
  const protectionRead = () => {
    if (state.protectionQueryFails) throw new Error('simulated database failure');
    state.protectionReads += 1;
    if (state.flipRow && state.protectionReads > state.flipAfterReads && !state.successBatches.includes(state.flipRow)) {
      state.successBatches.push(state.flipRow);
    }
  };
  const fake = {
    postgisImportBatch: {
      async findMany(args: { where: unknown }) {
        state.findManyWhere = args.where;
        return state.badBatches;
      },
    },
    async $queryRawUnsafe(sql: string, ...params: unknown[]) {
      const s = normalize(sql);
      if (s.includes('FROM "PostgisImportBatch"') && s.includes('EXISTS')) {
        protectionRead();
        const name = String(params[0]);
        return [{ protected: state.successBatches.some((b) => nameOf(b) === name) }];
      }
      if (s.includes('FROM "PostgisImportBatch"')) {
        protectionRead();
        const name = String(params[0]);
        return [...state.successBatches, ...state.badBatches].filter((b) => nameOf(b) === name).map((b) => ({ started_at: new Date(0), ...b }));
      }
      if (s.startsWith('SELECT to_regclass')) return [{ exists: true }];
      throw new Error(`fake prisma: unexpected query ${s}`);
    },
    async $executeRawUnsafe(sql: string) {
      const s = normalize(sql);
      state.statements.push(s);
      if (s.startsWith('DROP TABLE')) state.drops.push(s);
      else if (!s.startsWith('LOCK TABLE') && !s.startsWith('SET LOCAL')) throw new Error(`fake prisma: unexpected statement ${s}`);
      return 0;
    },
    async $transaction(work: (tx: unknown) => Promise<unknown>) {
      state.statements.push('BEGIN');
      const result = await work(fake);
      state.statements.push('COMMIT');
      return result;
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
      if (h.state.casCreateFails) throw new Error('MIMERS_ROOT_REQUIRED: MIMERS_REQUIRED set but MIMERS_ROOT missing for ExecutionKernel CAS');
      return { artifactRepository: h.state.repo };
    }),
  },
}));

import { InMemoryArtifactRepository } from '../../../packages/mps-runtime/src/repository/InMemoryArtifactRepository';
import { sha256ContentHash } from '../../../packages/mps-runtime/src/kernel/ExecutionKernel';
import { retentionRecordId } from '../../../packages/spatial-provider-postgis/src/SpatialDatasetRetention';

const savedArgv = process.argv;
const savedExitCode = process.exitCode;
let output: string[];

function row(id: string, status: string, table: string, hash: string) {
  return { id, status, target_schema: 'env', target_table: table, content_bundle_sha256: hash };
}

async function loadScript(execute: boolean) {
  vi.resetModules();
  process.argv = [process.argv[0]!, 'import-librarian-manifest.ts', '--mode', 'cleanup-staging', ...(execute ? ['--execute'] : [])];
  return import('../../../scripts/import/import-librarian-manifest');
}

/** The 2026-10-02 ledger shape plus one unbound FAILED version and one stale STAGING_STARTED. */
async function seedObservedLedger() {
  h.state.successBatches.push(
    row('fb72b56b', 'SUCCESS', 'ebh_potentiellt_fororenade_omraden', EBH),
    row('29e0b358', 'SUCCESS', 'natura2000_area', NATURA),
    row('batch-7aff5455', 'SUCCESS', 'registerenhetsomradesytor', PROPERTY_LIVE),
  );
  h.state.badBatches.push(
    row('ebh-failed-1', 'FAILED', 'ebh_potentiellt_fororenade_omraden', EBH),
    row('ebh-failed-2', 'FAILED', 'ebh_potentiellt_fororenade_omraden', EBH),
    ...[1, 2, 3, 4, 5].map((n) => row(`natura-failed-${n}`, 'FAILED', 'natura2000_area', NATURA)),
    row('property-failed-1', 'FAILED', 'registerenhetsomradesytor', PROPERTY_LIVE),
    row('property-old-failed', 'FAILED', 'registerenhetsomradesytor', PROPERTY_OLD),
    row('unbound-failed', 'FAILED', 'sgu_well', UNBOUND),
    row('stale-started', 'STAGING_STARTED', 'protected_area', STALE),
  );
  // The replaced property version has no SUCCESS row in this fixture, but its retention record is in CAS.
  const repo = new InMemoryArtifactRepository();
  const target = { schema: 'env', table: 'registerenhetsomradesytor' };
  const record = { artifact_id: retentionRecordId(target, PROPERTY_OLD), artifact_type: 'SPATIAL_DATASET_RETENTION_RECORD', payload: { target } };
  await repo.put({ artifact_id: record.artifact_id, content_hash: sha256ContentHash(record), body: record });
  h.state.repo = repo;
}

const PROTECTED_RELATIONS = [
  'ebh_potentiellt_fororenade_omraden_02fccffc',
  'natura2000_area_a5d665ae',
  'registerenhetsomradesytor_7aff5455',
  'registerenhetsomradesytor_4ed76ac8',
];

/** The lm_staging relations a DROP statement was issued for, in order. */
function droppedRelations(): string[] {
  return h.state.drops.map((d) => d.match(/"lm_staging"\."([^"]+)"/)?.[1] ?? `UNPARSED ${d}`);
}

beforeEach(() => {
  h.state.successBatches.length = 0;
  h.state.badBatches.length = 0;
  h.state.drops.length = 0;
  h.state.statements.length = 0;
  h.state.protectionReads = 0;
  h.state.flipAfterReads = 0;
  h.state.flipRow = null;
  h.state.casCreateFails = false;
  h.state.protectionQueryFails = false;
  h.state.repo = null;
  process.exitCode = undefined;
  output = [];
  for (const method of ['log', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(' '));
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  process.argv = savedArgv;
  process.exitCode = savedExitCode;
});

describe('cleanup-staging keeps retained relations (U30-B2 cleanup-staging, PRES-05)', () => {
  it('a run over the observed ledger does NOT drop the ebh, natura2000 or property 7aff5455 relations; only unprotected ones go', async () => {
    await seedObservedLedger();
    const { cleanupStaging } = await loadScript(true);
    await cleanupStaging();

    for (const name of PROTECTED_RELATIONS) {
      expect(h.state.drops.filter((d) => d.includes(name)), name).toEqual([]);
    }
    expect(droppedRelations()).toEqual(['protected_area_cafebabe', 'sgu_well_deadbeef']);
    const text = output.join('\n');
    expect(text).toMatch(/CLEANUP_SKIPPED_RETAINED_RELATION \[SUCCESS_BATCH\]: keeping lm_staging\.ebh_potentiellt_fororenade_omraden_02fccffc \(batches ebh-failed-1, ebh-failed-2\)/);
    expect(text).toMatch(/CLEANUP_SKIPPED_RETAINED_RELATION \[SUCCESS_BATCH\]: keeping lm_staging\.natura2000_area_a5d665ae/);
    expect(text).toMatch(/CLEANUP_SKIPPED_RETAINED_RELATION \[SUCCESS_BATCH\]: keeping lm_staging\.registerenhetsomradesytor_7aff5455/);
    expect(text).toMatch(/CLEANUP_SKIPPED_RETAINED_RELATION \[RETENTION_RECORD\]: keeping lm_staging\.registerenhetsomradesytor_4ed76ac8/);
    expect(process.exitCode).toBeUndefined();
  });

  it('dry run: the same decisions, nothing executed', async () => {
    await seedObservedLedger();
    const { cleanupStaging } = await loadScript(false);
    await cleanupStaging();

    expect(h.state.drops).toEqual([]);
    const wouldDrop = output.filter((line) => line.includes('Would run DROP TABLE'));
    expect(wouldDrop).toHaveLength(2);
    expect(wouldDrop.join('\n')).not.toMatch(/02fccffc|a5d665ae|7aff5455|4ed76ac8/);
    expect(output.filter((line) => line.includes('CLEANUP_SKIPPED_RETAINED_RELATION'))).toHaveLength(4);
  });

  it('durable CAS unavailable: SUCCESS-protected relations kept, everything else kept as unverifiable (fail-closed), exit code 1', async () => {
    await seedObservedLedger();
    h.state.casCreateFails = true;
    const { cleanupStaging } = await loadScript(true);
    await cleanupStaging();

    expect(h.state.drops).toEqual([]);
    expect(output.filter((line) => line.includes('CLEANUP_SKIPPED_PROTECTION_UNVERIFIABLE'))).toHaveLength(3);
    expect(process.exitCode).toBe(1);
  });

  it('a database error while checking protection stops the cleanup before ANY drop', async () => {
    await seedObservedLedger();
    h.state.protectionQueryFails = true;
    const { cleanupStaging } = await loadScript(true);

    await expect(cleanupStaging()).rejects.toThrow(/simulated database failure/);
    expect(h.state.drops).toEqual([]);
  });

  it('a relation name that is not a plain identifier is never interpolated into a DROP', async () => {
    h.state.badBatches.push(row('weird', 'FAILED', 'sgu_well"; DROP TABLE env.sgu_well; --', UNBOUND));
    h.state.repo = new InMemoryArtifactRepository();
    const { cleanupStaging } = await loadScript(true);
    await cleanupStaging();

    expect(h.state.drops).toEqual([]);
    expect(output.join('\n')).toMatch(/CLEANUP_SKIPPED_PROTECTION_UNVERIFIABLE/);
  });
});

describe('U30F F9: protection is checked again immediately before each DROP, in the DROP transaction', () => {
  it('a SUCCESS batch that appears between the plan and the DROP keeps the relation (no DROP issued)', async () => {
    h.state.badBatches.push(row('unbound-failed', 'FAILED', 'sgu_well', UNBOUND));
    h.state.repo = new InMemoryArtifactRepository();
    // The plan's ledger read sees no SUCCESS row; every later read does (a concurrent promote finished).
    h.state.flipAfterReads = 1;
    h.state.flipRow = row('concurrent-success', 'SUCCESS', 'sgu_well', UNBOUND);
    const { cleanupStaging } = await loadScript(true);
    await cleanupStaging();

    expect(h.state.drops).toEqual([]);
    expect(h.state.protectionReads).toBeGreaterThanOrEqual(2);
    expect(output.join('\n')).toMatch(/CLEANUP_SKIPPED_RETAINED_RELATION \[SUCCESS_BATCH\].*sgu_well_deadbeef/);
  });

  it('the DROP runs inside one transaction after an exclusive lock on the relation and the re-check', async () => {
    h.state.badBatches.push(row('unbound-failed', 'FAILED', 'sgu_well', UNBOUND));
    h.state.repo = new InMemoryArtifactRepository();
    const { cleanupStaging } = await loadScript(true);
    await cleanupStaging();

    const s = h.state.statements;
    const drop = s.findIndex((x) => x.startsWith('DROP TABLE'));
    expect(drop).toBeGreaterThan(-1);
    const begin = s.lastIndexOf('BEGIN', drop);
    expect(begin).toBeGreaterThan(-1);
    expect(s.slice(begin, drop)).toContain('LOCK TABLE "lm_staging"."sgu_well_deadbeef" IN ACCESS EXCLUSIVE MODE');
    expect(s[drop]).toBe('DROP TABLE "lm_staging"."sgu_well_deadbeef"');
    expect(s.indexOf('COMMIT', drop)).toBeGreaterThan(drop);
  });
});
