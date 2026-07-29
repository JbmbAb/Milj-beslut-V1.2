import { hashArtifactPayload } from '../utils/hashArtifact';
import type { PromotionArtifactV2, PromotionArtifactV3 } from './PromotionArtifact';

export interface ArtifactMigrator<TFrom = unknown, TTo = unknown> {
  readonly from: string;
  readonly to: string;
  migrate(from: TFrom): TTo;
}

type AnyPromotion = PromotionArtifactV2 | PromotionArtifactV3 | { readonly schemaVersion: string };

/**
 * Central registry for artifact schema migrations.
 *
 * AES-1.0 rule: after a schema-changing migration, recompute artifactHash and
 * clear (or re-sign) signature/signingKeyId. Never carry a stale signature.
 */
export class ArtifactMigrationRegistry {
  private readonly migrators = new Map<string, ArtifactMigrator>();

  register(migrator: ArtifactMigrator): void {
    this.migrators.set(`${migrator.from}->${migrator.to}`, migrator);
  }

  migrateToLatest(artifact: AnyPromotion): PromotionArtifactV3 {
    if (artifact.schemaVersion === 'promotion.v3') {
      return artifact as PromotionArtifactV3;
    }

    if (artifact.schemaVersion === 'promotion.v2') {
      const m = this.migrators.get('promotion.v2->promotion.v3');
      if (!m) {
        throw new Error('Missing migrator promotion.v2->promotion.v3');
      }
      const migrated = m.migrate(artifact as PromotionArtifactV2) as Record<string, unknown>;

      // Schema change invalidates any prior signature. Strip envelope leftovers
      // from the migrator output, re-hash, and mark unsigned explicitly.
      const {
        signature: _staleSig,
        signingKeyId: _staleKeyId,
        artifactHash: _staleHash,
        artifactId: _staleId,
        ...rest
      } = migrated;

      const unsignedBody = {
        ...rest,
        schemaVersion: 'promotion.v3',
        migrationNote: 'unsigned-after-migration:promotion.v2->promotion.v3',
      };

      for (const key of Object.keys(unsignedBody)) {
        if ((unsignedBody as Record<string, unknown>)[key] === undefined) {
          delete (unsignedBody as Record<string, unknown>)[key];
        }
      }

      const artifactHash = hashArtifactPayload(unsignedBody);
      return {
        ...(unsignedBody as unknown as Omit<
          PromotionArtifactV3,
          'artifactId' | 'artifactHash' | 'signature' | 'signingKeyId'
        >),
        artifactId: artifactHash,
        artifactHash,
        signature: undefined,
        signingKeyId: undefined,
      };
    }

    throw new Error(`Unsupported schemaVersion: ${String((artifact as { schemaVersion?: string }).schemaVersion)}`);
  }
}

export const promotionV2ToV3Migrator: ArtifactMigrator<PromotionArtifactV2, Record<string, unknown>> = {
  from: 'promotion.v2',
  to: 'promotion.v3',
  migrate(v2) {
    const definitionRef =
      typeof v2.pipelineDefinition === 'string'
        ? v2.pipelineDefinition
        : `definition:${hashArtifactPayload(v2.pipelineDefinition)}`;

    return {
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
      schemaVersion: 'promotion.v3',
      approvalDecision: v2.approvalDecision,
      // Intentionally omit artifactHash / signature / signingKeyId —
      // registry recomputes hash and clears signatures after migrate().
    };
  },
};

export function createDefaultArtifactMigrationRegistry(): ArtifactMigrationRegistry {
  const registry = new ArtifactMigrationRegistry();
  registry.register(promotionV2ToV3Migrator);
  return registry;
}
