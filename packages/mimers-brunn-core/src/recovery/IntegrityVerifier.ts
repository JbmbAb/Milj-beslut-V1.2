import type { CASRepository } from '../cas/CASRepository';
import { mapConcurrent } from '../concurrency/mapConcurrent';
import { verifyPromotionSignature } from '../ledger/EvolutionLedger';
import { verifyLedgerHashChain } from '../ledger/InMemoryEventLog';
import { validateMimersPromotion, type MimersPromotionArtifact } from '../ledger/promotion';
import type { MimersLedgerEvent } from '../ledger/Merkle';
import { validateDescriptor, validateManifest, type MimersBrunnManifest } from '../manifest/Manifest';
import {
  statusFromErrors,
  type AuditL2Options,
  type AuditReport,
} from './types';

/**
 * Verifier — hash chain, CAS existence, cryptographic schema/signature checks.
 * Does not mutate storage (Fas 4 M6).
 */
export class IntegrityVerifier {
  constructor(
    private readonly cas: CASRepository,
    private readonly getEventLog: () => Promise<readonly MimersLedgerEvent[]>,
  ) {}

  /** L0 — fast chain integrity (no full CAS scan). */
  async auditL0(): Promise<AuditReport> {
    const events = await this.getEventLog();
    const chain = verifyLedgerHashChain(events);
    return {
      status: chain.ok ? 'CLEAN' : 'CORRUPTED',
      level: 'L0',
      processedCount: events.length,
      errors: chain.errors,
    };
  }

  /** L1 — each ledger event's promotionHash/manifestHash exists in CAS. */
  async auditL1(concurrency = 16): Promise<AuditReport> {
    const events = await this.getEventLog();
    const errors: string[] = [];
    let processed = 0;

    await mapConcurrent(events, Math.max(1, concurrency), async (event) => {
      processed += 1;
      if (!(await this.cas.existsAuthoritative(event.promotionHash))) {
        errors.push(`L1 orphan promotionHash ${event.promotionHash} (event ${event.eventId})`);
      }
      if (!(await this.cas.existsAuthoritative(event.manifestHash))) {
        errors.push(`L1 orphan manifestHash ${event.manifestHash} (event ${event.eventId})`);
      }
    });

    return {
      status: statusFromErrors(errors),
      level: 'L1',
      processedCount: processed,
      errors,
    };
  }

  /**
   * L2 — cryptographic audit over ledger-referenced promotions/manifests.
   * Verifies on-disk hashes, schema, descriptor graph, and optional signatures.
   */
  async auditL2(options: AuditL2Options = {}): Promise<AuditReport> {
    const concurrency = Math.max(1, options.concurrency ?? 8);
    const events = await this.getEventLog();
    const errors: string[] = [];
    let processed = 0;

    await mapConcurrent(
      events,
      concurrency,
      async (event) => {
        processed += 1;
        const eventErrors = await this.auditEventCryptographic(event, options);
        errors.push(...eventErrors);
      },
      { signal: options.signal },
    );

    return {
      status: statusFromErrors(errors),
      level: 'L2',
      processedCount: processed,
      errors,
    };
  }

  private async auditEventCryptographic(
    event: MimersLedgerEvent,
    options: AuditL2Options,
  ): Promise<string[]> {
    const errors: string[] = [];

    const promoVerify = await this.cas.verifyStoredObject(event.promotionHash);
    if (!promoVerify.ok) {
      errors.push(`L2 promotion ${promoVerify.error ?? event.promotionHash}`);
      return errors;
    }

    let promotionRaw: unknown;
    try {
      promotionRaw = await this.cas.get(event.promotionHash, { verifyHash: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`L2 promotion load failed ${event.promotionHash}: ${msg}`);
      return errors;
    }
    if (promotionRaw === null) {
      errors.push(`L2 missing promotion ${event.promotionHash}`);
      return errors;
    }

    let promotion: MimersPromotionArtifact;
    try {
      promotion = validateMimersPromotion(promotionRaw);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`L2 invalid promotion ${event.promotionHash}: ${msg}`);
      return errors;
    }

    if (promotion.manifestHash !== event.manifestHash) {
      errors.push(
        `L2 manifestHash mismatch event=${event.manifestHash} promotion=${promotion.manifestHash}`,
      );
    }

    if (options.requireSignatures && !promotion.signatureEnvelope) {
      errors.push(`L2 missing required signature on promotion ${event.promotionHash}`);
    } else if (promotion.signatureEnvelope) {
      if (!options.signing) {
        errors.push(
          `L2 signature present but no SigningKeyProvider configured (${event.promotionHash})`,
        );
      } else {
        const ok = await verifyPromotionSignature(promotion, options.signing);
        if (!ok) {
          errors.push(`L2 forged or invalid promotion signature ${event.promotionHash}`);
        }
      }
    }

    const manifestVerify = await this.cas.verifyStoredObject(event.manifestHash);
    if (!manifestVerify.ok) {
      errors.push(`L2 manifest ${manifestVerify.error ?? event.manifestHash}`);
      return errors;
    }

    let manifestRaw: unknown;
    try {
      manifestRaw = await this.cas.get(event.manifestHash, { verifyHash: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`L2 manifest load failed ${event.manifestHash}: ${msg}`);
      return errors;
    }
    if (manifestRaw === null) {
      errors.push(`L2 missing manifest ${event.manifestHash}`);
      return errors;
    }

    let manifest: MimersBrunnManifest;
    try {
      manifest = validateManifest(manifestRaw);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`L2 invalid manifest ${event.manifestHash}: ${msg}`);
      return errors;
    }

    const descriptors = [
      manifest.pipeline,
      manifest.policySnapshot,
      manifest.runtimeFingerprint,
      manifest.metrics,
    ];
    for (const desc of descriptors) {
      try {
        validateDescriptor(desc);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`L2 descriptor schema ${desc.digest}: ${msg}`);
        continue;
      }
      const verified = await this.cas.verifyDescriptor(desc);
      if (!verified.ok) {
        errors.push(`L2 descriptor ${desc.digest}: ${verified.error ?? 'verifyDescriptor failed'}`);
      }
    }

    return errors;
  }
}
