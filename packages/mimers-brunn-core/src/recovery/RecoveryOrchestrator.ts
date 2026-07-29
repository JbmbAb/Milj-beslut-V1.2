import type { CASRepository } from '../cas/CASRepository';
import { mapConcurrent } from '../concurrency/mapConcurrent';
import type { MimersLedgerEvent } from './Merkle';
import { verifyLedgerHashChain } from './InMemoryEventLog';

export type AuditStatus = 'CLEAN' | 'DEGRADED' | 'CORRUPTED';

export interface AuditReport {
  readonly status: AuditStatus;
  readonly level: 'L0' | 'L1' | 'L2' | 'L3';
  readonly processedCount: number;
  readonly errors: readonly string[];
}

/**
 * Recovery / audit orchestrator (P2C).
 * L0: hash-chain verify. L1: authoritative CAS existence for ledger refs.
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
      status: errors.length === 0 ? 'CLEAN' : 'CORRUPTED',
      level: 'L1',
      processedCount: processed,
      errors,
    };
  }
}
