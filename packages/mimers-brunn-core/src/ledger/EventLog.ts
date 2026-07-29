import type { MimersLedgerEvent } from './Merkle';

export type LedgerEventInput = Omit<MimersLedgerEvent, 'sequence' | 'previousEventHash' | 'eventHash'>;

export interface EventLog {
  append(event: LedgerEventInput): Promise<MimersLedgerEvent>;
  getHead(): Promise<MimersLedgerEvent | null>;
  getAllEvents(): Promise<MimersLedgerEvent[]>;
  /** Find existing event by promotionHash for idempotent commits. */
  findByPromotionHash(promotionHash: string): Promise<MimersLedgerEvent | null>;
}
