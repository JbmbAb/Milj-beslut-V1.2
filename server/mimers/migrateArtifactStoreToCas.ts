import {
  createArtifactAttestation,
  type SigningKeyProvider,
} from '@miljobeslut/mimers-brunn-core';
import type { ArtifactStore } from '../artifact/ArtifactStore';
import { requirePromotionV3 } from '../artifact';
import type { PromotionArtifactV3 } from '../artifact/PromotionArtifact';
import type { MimersPromotionBackend, MimersSealResult } from './MimersPromotionBackend';

export const MIMERS_CAS_MIGRATION_TOOL_VERSION = 'mimers-cas-migration-v1' as const;

export type MimersBinding = {
  readonly artifactHash: string;
  readonly manifestHash: string;
  readonly mimersPromotionHash: string;
  readonly mimersEventId: string;
  readonly migratedAt: string;
  readonly toolVersion: typeof MIMERS_CAS_MIGRATION_TOOL_VERSION;
};

export type MimersCasMigrationEntry = {
  readonly artifactHash: string;
  readonly status: 'migrated' | 'skipped' | 'failed';
  readonly manifestHash?: string;
  readonly mimersPromotionHash?: string;
  readonly reason?: string;
};

export type MimersCasMigrationReport = {
  readonly mediaType: 'application/vnd.mimers.migration-report.v1+json';
  readonly toolVersion: typeof MIMERS_CAS_MIGRATION_TOOL_VERSION;
  readonly timestamp: string;
  readonly source: 'promotion/';
  readonly target: 'cas+ledger';
  readonly dryRun: boolean;
  readonly migrated: number;
  readonly skipped: number;
  readonly failed: number;
  readonly entries: readonly MimersCasMigrationEntry[];
};

export type MimersCasMigrationResult = {
  readonly report: MimersCasMigrationReport;
  /** CAS digest of the sealed report object (absent on dry-run). */
  readonly reportDigest?: string;
  readonly reportAttestationSubject?: string;
};

export function mimersBindingKey(artifactHash: string): string {
  return `mimers-binding/${artifactHash}`;
}

function generationFromHumanId(humanId: string): number {
  const match = /g(\d+)/i.exec(humanId);
  if (!match?.[1]) return 1;
  return Number.parseInt(match[1], 10) || 1;
}

function parentMimersHash(artifact: PromotionArtifactV3): string | undefined {
  const fromMeta = artifact.metadata?.mimersPromotionHash;
  return typeof fromMeta === 'string' ? fromMeta : undefined;
}

/** Build seal inputs from a V3 index artifact (no inline pipeline graph required). */
export function sealInputFromPromotionV3(artifact: PromotionArtifactV3): {
  pipeline: unknown;
  policySnapshot: unknown;
  runtimeFingerprint: unknown;
  metrics: unknown;
  parents: readonly string[];
  generation: number;
  metadataName: string;
  idempotencyKey: string;
} {
  const parent = parentMimersHash(artifact);
  return {
    pipeline: {
      mediaType: 'application/vnd.mimers.pipeline.v1+json',
      pipelineId: artifact.pipelineId,
      pipelineDefinitionRef: artifact.pipelineDefinitionRef,
      executionHash: artifact.executionHash,
      mutationChain: artifact.mutationChain,
    },
    policySnapshot: {
      mediaType: 'application/vnd.mimers.policy.v1+json',
      policySnapshotRef: artifact.policySnapshotRef ?? null,
      approvalRecordId: artifact.approvalRecordId,
    },
    runtimeFingerprint: {
      mediaType: 'application/vnd.mimers.runtime.v1+json',
      fingerprint: artifact.runtimeFingerprint ?? null,
      evolutionRunId: artifact.evolutionRunId,
      sourceExperimentId: artifact.sourceExperimentId,
      promotedAt: artifact.promotedAt,
    },
    metrics: {
      mediaType: 'application/vnd.mimers.metrics.v1+json',
      fitness: artifact.fitness,
    },
    parents: parent ? [parent] : [],
    generation: generationFromHumanId(artifact.humanId),
    metadataName: artifact.humanId,
    idempotencyKey: `MIGRATION:${artifact.artifactHash}`,
  };
}

/**
 * Lazy-on-read migration (ADR-042): ensure CAS+ledger binding exists without
 * mutating the WORM promotion object. Persists a side-car under mimers-binding/.
 */
