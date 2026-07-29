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
 * Call once at process start; EventLog reload verifies the hash chain.
 */
export async function createPersistentMimersBackend(
  rootDir: string,
  options: {
    readonly durabilityMode?: DurabilityMode;
    readonly signing?: SigningKeyProvider;
  } = {},
): Promise<PersistentMimersBackend> {
  const durabilityMode = options.durabilityMode ?? 'best-effort';
  const cas = new FileCASRepository(path.join(rootDir, 'cas'), { durabilityMode });
  await cas.initialize();
  const eventLog = new FileEventLog(path.join(rootDir, 'ledger'), { durabilityMode });
  await eventLog.initialize();
  const backend = new MimersPromotionBackend(cas, eventLog, options.signing);
  return { rootDir, cas, eventLog, backend };
}
