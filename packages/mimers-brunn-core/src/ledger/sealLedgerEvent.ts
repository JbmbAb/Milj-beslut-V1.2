import { canonicalizeStrict, hashCanonicalValue } from '../serialization';
import type { LedgerEventInput } from './EventLog';
import type { MimersLedgerEvent } from './Merkle';

/** Seal a ledger event with sequence + previous hash (shared by in-memory and file logs). */
export function sealLedgerEvent(
  event: LedgerEventInput,
  sequence: number,
  previousEventHash: string | null,
): MimersLedgerEvent {
  const corePayload = {
    sequence,
    previousEventHash,
    eventId: event.eventId,
    type: event.type,
    promotionHash: event.promotionHash,
    manifestHash: event.manifestHash,
    timestamp: event.timestamp,
  };
  const eventHash = hashCanonicalValue(corePayload);
  return { ...corePayload, eventHash };
}

export function parseLedgerEvent(raw: unknown): MimersLedgerEvent {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Invalid ledger event: must be an object.');
  }
  const e = raw as Record<string, unknown>;
  if (typeof e.sequence !== 'number' || !Number.isSafeInteger(e.sequence) || e.sequence < 1) {
    throw new Error('Invalid ledger event: sequence must be a positive safe integer.');
  }
  if (e.previousEventHash !== null && typeof e.previousEventHash !== 'string') {
    throw new Error('Invalid ledger event: previousEventHash must be string | null.');
  }
  if (typeof e.eventHash !== 'string') throw new Error('Invalid ledger event: missing eventHash.');
  if (typeof e.eventId !== 'string') throw new Error('Invalid ledger event: missing eventId.');
  if (
    e.type !== 'PROMOTION_COMMITTED' &&
    e.type !== 'PROMOTION_APPROVED' &&
    e.type !== 'PROMOTION_ACTIVATED'
  ) {
    throw new Error(`Invalid ledger event type: ${String(e.type)}`);
  }
  if (typeof e.promotionHash !== 'string') throw new Error('Invalid ledger event: missing promotionHash.');
  if (typeof e.manifestHash !== 'string') throw new Error('Invalid ledger event: missing manifestHash.');
  if (typeof e.timestamp !== 'number') throw new Error('Invalid ledger event: missing timestamp.');

  const sealed = sealLedgerEvent(
    {
      eventId: e.eventId,
      type: e.type,
      promotionHash: e.promotionHash,
      manifestHash: e.manifestHash,
      timestamp: e.timestamp,
    },
    e.sequence,
    e.previousEventHash as string,
  );
  if (sealed.eventHash !== e.eventHash) {
    throw new Error(`Ledger event hash mismatch at sequence ${e.sequence}`);
  }
  // Ensure stored form matches canonical seal (rejects extra fields silently by re-seal).
  void canonicalizeStrict(sealed);
  return sealed;
}
