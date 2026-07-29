import type { CASRepository } from '../cas/CASRepository';
import { mapConcurrent } from '../concurrency/mapConcurrent';
import { verifyPromotionSignature } from '../ledger/EvolutionLedger';
import { verifyLedgerHashChain } from '../ledger/InMemoryEventLog';
import { validateMimersPromotion, type MimersPromotionArtifact } from '../ledger/promotion';
import type { MimersLedgerEvent } from '../ledger/Merkle';
import { validateDescriptor, validateManifest, type MimersBrunnManifest } from '../manifest/Manifest';
import type { SigningKeyProvider } from '../signing/SignatureEnvelope';

export type AuditStatus = 'CLEAN' | 'DEGRADED' | 'CORRUPTED';

export interface AuditReport {
  readonly status: AuditStatus;
  readonly level: 'L0' | 'L1' | 'L2' | 'L3';
  readonly processedCount: number;
  readonly errors: readonly string[];
}

export interface AuditL2Options {
  readonly concurrency?: number;
  readonly signing?: SigningKeyProvider;
  /** When true, missing promotion signatureEnvelope is an audit failure. */
  readonly requireSignatures?: boolean;
  readonly signal?: AbortSignal;
}

export interface AuditL3Options {
  readonly concurrency?: number;
  readonly signal?: AbortSignal;
  /** Optional resume cursor (exclusive): skip digests until after this hash. */
  readonly afterDigest?: string;
}

function statusFromErrors(errors: readonly string[]): AuditStatus {
  return errors.length === 0 ? 'CLEAN' : 'CORRUPTED';
}

/**
 * Recovery / audit orchestrator (P2C).
 * L0: hash-chain verify (no CAS walk).
 * L1: authoritative CAS existence for ledger refs.
 * L2: cryptographic verify of promotions, manifests, descriptors, optional signatures.
 * L3: streaming storage scrub of all CAS objects (O(concurrency) memory).
 */
export class RecoveryOrchestrator {
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

  /**
   * L3 — streaming storage scrub. Does not load the full object list into RAM.
   * Uses a semaphore-bounded pool over an async digest stream (O(concurrency) memory).
   */
  async auditL3(options: AuditL3Options = {}): Promise<AuditReport> {
    const concurrency = Math.max(1, options.concurrency ?? 8);
    const errors: string[] = [];
    let processed = 0;
    let skipping = options.afterDigest !== undefined;

    let available = concurrency;
    const waiters: Array<() => void> = [];
    const acquire = async (): Promise<void> => {
      if (available > 0) {
        available -= 1;
        return;
      }
      await new Promise<void>((resolve) => waiters.push(resolve));
    };
    const release = (): void => {
      const next = waiters.shift();
      if (next) next();
      else available += 1;
    };

    const tasks: Promise<void>[] = [];
    for await (const digest of this.cas.streamObjectDigests(options.signal)) {
      if (options.signal?.aborted) throw new Error('Operation aborted by user signal.');
      if (skipping) {
        if (digest === options.afterDigest) skipping = false;
        continue;
      }
      await acquire();
      tasks.push(
        (async () => {
          try {
            processed += 1;
            const result = await this.cas.verifyStoredObject(digest);
            if (!result.ok) {
              errors.push(`L3 ${result.error ?? `corrupt ${digest}`}`);
            }
          } finally {
            release();
          }
        })(),
      );
    }
    await Promise.all(tasks);

    return {
      status: statusFromErrors(errors),
      level: 'L3',
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
      const objVerify = await this.cas.verifyStoredObject(desc.digest);
      if (!objVerify.ok) {
        errors.push(`L2 descriptor ${objVerify.error ?? desc.digest}`);
        continue;
      }
      if (objVerify.size !== undefined && objVerify.size !== desc.size) {
        errors.push(
          `L2 descriptor size mismatch ${desc.digest}: expected ${desc.size}, got ${objVerify.size}`,
        );
      }
    }

    return errors;
  }
}