export async function ensurePromotionMimersBinding(
  artifact: PromotionArtifactV3,
  store: ArtifactStore,
  backend: MimersPromotionBackend,
  options: { readonly persistBinding?: boolean } = {},
): Promise<{ binding: MimersBinding; seal: MimersSealResult; created: boolean }> {
  const persistBinding = options.persistBinding !== false;
  const existing = await store.get<MimersBinding>(mimersBindingKey(artifact.artifactHash));
  if (existing?.manifestHash && existing?.mimersPromotionHash) {
    const alive =
      (await backend.cas.existsAuthoritative(existing.manifestHash)) &&
      (await backend.cas.existsAuthoritative(existing.mimersPromotionHash));
    if (alive) {
      return {
        binding: existing,
        seal: {
          manifestHash: existing.manifestHash,
          promotionHash: existing.mimersPromotionHash,
          eventId: existing.mimersEventId,
          idempotentReplay: true,
        },
        created: false,
      };
    }
  }

  if (artifact.manifestHash && typeof artifact.metadata?.mimersPromotionHash === 'string') {
    const promotionHash = artifact.metadata.mimersPromotionHash;
    const alive =
      (await backend.cas.existsAuthoritative(artifact.manifestHash)) &&
      (await backend.cas.existsAuthoritative(promotionHash));
    if (alive) {
      const binding: MimersBinding = {
        artifactHash: artifact.artifactHash,
        manifestHash: artifact.manifestHash,
        mimersPromotionHash: promotionHash,
        mimersEventId: String(artifact.metadata.mimersEventId ?? ''),
        migratedAt: new Date().toISOString(),
        toolVersion: MIMERS_CAS_MIGRATION_TOOL_VERSION,
      };
      if (persistBinding) {
        await store.put(mimersBindingKey(artifact.artifactHash), binding);
      }
      return {
        binding,
        seal: {
          manifestHash: binding.manifestHash,
          promotionHash: binding.mimersPromotionHash,
          eventId: binding.mimersEventId,
          idempotentReplay: true,
        },
        created: false,
      };
    }
  }

  const input = sealInputFromPromotionV3(artifact);
  const seal = await backend.seal(input);
  const binding: MimersBinding = {
    artifactHash: artifact.artifactHash,
    manifestHash: seal.manifestHash,
    mimersPromotionHash: seal.promotionHash,
    mimersEventId: seal.eventId,
    migratedAt: new Date().toISOString(),
    toolVersion: MIMERS_CAS_MIGRATION_TOOL_VERSION,
  };
  if (persistBinding) {
    await store.put(mimersBindingKey(artifact.artifactHash), binding);
  }
  return { binding, seal, created: true };
}

/**
 * Explicit one-shot migration (forbidden at startup). Emits a CAS-addressed
 * migration-report.json; never rewrites promotion/* WORM keys.
 */
export async function migrateArtifactStoreToMimersCas(
  store: ArtifactStore,
  backend: MimersPromotionBackend,
  options: {
    readonly dryRun?: boolean;
    readonly signing?: SigningKeyProvider;
    readonly limit?: number;
  } = {},
): Promise<MimersCasMigrationResult> {
  const dryRun = options.dryRun === true;
  const keys = await store.list('promotion/');
  const entries: MimersCasMigrationEntry[] = [];
  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  let processed = 0;

  for (const key of keys) {
    if (options.limit !== undefined && processed >= options.limit) break;
    processed += 1;

    try {
      const raw = await store.get(key);
      if (!raw) {
        skipped += 1;
        entries.push({ artifactHash: key, status: 'skipped', reason: 'missing' });
        continue;
      }
      const artifact = requirePromotionV3(raw);

      if (dryRun) {
        const existing = await store.get<MimersBinding>(mimersBindingKey(artifact.artifactHash));
        if (existing) {
          skipped += 1;
          entries.push({
            artifactHash: artifact.artifactHash,
            status: 'skipped',
            reason: 'binding-exists',
            manifestHash: existing.manifestHash,
            mimersPromotionHash: existing.mimersPromotionHash,
          });
        } else {
          migrated += 1;
          entries.push({ artifactHash: artifact.artifactHash, status: 'migrated', reason: 'dry-run' });
        }
        continue;
      }

      const { binding, created } = await ensurePromotionMimersBinding(artifact, store, backend);
      if (created) {
        migrated += 1;
        entries.push({
          artifactHash: artifact.artifactHash,
          status: 'migrated',
          manifestHash: binding.manifestHash,
          mimersPromotionHash: binding.mimersPromotionHash,
        });
      } else {
        skipped += 1;
        entries.push({
          artifactHash: artifact.artifactHash,
          status: 'skipped',
          reason: 'already-bound',
          manifestHash: binding.manifestHash,
          mimersPromotionHash: binding.mimersPromotionHash,
        });
      }
    } catch (err: unknown) {
      failed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      entries.push({ artifactHash: key, status: 'failed', reason: msg });
    }
  }

  const report: MimersCasMigrationReport = {
    mediaType: 'application/vnd.mimers.migration-report.v1+json',
    toolVersion: MIMERS_CAS_MIGRATION_TOOL_VERSION,
    timestamp: new Date().toISOString(),
    source: 'promotion/',
    target: 'cas+ledger',
    dryRun,
    migrated,
    skipped,
    failed,
    entries,
  };

  if (dryRun) {
    return { report };
  }

  const { hash: reportDigest } = await backend.cas.put(report);
  await store.put(`migration-report/mimers-cas-${report.timestamp.replace(/[:.]/g, '-')}`, {
    ...report,
    reportDigest,
  });

  let reportAttestationSubject: string | undefined;
  if (options.signing) {
    const attestation = await createArtifactAttestation({
      subjectDigest: reportDigest,
      predicateType: 'https://mimers.local/migration-report/v1',
      predicate: {
        toolVersion: MIMERS_CAS_MIGRATION_TOOL_VERSION,
        migrated,
        skipped,
        failed,
        timestamp: report.timestamp,
      },
      signing: options.signing,
    });
    await backend.cas.put(attestation);
    reportAttestationSubject = attestation.subjectDigest;
  }

  return { report, reportDigest, reportAttestationSubject };
}
