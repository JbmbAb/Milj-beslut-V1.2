/**
 * auditVerificationScheduler.ts
 *
 * Periodisk rutin för kryptografisk verifiering av audit trail chain hash.
 *
 * Bakgrund (CODEBASE_ANALYSIS.md Priority 2.5):
 *   "verifyAuditTrail() exists but not in production code – no periodic
 *    verification jobs. Chain Hash Verification Never Called."
 *
 * Funktioner:
 *   - startAuditVerificationScheduler()  — startar periodisk körning
 *   - stopAuditVerificationScheduler()   — stoppar schemat
 *   - runAuditVerificationOnce()         — kör en enstaka verifieringscykel
 *   - getAuditVerificationStatus()       — returnerar aktuellt status
 *
 * Miljövariabler:
 *   AUDIT_VERIFY_INTERVAL_MS   — intervall i ms (default 3600000 = 1 h)
 *   AUDIT_VERIFY_ALERT_WEBHOOK — valfri URL för alert-utskick vid tampering
 */

import { logger } from '../logger';
import { verifyAuditTrail } from '../security/auditTrail';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuditVerificationResult {
  ok: boolean;
  invalidIndex?: number;
  checkedAt: string;
  durationMs: number;
}

export interface AuditVerificationSchedulerStatus {
  running: boolean;
  intervalMs: number;
  totalRuns: number;
  lastResult: AuditVerificationResult | null;
  nextRunAt: string | null;
  consecutiveFailures: number;
}

// ─── State ────────────────────────────────────────────────────────────────────

let _timer: ReturnType<typeof setInterval> | null = null;
const _status: AuditVerificationSchedulerStatus = {
  running: false,
  intervalMs: Number(process.env.AUDIT_VERIFY_INTERVAL_MS ?? 3_600_000),
  totalRuns: 0,
  lastResult: null,
  nextRunAt: null,
  consecutiveFailures: 0,
};

// ─── Alert helper ─────────────────────────────────────────────────────────────

async function sendTamperingAlert(invalidIndex: number): Promise<void> {
  const webhookUrl = process.env.AUDIT_VERIFY_ALERT_WEBHOOK?.trim();
  if (!webhookUrl) {
    logger.warn(
      `audit-verification: VARNING – audit trail-tampering detekterat vid index ${invalidIndex}. ` +
        'Sätt AUDIT_VERIFY_ALERT_WEBHOOK för automatisk avisering.',
    );
    return;
  }

  try {
    const payload = JSON.stringify({
      event: 'AUDIT_TRAIL_TAMPERING_DETECTED',
      invalidIndex,
      detectedAt: new Date().toISOString(),
    });
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
    if (!response.ok) {
      logger.error(`audit-verification: Alert-webhook svarade med HTTP ${response.status}`);
    } else {
      logger.info(`audit-verification: Alert skickat till webhook (index ${invalidIndex}).`);
    }
  } catch (err) {
    logger.error(`audit-verification: Kunde inte skicka alert-webhook: ${String(err)}`);
  }
}

// ─── Core run ─────────────────────────────────────────────────────────────────

export async function runAuditVerificationOnce(): Promise<AuditVerificationResult> {
  const startTs = Date.now();
  _status.totalRuns++;
  const checkedAt = new Date().toISOString();

  let result: AuditVerificationResult;
  try {
    const verification = await verifyAuditTrail();
    const durationMs = Date.now() - startTs;

    if (verification.ok) {
      _status.consecutiveFailures = 0;
      logger.info(`audit-verification: OK – audit trail integritet verifierad (${durationMs} ms).`);
      result = { ok: true, checkedAt, durationMs };
    } else {
      _status.consecutiveFailures++;
      logger.error(
        `audit-verification: FELETT – kedjebrott detekterat vid index ${verification.invalidIndex}. ` +
          `Konsekutiva fel: ${_status.consecutiveFailures}.`,
      );
      result = {
        ok: false,
        invalidIndex: verification.invalidIndex,
        checkedAt,
        durationMs,
      };
      await sendTamperingAlert(verification.invalidIndex ?? -1);
    }
  } catch (err) {
    const durationMs = Date.now() - startTs;
    _status.consecutiveFailures++;
    logger.error(`audit-verification: Oväntat fel under verifiering: ${String(err)}`);
    result = { ok: false, checkedAt, durationMs };
  }

  _status.lastResult = result;
  return result;
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

export function startAuditVerificationScheduler(): void {
  if (_timer !== null) {
    logger.info('audit-verification: Schemaläggaren är redan igång.');
    return;
  }

  _status.running = true;
  _status.nextRunAt = new Date(Date.now() + _status.intervalMs).toISOString();

  logger.info(`audit-verification: Schemaläggaren startad (intervall ${_status.intervalMs} ms).`);

  // Kör direkt vid start
  runAuditVerificationOnce().catch((err) =>
    logger.error(`audit-verification: Startverifiering misslyckades: ${String(err)}`),
  );

  _timer = setInterval(() => {
    _status.nextRunAt = new Date(Date.now() + _status.intervalMs).toISOString();
    runAuditVerificationOnce().catch((err) =>
      logger.error(`audit-verification: Schemalagd verifiering misslyckades: ${String(err)}`),
    );
  }, _status.intervalMs);
}

export function stopAuditVerificationScheduler(): void {
  if (_timer !== null) {
    clearInterval(_timer);
    _timer = null;
  }
  _status.running = false;
  _status.nextRunAt = null;
  logger.info('audit-verification: Schemaläggaren stoppad.');
}

export function getAuditVerificationStatus(): Readonly<AuditVerificationSchedulerStatus> {
  return { ..._status };
}
