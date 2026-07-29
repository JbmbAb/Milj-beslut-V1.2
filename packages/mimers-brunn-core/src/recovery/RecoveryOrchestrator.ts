import type { CASRepository } from '../cas/CASRepository';
import type { MimersLedgerEvent } from '../ledger/Merkle';
import { CasRepair, type QuarantineBatchResult } from './CasRepair';
import { IntegrityVerifier } from './IntegrityVerifier';
import { SystemRecovery, type SystemRecoveryReport } from './SystemRecovery';
import type { AuditL2Options, AuditL3Options, AuditReport } from './types';

export type {
  AuditL2Options,
  AuditL3Options,
  AuditReport,
  AuditStatus,
} from './types';
export { CasRepair, type QuarantineBatchResult } from './CasRepair';
export { IntegrityVerifier } from './IntegrityVerifier';
export {
  SystemRecovery,
  type LedgerReplayEntry,
  type SystemRecoveryReport,
} from './SystemRecovery';

/**
 * Facade over Verifier → Repair → Recovery (Fas 4 M6).
 * Keeps the historical auditL0–L3 API while exposing focused components.
 *
 * - {@link IntegrityVerifier}: L0–L2 (no mutation)
 * - {@link CasRepair}: L3 scrub + quarantine
 * - {@link SystemRecovery}: ledger→CAS state reconstitution report
 */
export class RecoveryOrchestrator {
  readonly verifier: IntegrityVerifier;
  readonly repair: CasRepair;
  readonly recovery: SystemRecovery;

  constructor(
    private readonly cas: CASRepository,
    getEventLog: () => Promise<readonly MimersLedgerEvent[]>,
  ) {
    this.verifier = new IntegrityVerifier(cas, getEventLog);
    this.repair = new CasRepair(cas);
    this.recovery = new SystemRecovery(cas, getEventLog, this.verifier);
  }

  /** L0 — fast chain integrity (no full CAS scan). */
  auditL0(): Promise<AuditReport> {
    return this.verifier.auditL0();
  }

  /** L1 — each ledger event's promotionHash/manifestHash exists in CAS. */
  auditL1(concurrency = 16): Promise<AuditReport> {
    return this.verifier.auditL1(concurrency);
  }

  /** L2 — cryptographic audit over ledger-referenced promotions/manifests. */
  auditL2(options: AuditL2Options = {}): Promise<AuditReport> {
    return this.verifier.auditL2(options);
  }

  /** L3 — streaming storage scrub (+ optional quarantine via Repair). */
  auditL3(options: AuditL3Options = {}): Promise<AuditReport> {
    return this.repair.auditL3(options);
  }

  /** Targeted quarantine (Repair). */
  quarantineDigests(digests: readonly string[], reason: string): Promise<QuarantineBatchResult> {
    return this.repair.quarantineDigests(digests, reason);
  }

  /** Full ledger→CAS recovery report (Recovery). */
  recoverFromLedger(options: AuditL2Options = {}): Promise<SystemRecoveryReport> {
    return this.recovery.recoverFromLedger(options);
  }
}
