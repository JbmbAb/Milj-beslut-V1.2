import {
  EvolutionLedger,
  ManifestBuilder,
  type CASRepository,
  type EventLog,
  type SigningKeyProvider,
} from '@miljobeslut/mimers-brunn-core';

export type MimersSealInput = {
  readonly pipeline: unknown;
  readonly policySnapshot: unknown;
  readonly runtimeFingerprint: unknown;
  readonly metrics: unknown;
  /** Prior Mimers promotion CAS hashes (not V3 artifact ids). */
  readonly parents: readonly string[];
  readonly generation: number;
  readonly metadataName?: string;
  readonly idempotencyKey?: string;
};

export type MimersSealResult = {
  readonly manifestHash: string;
  readonly promotionHash: string;
  readonly eventId: string;
  readonly idempotentReplay: boolean;
};

/**
 * Bridge: Evolution Engine → ManifestBuilder → CAS → EvolutionLedger (ADR-042).
 * Lives under server/mimers so mimers-brunn-core never imports evolve.
 */
export class MimersPromotionBackend {
  private readonly builder: ManifestBuilder;
  private readonly ledger: EvolutionLedger;

  constructor(
    cas: CASRepository,
    eventLog: EventLog,
    private readonly signing?: SigningKeyProvider,
  ) {
    this.builder = new ManifestBuilder(cas);
    this.ledger = new EvolutionLedger(cas, eventLog);
  }

  async seal(input: MimersSealInput): Promise<MimersSealResult> {
    const { manifest } = await this.builder.build({
      pipeline: input.pipeline,
      policySnapshot: input.policySnapshot,
      runtimeFingerprint: input.runtimeFingerprint,
      metrics: input.metrics,
    });
    const committed = await this.ledger.commitPromotion(
      manifest,
      input.parents,
      input.generation,
      {
        signing: this.signing,
        metadataName: input.metadataName,
        idempotencyKey: input.idempotencyKey,
      },
    );
    return {
      manifestHash: committed.manifestHash,
      promotionHash: committed.promotionHash,
      eventId: committed.eventId,
      idempotentReplay: committed.idempotentReplay,
    };
  }
}
