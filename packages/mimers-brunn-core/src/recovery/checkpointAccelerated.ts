import {
  verifyChainedCheckpointSequence,
  type ChainedLedgerCheckpoint,
} from '../ledger/chainedCheckpoint';
import { MerkleTree, type MimersLedgerEvent } from '../ledger/Merkle';

/**
 * Checkpoint-accelerated recovery plan (ops proof):
 * trust closed-segment Merkle checkpoints, then only re-verify the open-segment tail.
 * Segment checkpoint roots are per-segment (not cumulative); chain verify recomputes each slice.
 */
export type CheckpointAcceleratedPlan = {
  readonly coveredThroughSequence: number;
  readonly coveredEventCount: number;
  readonly tailEvents: readonly MimersLedgerEvent[];
  readonly coveredEvents: readonly MimersLedgerEvent[];
  readonly latestCheckpoint: ChainedLedgerCheckpoint | null;
  readonly fullMerkleRoot: string;
  readonly checkpointChainOk: boolean;
  readonly checkpointChainErrors: readonly string[];
  /**
   * True when checkpoint chain verifies and Merkle(all events) equals
   * Merkle(covered ∪ tail) — i.e. accelerated plan partitions the same event set.
   */
  readonly identicalToFullReplay: boolean;
};

export function buildCheckpointAcceleratedPlan(
  events: readonly MimersLedgerEvent[],
  checkpoints: readonly ChainedLedgerCheckpoint[],
): CheckpointAcceleratedPlan {
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
  const cps = [...checkpoints].sort((a, b) => a.segmentId - b.segmentId);
  const latest = cps.length === 0 ? null : cps[cps.length - 1]!;
  const coveredThrough = latest?.toSequence ?? 0;

  const coveredEvents = sorted.filter((e) => e.sequence <= coveredThrough);
  const tailEvents = sorted.filter((e) => e.sequence > coveredThrough);

  const chain = verifyChainedCheckpointSequence(cps, sorted);
  const fullMerkleRoot = MerkleTree.computeEventRoot(sorted);
  const recomputed = MerkleTree.computeEventRoot([...coveredEvents, ...tailEvents]);
  const identicalToFullReplay = chain.ok && recomputed === fullMerkleRoot;

  return {
    coveredThroughSequence: coveredThrough,
    coveredEventCount: coveredEvents.length,
    tailEvents,
    coveredEvents,
    latestCheckpoint: latest,
    fullMerkleRoot,
    checkpointChainOk: chain.ok,
    checkpointChainErrors: chain.errors,
    identicalToFullReplay,
  };
}
