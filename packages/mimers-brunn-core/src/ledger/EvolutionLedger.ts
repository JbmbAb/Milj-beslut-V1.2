import type { CASRepository } from '../cas/CASRepository';
import { canonicalizeStrict, hashSerialized } from '../serialization';
import type { SignatureEnvelope, SigningKeyProvider } from '../signing/SignatureEnvelope';
import { validateManifest, type MimersBrunnManifest } from '../manifest/Manifest';
import type { EventLog } from './EventLog';
import { newLedgerEventId } from './InMemoryEventLog';
import { validateMimersPromotion, type MimersPromotionArtifact } from './promotion';

export interface PromotionSignaturePayload {
  readonly domain: 'mimers-brunn/promotion-signature/v1';
  readonly mediaType: 'application/vnd.mimers.promotion.v1+json';
  readonly canonicalization: 'RFC8785';
  readonly promotionCoreDigest: string;
}

export type CommitPromotionResult = {
  readonly promotionHash: string;
  readonly manifestHash: string;
  readonly eventId: string;
  readonly idempotentReplay: boolean;
};

/**
 * Idempotent promotion commit into CAS + EventLog (ADR-042 P1D).
 * Retry with the same sealed promotion content returns the existing ledger binding.
 */
export class EvolutionLedger {
  constructor(
    private readonly cas: CASRepository,
    private readonly eventLog: EventLog,
  ) {}

  async commitPromotion(
    manifest: MimersBrunnManifest,
    parents: readonly string[],
    generation: number,
    options: {
      readonly signing?: SigningKeyProvider;
      readonly metadataName?: string;
      readonly idempotencyKey?: string;
    } = {},
  ): Promise<CommitPromotionResult> {
    validateManifest(manifest);
    const { hash: manifestHash } = await this.cas.put(manifest);

    const basePayload: Omit<MimersPromotionArtifact, 'signatureEnvelope'> = {
      manifestHash,
      parents: [...parents],
      generation,
      ...(options.metadataName !== undefined
        ? { metadata: { humanName: options.metadataName, idempotencyKey: options.idempotencyKey } }
        : options.idempotencyKey !== undefined
          ? { metadata: { idempotencyKey: options.idempotencyKey } }
          : {}),
    };

    const coreSerialized = canonicalizeStrict(basePayload);
    let signatureEnvelope: SignatureEnvelope | undefined;

    if (options.signing) {
      const promotionCoreDigest = hashSerialized(coreSerialized, 'sha256');
      const signaturePayload: PromotionSignaturePayload = {
        domain: 'mimers-brunn/promotion-signature/v1',
        mediaType: 'application/vnd.mimers.promotion.v1+json',
        canonicalization: 'RFC8785',
        promotionCoreDigest,
      };
      const payloadBytes = Buffer.from(canonicalizeStrict(signaturePayload), 'utf-8');
      signatureEnvelope = await options.signing.sign(payloadBytes);
    }

    const promotionArtifact: MimersPromotionArtifact = {
      ...basePayload,
      ...(signatureEnvelope !== undefined ? { signatureEnvelope } : {}),
    };
    validateMimersPromotion(promotionArtifact);

    const { hash: promotionHash } = await this.cas.put(promotionArtifact);

    const existing = await this.eventLog.findByPromotionHash(promotionHash);
    if (existing) {
      return {
        promotionHash,
        manifestHash,
        eventId: existing.eventId,
        idempotentReplay: true,
      };
    }

    const event = await this.eventLog.append({
      eventId: newLedgerEventId(),
      type: 'PROMOTION_COMMITTED',
      promotionHash,
      manifestHash,
      timestamp: Date.now(),
    });

    return {
      promotionHash,
      manifestHash,
      eventId: event.eventId,
      idempotentReplay: false,
    };
  }
}
