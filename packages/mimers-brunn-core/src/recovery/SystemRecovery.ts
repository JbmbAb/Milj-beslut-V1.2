import type { CASRepository } from '../cas/CASRepository';
import { validateMimersPromotion } from '../ledger/promotion';
import type { MimersLedgerEvent } from '../ledger/Merkle';
import { validateManifest } from '../manifest/Manifest';
import type { IntegrityVerifier } from './IntegrityVerifier';
import type { AuditL2Options, AuditReport, AuditStatus } from './types';

export type LedgerReplayEntry = {
  readonly eventId: string;
  readonly sequence: number;
  readonly promotionHash: string;
  readonly manifestHash: string;
  readonly ok: boolean;
  readonly error?: string;
};

export type SystemRecoveryReport = {
  readonly status: AuditStatus;
  readonly l0: AuditReport;
  readonly l1: AuditReport;
  readonly l2: AuditReport;
  readonly replay: readonly LedgerReplayEntry[];
  readonly recoverableEvents: number;
  readonly failedEvents: number;
};

/**
 * Recovery — restore/verify system state from Ledger + CAS as source of truth.
 * Rebuilds a reachability view without inventing missing CAS objects (Fas 4 M6).
 */
export class SystemRecovery {
  constructor(
    private readonly cas: CASRepository,
    private readonly getEventLog: () => Promise<readonly MimersLedgerEvent[]>,
    private readonly verifier: IntegrityVerifier,
  ) {}

  /**
   * Full recovery pass: L0→L2 verification plus per-event ledger→CAS replay probe.
   * Does not mutate CAS; reports which promotions are fully reconstitutable.
   */
  async recoverFromLedger(options: AuditL2Options = {}): Promise<SystemRecoveryReport> {
    const l0 = await this.verifier.auditL0();
    const l1 = await this.verifier.auditL1(options.concurrency ?? 16);
    const l2 = await this.verifier.auditL2(options);

    const events = await this.getEventLog();
    const replay: LedgerReplayEntry[] = [];

    for (const event of events) {
      const entry = await this.probeEvent(event);
      replay.push(entry);
    }

    const failedEvents = replay.filter((e) => !e.ok).length;
    const recoverableEvents = replay.length - failedEvents;
    const status: AuditStatus =
      l0.status === 'CLEAN' &&
      l1.status === 'CLEAN' &&
      l2.status === 'CLEAN' &&
      failedEvents === 0
        ? 'CLEAN'
        : 'CORRUPTED';

    return {
      status,
      l0,
      l1,
      l2,
      replay,
      recoverableEvents,
      failedEvents,
    };
  }

  private async probeEvent(event: MimersLedgerEvent): Promise<LedgerReplayEntry> {
    try {
      const promotionRaw = await this.cas.get(event.promotionHash, { verifyHash: true });
      if (promotionRaw === null) {
        return {
          eventId: event.eventId,
          sequence: event.sequence,
          promotionHash: event.promotionHash,
          manifestHash: event.manifestHash,
          ok: false,
          error: 'missing promotion in CAS',
        };
      }
      const promotion = validateMimersPromotion(promotionRaw);
      if (promotion.manifestHash !== event.manifestHash) {
        return {
          eventId: event.eventId,
          sequence: event.sequence,
          promotionHash: event.promotionHash,
          manifestHash: event.manifestHash,
          ok: false,
          error: 'promotion.manifestHash drift vs ledger',
        };
      }
      const manifestRaw = await this.cas.get(event.manifestHash, { verifyHash: true });
      if (manifestRaw === null) {
        return {
          eventId: event.eventId,
          sequence: event.sequence,
          promotionHash: event.promotionHash,
          manifestHash: event.manifestHash,
          ok: false,
          error: 'missing manifest in CAS',
        };
      }
      validateManifest(manifestRaw);
      return {
        eventId: event.eventId,
        sequence: event.sequence,
        promotionHash: event.promotionHash,
        manifestHash: event.manifestHash,
        ok: true,
      };
    } catch (err: unknown) {
      return {
        eventId: event.eventId,
        sequence: event.sequence,
        promotionHash: event.promotionHash,
        manifestHash: event.manifestHash,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
