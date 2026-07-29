import { createHash } from 'node:crypto';
import { canonicalizeStrict, hashSerialized, parseHash } from '../serialization';

export interface MimersLedgerEvent {
  readonly sequence: number;
  readonly previousEventHash: string | null;
  readonly eventHash: string;
  readonly eventId: string;
  readonly type: 'PROMOTION_COMMITTED' | 'PROMOTION_APPROVED' | 'PROMOTION_ACTIVATED';
  readonly promotionHash: string;
  readonly manifestHash: string;
  readonly timestamp: number;
}

export const MERKLE_PROFILE = {
  id: 'mimers-merkle-sha256-v1',
  hashAlgorithm: 'sha256' as const,
  oddNodeRule: 'promote' as const,
};

export class MerkleTree {
  static computeEventRoot(events: readonly MimersLedgerEvent[]): string {
    if (events.length === 0) {
      return hashSerialized('mimers-merkle-empty-v1', MERKLE_PROFILE.hashAlgorithm);
    }

    const sortedEvents = [...events].sort((a, b) => a.sequence - b.sequence);
    let currentLevel = sortedEvents.map((event) => {
      const eventBytes = Buffer.from(canonicalizeStrict(event), 'utf-8');
      const hashStream = createHash(MERKLE_PROFILE.hashAlgorithm);
      hashStream.update(Buffer.from([0x00]));
      hashStream.update(Buffer.from('mimers-ledger-event-v1\0', 'utf-8'));
      hashStream.update(eventBytes);
      return `${MERKLE_PROFILE.hashAlgorithm}:${hashStream.digest('hex')}`;
    });

    const nodePrefix = Buffer.from([0x01]);
    while (currentLevel.length > 1) {
      const nextLevel: string[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        if (i + 1 < currentLevel.length) {
          const left = parseHash(currentLevel[i]!);
          const right = parseHash(currentLevel[i + 1]!);
          const hashStream = createHash(MERKLE_PROFILE.hashAlgorithm);
          hashStream.update(nodePrefix);
          hashStream.update(Buffer.from(left.digest, 'hex'));
          hashStream.update(Buffer.from(right.digest, 'hex'));
          nextLevel.push(`${MERKLE_PROFILE.hashAlgorithm}:${hashStream.digest('hex')}`);
        } else {
          nextLevel.push(currentLevel[i]!);
        }
      }
      currentLevel = nextLevel;
    }
    return currentLevel[0]!;
  }
}
