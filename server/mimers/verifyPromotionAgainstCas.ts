import type { CASRepository, EventLog } from '@miljobeslut/mimers-brunn-core';
import { validateManifest } from '@miljobeslut/mimers-brunn-core';
import type { ArtifactStore } from '../artifact/ArtifactStore';
import type { PromotionArtifactV3 } from '../artifact/PromotionArtifact';
import type { MimersPromotionBackend } from './MimersPromotionBackend';
import { mimersBindingKey, type MimersBinding } from './migrateArtifactStoreToCas';

export type PromotionCasVerifyResult = {
  readonly ok: boolean;
  readonly errors: readonly string[];
};

/**
 * CAS-primary integrity check: V3 is an index; truth is Manifest + Promotion in CAS (+ ledger).
 * Fail-closed when manifestHash / mimersPromotionHash are missing, dead, or unbound from ledger.
 */
export async function verifyPromotionAgainstCas(
  artifact: PromotionArtifactV3,
  cas: CASRepository,
  options: {
    readonly store?: ArtifactStore;
    /** When true, also verify manifest descriptor graph via verifyDescriptor. */
    readonly verifyDescriptors?: boolean;
    /** When set, require a ledger event for mimersPromotionHash. */
    readonly eventLog?: EventLog;
  } = {},
): Promise<PromotionCasVerifyResult> {
  const errors: string[] = [];
  const promotionHash =
    typeof artifact.metadata?.mimersPromotionHash === 'string'
      ? artifact.metadata.mimersPromotionHash
      : undefined;

  if (!artifact.manifestHash) {
    errors.push(`missing manifestHash on promotion ${artifact.artifactHash}`);
  } else if (!(await cas.existsAuthoritative(artifact.manifestHash))) {
    errors.push(`manifestHash not in CAS: ${artifact.manifestHash}`);
  }

  if (!promotionHash) {
    errors.push(`missing metadata.mimersPromotionHash on promotion ${artifact.artifactHash}`);
  } else if (!(await cas.existsAuthoritative(promotionHash))) {
    errors.push(`mimersPromotionHash not in CAS: ${promotionHash}`);
  }

  if (options.eventLog && promotionHash) {
    const event = await options.eventLog.findByPromotionHash(promotionHash);
    if (!event) {
      errors.push(`ledger missing event for mimersPromotionHash ${promotionHash}`);
    } else if (artifact.manifestHash && event.manifestHash !== artifact.manifestHash) {
      errors.push(
        `ledger manifestHash drift: event=${event.manifestHash} artifact=${artifact.manifestHash}`,
      );
    }
  }

  if (options.store) {
    const binding = await options.store.get<MimersBinding>(mimersBindingKey(artifact.artifactHash));
    if (binding) {
      if (artifact.manifestHash && binding.manifestHash !== artifact.manifestHash) {
        errors.push(
          `binding manifestHash drift: binding=${binding.manifestHash} artifact=${artifact.manifestHash}`,
        );
      }
      if (promotionHash && binding.mimersPromotionHash !== promotionHash) {
        errors.push(
          `binding mimersPromotionHash drift: binding=${binding.mimersPromotionHash} artifact=${promotionHash}`,
        );
      }
    } else {
      errors.push(`missing mimers-binding for promotion ${artifact.artifactHash}`);
    }
  }

  if (options.verifyDescriptors && artifact.manifestHash && errors.length === 0) {
    try {
      const raw = await cas.get(artifact.manifestHash, { verifyHash: true });
      if (raw === null) {
        errors.push(`manifest load returned null for ${artifact.manifestHash}`);
      } else {
        const manifest = validateManifest(raw);
        for (const desc of [
          manifest.pipeline,
          manifest.policySnapshot,
          manifest.runtimeFingerprint,
          manifest.metrics,
        ]) {
          const verified = await cas.verifyDescriptor(desc);
          if (!verified.ok) {
            errors.push(`descriptor ${desc.digest}: ${verified.error ?? 'invalid'}`);
          }
        }
      }
    } catch (err: unknown) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Convenience wrapper using MimersPromotionBackend.cas (+ optional eventLog). */
export async function verifyPromotionAgainstBackend(
  artifact: PromotionArtifactV3,
  backend: MimersPromotionBackend,
  options?: {
    readonly store?: ArtifactStore;
    readonly verifyDescriptors?: boolean;
    readonly eventLog?: EventLog;
  },
): Promise<PromotionCasVerifyResult> {
  return verifyPromotionAgainstCas(artifact, backend.cas, {
    ...options,
    eventLog: options?.eventLog ?? backend.eventLog,
  });
}
