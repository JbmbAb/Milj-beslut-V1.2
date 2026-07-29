import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FileArtifactStore,
  createApprovalRecord,
  createPromotionArtifactV3,
  migratePromotionWormV1,
  type PromotionArtifactV2,
} from '../../../server/artifact';
import { hashArtifactPayload } from '../../../server/utils/hashArtifact';

const fitness = { rawFitness: 1, penalty: 0, fitness: 1 };

describe('WORM one-shot namespace migration', () => {
  it('migrates only promotion-approved into promotion/; archives rejected legacy promotions', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'worm-migrate-'));
    const store = new FileArtifactStore(root);

    const approvedV2: PromotionArtifactV2 = {
      id: 'promotion-ok',
      pipelineId: 'p1',
      executionHash: 'sha256:exec-ok',
      pipelineDefinition: { id: 'p1', version: '1', nodes: [] },
      mutationChain: [{ id: 'm1', type: 'low_risk' }],
      fitness,
      promotedAt: 100,
      schemaVersion: 'promotion.v2',
      artifactHash: 'sha256:old-ok',
      sourceExperimentId: 'exp-ok',
      approvalDecision: { approved: true, reviewer: 'legacy', timestamp: 100 },
    };

    const rejectedV2: PromotionArtifactV2 = {
      id: 'promotion-no',
      pipelineId: 'p1',
      executionHash: 'sha256:exec-no',
      pipelineDefinition: { id: 'p1', version: '1', nodes: [] },
      mutationChain: [{ id: 'm2', type: 'risky' }],
      fitness,
      promotedAt: 101,
      schemaVersion: 'promotion.v2',
      artifactHash: 'sha256:old-no',
      sourceExperimentId: 'exp-no',
      approvalDecision: { approved: false, reviewer: 'legacy', timestamp: 101 },
    };

    await store.put('promotion/promotion-ok', approvedV2);
    await store.put('promotion-approved/promotion-ok', approvedV2);
    await store.put('approval/promotion-ok', approvedV2.approvalDecision);
    await store.put('promotion/promotion-no', rejectedV2);

    const dry = await migratePromotionWormV1(store, { dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.approvedMigrated).toBe(1);
    expect(dry.rejectedArchived).toBe(1);
    expect(await store.list('legacy-rejected-promotion/')).toEqual([]);

    const live = await migratePromotionWormV1(store, { dryRun: false });
    expect(live.approvedMigrated).toBe(1);
    expect(live.rejectedArchived).toBe(1);

    const archived = await store.get('legacy-rejected-promotion/promotion-no');
    expect(archived).toMatchObject({ id: 'promotion-no', schemaVersion: 'promotion.v2' });

    const newPromotions = (await store.list('promotion/')).filter((k) => k.includes('sha256:'));
    expect(newPromotions.length).toBeGreaterThanOrEqual(1);

    const sealed = await store.get<{ approvalRecordId: string; schemaVersion: string }>(newPromotions[0]!);
    expect(sealed?.schemaVersion).toBe('promotion.v3');
    expect(sealed?.approvalRecordId).toMatch(/^legacy-apr-/);

    const apr = await store.get(`approval/${sealed!.approvalRecordId}`);
    expect(apr).toMatchObject({ subjectType: 'promotion-candidate', subjectId: 'exp-ok' });
  });

  it('does not treat already-sealed v3 keys as rejected legacy', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'worm-migrate-v3-'));
    const store = new FileArtifactStore(root);

    const approval = createApprovalRecord({
      approvalId: 'apr-1',
      subjectId: 'c1',
      subjectType: 'promotion-candidate',
      decision: { approved: true, timestamp: 1 },
      evolutionRunId: 'r1',
      schemaVersion: 'approval.v1',
      createdAt: 1,
    });
    const v3 = createPromotionArtifactV3({
      humanId: 'h',
      pipelineId: 'p',
      executionHash: 'sha256:e',
      pipelineDefinitionRef: `definition:${hashArtifactPayload({})}`,
      mutationChain: [],
      fitness,
      promotedAt: 1,
      sourceExperimentId: 'e1',
      evolutionRunId: 'r1',
      approvalRecordId: approval.approvalId,
      schemaVersion: 'promotion.v3',
    });

    await store.put(`promotion/${v3.artifactHash}`, v3);
    const summary = await migratePromotionWormV1(store, { dryRun: false });
    expect(summary.rejectedArchived).toBe(0);
    expect(await store.list('legacy-rejected-promotion/')).toEqual([]);
  });
});
