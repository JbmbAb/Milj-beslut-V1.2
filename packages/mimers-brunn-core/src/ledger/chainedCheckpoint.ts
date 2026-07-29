import { canonicalizeStrict, hashCanonicalValue } from '../serialization';
import type { SignatureEnvelope, SigningKeyProvider } from '../signing/SignatureEnvelope';
import { buildLedgerMerkleCheckpoint } from './checkpointBuilder';
import type { LedgerMerkleCheckpoint } from './checkpoints';
import type { MimersLedgerEvent } from './Merkle';

/**
 * Merkle checkpoint chained across closed ledger segments (Fas 4 M5).
 * previousRoot links to the prior segment's root (null for the first).
 */
export interface ChainedLedgerCheckpoint {
  readonly kind: 'chained-ledger-checkpoint';
  readonly schemaVersion: 'checkpoint.ledger.chained.v1';
  readonly segmentId: number;
  readonly rootHash: string;
  readonly previousRoot: string | null;
  readonly fromSequence: number;
  readonly toSequence: number;
  readonly eventCount: number;
  readonly hashAlgorithm: 'sha256';
  readonly createdAt: string;
  /** Embedded range checkpoint (same rootHash). */
  readonly ledger: LedgerMerkleCheckpoint;
}

export interface SignedChainedLedgerCheckpoint {
  readonly kind: 'signed-chained-ledger-checkpoint';
  readonly schemaVersion: 'checkpoint.ledger.chained.signed.v1';
  readonly checkpoint: ChainedLedgerCheckpoint;
  readonly checkpointDigest: string;
  readonly envelope: SignatureEnvelope;
}

export function buildChainedLedgerCheckpoint(
  events: readonly MimersLedgerEvent[],
  options: {
    readonly segmentId: number;
    readonly previousRoot: string | null;
  },
): ChainedLedgerCheckpoint {
  const ledger = buildLedgerMerkleCheckpoint(events);
  return {
    kind: 'chained-ledger-checkpoint',
    schemaVersion: 'checkpoint.ledger.chained.v1',
    segmentId: options.segmentId,
    rootHash: ledger.rootHash,
    previousRoot: options.previousRoot,
    fromSequence: ledger.fromSequence,
    toSequence: ledger.toSequence,
    eventCount: ledger.eventCount,
    hashAlgorithm: 'sha256',
    createdAt: ledger.createdAt,
    ledger,
  };
}

export async function signChainedLedgerCheckpoint(
  checkpoint: ChainedLedgerCheckpoint,
  signing: SigningKeyProvider,
): Promise<SignedChainedLedgerCheckpoint> {
  const checkpointDigest = hashCanonicalValue(checkpoint);
  const bytes = Buffer.from(canonicalizeStrict(checkpoint), 'utf-8');
  const envelope = await signing.sign(bytes);
  return {
    kind: 'signed-chained-ledger-checkpoint',
    schemaVersion: 'checkpoint.ledger.chained.signed.v1',
    checkpoint,
    checkpointDigest,
    envelope,
  };
}

export async function verifySignedChainedLedgerCheckpoint(
  signed: SignedChainedLedgerCheckpoint,
  signing: SigningKeyProvider,
): Promise<boolean> {
  const digest = hashCanonicalValue(signed.checkpoint);
  if (digest !== signed.checkpointDigest) return false;
  const bytes = Buffer.from(canonicalizeStrict(signed.checkpoint), 'utf-8');
  return signing.verify(bytes, signed.envelope);
}

export type CheckpointChainVerifyResult = {
  readonly ok: boolean;
  readonly errors: readonly string[];
};

/** Verify previousRoot chain + recompute merkle roots for each segment range. */
export function verifyChainedCheckpointSequence(
  checkpoints: readonly ChainedLedgerCheckpoint[],
  allEvents: readonly MimersLedgerEvent[],
): CheckpointChainVerifyResult {
  const errors: string[] = [];
  const sorted = [...checkpoints].sort((a, b) => a.segmentId - b.segmentId);
  let expectedPrevious: string | null = null;

  for (const cp of sorted) {
    if (cp.previousRoot !== expectedPrevious) {
      errors.push(
        `segment ${cp.segmentId}: previousRoot mismatch (expected ${expectedPrevious}, got ${cp.previousRoot})`,
      );
    }
    const slice = allEvents.filter(
      (e) => e.sequence >= cp.fromSequence && e.sequence <= cp.toSequence,
    );
    if (slice.length !== cp.eventCount) {
      errors.push(
        `segment ${cp.segmentId}: eventCount ${cp.eventCount} != filtered ${slice.length}`,
      );
    } else {
      const recomputed = buildLedgerMerkleCheckpoint(slice);
      if (recomputed.rootHash !== cp.rootHash) {
        errors.push(
          `segment ${cp.segmentId}: rootHash mismatch (stored ${cp.rootHash}, recomputed ${recomputed.rootHash})`,
        );
      }
    }
    expectedPrevious = cp.rootHash;
  }

  return { ok: errors.length === 0, errors };
}

export function parseChainedLedgerCheckpoint(raw: unknown): ChainedLedgerCheckpoint {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Invalid chained checkpoint: must be an object.');
  }
  const o = raw as Record<string, unknown>;
  if (o.kind === 'signed-chained-ledger-checkpoint') {
    return parseChainedLedgerCheckpoint((o as { checkpoint: unknown }).checkpoint);
  }
  if (o.kind !== 'chained-ledger-checkpoint' || o.schemaVersion !== 'checkpoint.ledger.chained.v1') {
    throw new Error(`Unsupported checkpoint kind/version: ${String(o.kind)}/${String(o.schemaVersion)}`);
  }
  if (typeof o.segmentId !== 'number' || typeof o.rootHash !== 'string') {
    throw new Error('Invalid chained checkpoint fields.');
  }
  if (o.previousRoot !== null && typeof o.previousRoot !== 'string') {
    throw new Error('Invalid previousRoot.');
  }
  return o as unknown as ChainedLedgerCheckpoint;
}

export function parseSignedChainedLedgerCheckpoint(raw: unknown): SignedChainedLedgerCheckpoint {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Invalid signed checkpoint: must be an object.');
  }
  const o = raw as Record<string, unknown>;
  if (o.kind !== 'signed-chained-ledger-checkpoint') {
    throw new Error(`Expected signed-chained-ledger-checkpoint, got ${String(o.kind)}`);
  }
  const checkpoint = parseChainedLedgerCheckpoint(o.checkpoint);
  if (typeof o.checkpointDigest !== 'string' || typeof o.envelope !== 'object' || o.envelope === null) {
    throw new Error('Invalid signed checkpoint envelope/digest.');
  }
  return {
    kind: 'signed-chained-ledger-checkpoint',
    schemaVersion: 'checkpoint.ledger.chained.signed.v1',
    checkpoint,
    checkpointDigest: o.checkpointDigest,
    envelope: o.envelope as SignatureEnvelope,
  };
}
