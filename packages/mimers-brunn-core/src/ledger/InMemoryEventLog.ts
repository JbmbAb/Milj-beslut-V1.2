import { canonicalizeStrict, hashCanonicalValue } from '../serialization';
import { generateUUIDv7 } from './UUIDv7';
import type { EventLog, LedgerEventInput } from './EventLog';
import type { MimersLedgerEvent } from './Merkle';
import { sealLedgerEvent } from './sealLedgerEvent';

/** In-memory EventLog for tests and single-process smoke. */
export class InMemoryEventLog implements EventLog {
  private events: MimersLedgerEvent[] = [];
  private nextSequence = 1;

  async append(event: LedgerEventInput): Promise<MimersLedgerEvent> {
    const prev = await this.getHead();
    const previousEventHash = prev ? prev.eventHash : null;
    const full = sealLedgerEvent(event, this.nextSequence, previousEventHash);
    this.events.push(full);
    this.nextSequence += 1;
    return full;
  }

  async getHead(): Promise<MimersLedgerEvent | null> {
    return this.events.length === 0 ? null : this.events[this.events.length - 1]!;
  }

  async getAllEvents(): Promise<MimersLedgerEvent[]> {
    return [...this.events];
  }

  async findByPromotionHash(promotionHash: string): Promise<MimersLedgerEvent | null> {
    return this.events.find((e) => e.promotionHash === promotionHash) ?? null;
  }
}

export function newLedgerEventId(): string {
  return generateUUIDv7();
}

export function verifyLedgerHashChain(events: readonly MimersLedgerEvent[]): {
  readonly ok: boolean;
  readonly errors: readonly string[];
} {
  const errors: string[] = [];
  let prevHash: string | null = null;
  for (const event of events) {
    if (event.previousEventHash !== prevHash) {
      errors.push(
        `Chain break at seq ${event.sequence}: previousEventHash=${event.previousEventHash} expected=${prevHash}`,
      );
    }
    const core = {
      sequence: event.sequence,
      previousEventHash: event.previousEventHash,
      eventId: event.eventId,
      type: event.type,
      promotionHash: event.promotionHash,
      manifestHash: event.manifestHash,
      timestamp: event.timestamp,
    };
    const expected = hashCanonicalValue(core);
    if (expected !== event.eventHash) {
      errors.push(`Event hash mismatch at seq ${event.sequence}`);
    }
    void canonicalizeStrict(core);
    prevHash = event.eventHash;
  }
  return { ok: errors.length === 0, errors };
}
