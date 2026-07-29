import { approvalRecordFromDecision, type ApprovalRecord } from './ApprovalRecord';
import type { ArtifactStore } from './ArtifactStore';
import { createPromotionArtifactV3, promotionStoreKey } from './createPromotionArtifactV3';
import type { PromotionArtifactV2, PromotionArtifactV3 } from './PromotionArtifact';
import { hashArtifactPayload } from '../utils/hashArtifact';

export type WormMigrationSummary = {
  readonly timestamp: string;
  readonly sourceVersion: 'v2';
  readonly targetVersion: 'v3';
  readonly migrated: number;
  readonly rejected: number;
  readonly failed: number;
  readonly skipped: number;
  readonly dryRun: boolean;
  readonly writtenKeys: readonly string[];
  readonly reportHash?: string;
};

/**
 * One-shot WORM namespace migration (NOT for lazy migrateToLatest).
 * Writes migration-report.json (and optionally stores it under migration-report/).
 */
export async function migratePromotionWormV1(
  store: ArtifactStore,
  options: { readonly dryRun?: boolean; readonly writeReport?: boolean } = {},
): Promise<WormMigrationSummary> {
  const dryRun = options.dryRun === true;
  const writeReport = options.writeReport !== false;
  const writtenKeys: string[] = [];
  let migrated = 0;
  let rejected = 0;
  let skipped = 0;
  let failed = 0;

  const approvedKeys = await store.list('promotion-approved/');
  const approvedLegacyIds = new Set(
    approvedKeys.map((key) => key.replace(/^promotion-approved\//, '')),
  );

  for (const key of approvedKeys) {
    const legacyId = key.replace(/^promotion-approved\//, '');
    try {
      const raw = await store.get<PromotionArtifactV2>(key);
      if (!raw || raw.schemaVersion !== 'promotion.v2') {
        skipped += 1;
        continue;
      }

      const { approval, artifact } = rebuildApprovedV3(raw, legacyId);
      const approvalKey = `approval/${approval.approvalId}`;
      const promoKey = promotionStoreKey(artifact);

      if (!dryRun) {
        await store.put(approvalKey, approval);
        await store.put(promoKey, artifact);
      }
      writtenKeys.push(approvalKey, promoKey);
      migrated += 1;
    } catch {
      failed += 1;
    }
  }

  const promotionKeys = await store.list('promotion/');
  for (const key of promotionKeys) {
    const legacyId = key.replace(/^promotion\//, '');
    if (legacyId.startsWith('sha256:')) {
      skipped += 1;
      continue;
    }
    if (approvedLegacyIds.has(legacyId)) {
      skipped += 1;
      continue;
    }

    try {
      const raw = await store.get(key);
      if (!raw) {
        skipped += 1;
        continue;
      }

      const archiveKey = `legacy-rejected-promotion/${legacyId}`;
      if (!dryRun) {
        await store.put(archiveKey, raw);
      }
      writtenKeys.push(archiveKey);
      rejected += 1;
    } catch {
      failed += 1;
    }
  }

  const summary: WormMigrationSummary = {
    timestamp: new Date().toISOString(),
    sourceVersion: 'v2',
    targetVersion: 'v3',
    migrated,
    rejected,
    failed,
    skipped,
    dryRun,
    writtenKeys,
  };

  if (writeReport && !dryRun) {
    const reportKey = `migration-report/worm-v1-${summary.timestamp.replace(/[:.]/g, '-')}`;
    await store.put(reportKey, summary);
    writtenKeys.push(reportKey);
    return { ...summary, writtenKeys: [...writtenKeys], reportHash: hashArtifactPayload(summary) };
  }

  return { ...summary, reportHash: hashArtifactPayload(summary) };
}

function rebuildApprovedV3(
  v2: PromotionArtifactV2,
  legacyId: string,
): { approval: ApprovalRecord; artifact: PromotionArtifactV3 } {
  const gate = v2.approvalDecision ?? {
    approved: true,
    reviewer: 'worm-migration',
    reason: 'reconstructed from promotion-approved legacy entry',
    timestamp: v2.promotedAt,
  };

  const approval = approvalRecordFromDecision({
    approvalId: `legacy-apr-${legacyId}`,
    subjectId: v2.sourceExperimentId || legacyId,
    evolutionRunId: 'unknown-pre-v3',
    gate,
  });

  const definitionRef =
    typeof v2.pipelineDefinition === 'string'
      ? v2.pipelineDefinition
      : `definition:${hashArtifactPayload(v2.pipelineDefinition)}`;

  const artifact = createPromotionArtifactV3({
    humanId: v2.id,
    pipelineId: v2.pipelineId,
    parentPromotionId: v2.parentPromotionId,
    parentExecutionHash: v2.parentExecutionHash,
    executionHash: v2.executionHash,
    pipelineDefinitionRef: definitionRef,
    mutationChain: v2.mutationChain,
    fitness: v2.fitness,
    promotedAt: v2.promotedAt,
    sourceExperimentId: v2.sourceExperimentId,
    evolutionRunId: 'unknown-pre-v3',
    approvalRecordId: approval.approvalId,
    schemaVersion: 'promotion.v3',
    migrationNote: 'worm-oneshot-migration:promotion.v2->promotion.v3',
  });

  return { approval, artifact };
}
