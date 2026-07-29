/**
 * Append-only ledger segment metadata (Fas 4 M4).
 * Segments are closed immutably; new events go to the next open segment.
 */
export interface LedgerSegmentMeta {
  readonly schemaVersion: 'ledger.segment.v1';
  readonly segmentId: number;
  readonly firstSequence: number;
  readonly lastSequence: number;
  readonly eventCount: number;
  readonly closed: boolean;
  readonly closedAt?: string;
  readonly firstEventHash: string | null;
  readonly lastEventHash: string | null;
  /**
   * When `'legacy-events'`, event JSON files live under `<base>/events/`
   * (pre-segmentation layout). Otherwise files live under `segments/NNNNNNNN/`.
   */
  readonly storage: 'segment-dir' | 'legacy-events';
}

export type FileEventLogOptions = {
  readonly durabilityMode?: import('../cas/CASRepository').DurabilityMode;
  /**
   * Rotate to a new segment after this many events in the active segment.
   * Default `1000`. Set `0` to disable rotation (single open segment grows unboundedly,
   * or legacy flat `events/` if that layout is already in use).
   */
  readonly maxEventsPerSegment?: number;
  /**
   * When true (default), emit a chained Merkle checkpoint each time a segment closes.
   * Set false to disable automatic checkpoints.
   */
  readonly enableMerkleCheckpoints?: boolean;
  /** Optional signer for segment checkpoints (unsigned JSON if omitted). */
  readonly checkpointSigning?: import('../signing/SignatureEnvelope').SigningKeyProvider;
  /**
   * Missing closed-segment checkpoints:
   * - `backfill` (default): recreate from events (Repair path).
   * - `fail-closed`: throw LedgerCorruptionError (Verifier path).
   */
  readonly checkpointPolicy?: 'backfill' | 'fail-closed';
};

export const DEFAULT_MAX_EVENTS_PER_SEGMENT = 1000;

export function segmentDirName(segmentId: number): string {
  return segmentId.toString().padStart(8, '0');
}

export function eventFileName(sequence: number): string {
  return `${sequence.toString().padStart(8, '0')}.json`;
}

export function parseSegmentMeta(raw: unknown): LedgerSegmentMeta {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Invalid segment meta: must be an object.');
  }
  const m = raw as Record<string, unknown>;
  if (m.schemaVersion !== 'ledger.segment.v1') {
    throw new Error(`Unsupported segment schemaVersion: ${String(m.schemaVersion)}`);
  }
  if (typeof m.segmentId !== 'number' || !Number.isSafeInteger(m.segmentId) || m.segmentId < 1) {
    throw new Error('Invalid segmentId.');
  }
  if (typeof m.firstSequence !== 'number' || !Number.isSafeInteger(m.firstSequence) || m.firstSequence < 1) {
    throw new Error('Invalid firstSequence.');
  }
  if (typeof m.lastSequence !== 'number' || !Number.isSafeInteger(m.lastSequence) || m.lastSequence < 0) {
    throw new Error('Invalid lastSequence.');
  }
  if (typeof m.eventCount !== 'number' || !Number.isSafeInteger(m.eventCount) || m.eventCount < 0) {
    throw new Error('Invalid eventCount.');
  }
  if (typeof m.closed !== 'boolean') {
    throw new Error('Invalid closed flag.');
  }
  if (m.storage !== 'segment-dir' && m.storage !== 'legacy-events') {
    throw new Error(`Invalid storage: ${String(m.storage)}`);
  }
  if (m.firstEventHash !== null && typeof m.firstEventHash !== 'string') {
    throw new Error('Invalid firstEventHash.');
  }
  if (m.lastEventHash !== null && typeof m.lastEventHash !== 'string') {
    throw new Error('Invalid lastEventHash.');
  }
  if (m.closedAt !== undefined && typeof m.closedAt !== 'string') {
    throw new Error('Invalid closedAt.');
  }
  return {
    schemaVersion: 'ledger.segment.v1',
    segmentId: m.segmentId,
    firstSequence: m.firstSequence,
    lastSequence: m.lastSequence,
    eventCount: m.eventCount,
    closed: m.closed,
    ...(typeof m.closedAt === 'string' ? { closedAt: m.closedAt } : {}),
    firstEventHash: m.firstEventHash as string | null,
    lastEventHash: m.lastEventHash as string | null,
    storage: m.storage,
  };
}
