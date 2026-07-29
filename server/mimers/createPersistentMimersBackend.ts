import path from 'node:path';
import {
  FileCASRepository,
  FileEventLog,
  type DurabilityMode,
  type SigningKeyProvider,
} from '@miljobeslut/mimers-brunn-core';
import { MimersPromotionBackend } from './MimersPromotionBackend';

export type PersistentMimersBackend = {
  readonly rootDir: string;
  readonly cas: FileCASRepository;
  readonly eventLog: FileEventLog;
  readonly backend: MimersPromotionBackend;
};

/**
 * Create a durable Mimers backend under `<rootDir>/cas` + `<rootDir>/ledger`.
 * Call once at process start; EventLog reload verifies the hash chain + Merkle checkpoints.
 */
export async function createPersistentMimersBackend(
  rootDir: string,
  options: {
    readonly durabilityMode?: DurabilityMode;
    readonly signing?: SigningKeyProvider;
    /** Ledger segment rotation threshold (default 1000). `0` disables rotation. */
    readonly maxEventsPerSegment?: number;
    /** Emit chained Merkle checkpoints on segment close (default true). */
    readonly enableMerkleCheckpoints?: boolean;
    /** Signer for segment checkpoints (falls back to `signing` when set). */
    readonly checkpointSigning?: SigningKeyProvider;
  } = {},
): Promise<PersistentMimersBackend> {
  const durabilityMode = options.durabilityMode ?? 'best-effort';
  const cas = new FileCASRepository(path.join(rootDir, 'cas'), { durabilityMode });
  await cas.initialize();
  const eventLog = new FileEventLog(path.join(rootDir, 'ledger'), {
    durabilityMode,
    maxEventsPerSegment: options.maxEventsPerSegment,
    enableMerkleCheckpoints: options.enableMerkleCheckpoints,
    checkpointSigning: options.checkpointSigning ?? options.signing,
  });
  await eventLog.initialize();
  const backend = new MimersPromotionBackend(cas, eventLog, options.signing);
  return { rootDir, cas, eventLog, backend };
}
