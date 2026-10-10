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
 * Production callers should derive `rootDir` from `CAS_ROOT` where basename(CAS_ROOT)==="cas"
 * so the CAS physical path equals `CAS_ROOT` exactly (no MIMERS_ROOT fallback).
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
    /** When set, must normalize-equal `<rootDir>/cas` (CAS_ROOT coherence). */
    readonly expectedCasRoot?: string;
  } = {},
): Promise<PersistentMimersBackend> {
  const durabilityMode = options.durabilityMode ?? 'best-effort';
  const casPath = path.resolve(rootDir, 'cas');
  if (options.expectedCasRoot) {
    const expected = path.resolve(options.expectedCasRoot);
    if (casPath.toLowerCase() !== expected.toLowerCase()) {
      throw new Error(
        `CAS_ROOT_INCOHERENT: expected CAS physical root '${expected}' but backend would open '${casPath}'`,
      );
    }
  }
  const cas = new FileCASRepository(casPath, { durabilityMode });
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
