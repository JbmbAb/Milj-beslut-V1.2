import type { CASRepository } from '../cas/CASRepository';
import { statusFromErrors, type AuditL3Options, type AuditReport } from './types';

export type QuarantineBatchResult = {
  readonly quarantined: readonly string[];
  readonly failed: readonly { readonly digest: string; readonly error: string }[];
};

/**
 * Repair — quarantine corrupt CAS objects (evidence-preserving).
 * Does not recompute domain state (Fas 4 M6).
 */
export class CasRepair {
  constructor(private readonly cas: CASRepository) {}

  /**
   * L3 storage scrub. Optionally quarantines corrupt digests when `quarantine: true`.
   * Streaming / O(concurrency) memory.
   */
  async auditL3(options: AuditL3Options = {}): Promise<AuditReport> {
    const concurrency = Math.max(1, options.concurrency ?? 8);
    const errors: string[] = [];
    const quarantined: string[] = [];
    let processed = 0;
    let skipping = options.afterDigest !== undefined;

    let available = concurrency;
    const waiters: Array<() => void> = [];
    const acquire = async (): Promise<void> => {
      if (available > 0) {
        available -= 1;
        return;
      }
      await new Promise<void>((resolve) => waiters.push(resolve));
    };
    const release = (): void => {
      const next = waiters.shift();
      if (next) next();
      else available += 1;
    };

    const tasks: Promise<void>[] = [];
    for await (const digest of this.cas.streamObjectDigests(options.signal)) {
      if (options.signal?.aborted) throw new Error('Operation aborted by user signal.');
      if (skipping) {
        if (digest === options.afterDigest) skipping = false;
        continue;
      }
      await acquire();
      tasks.push(
        (async () => {
          try {
            processed += 1;
            const result = await this.cas.verifyStoredObject(digest);
            if (!result.ok) {
              errors.push(`L3 ${result.error ?? `corrupt ${digest}`}`);
              if (options.quarantine) {
                const q = await this.cas.quarantineObject(
                  digest,
                  result.error ?? 'L3 storage scrub failure',
                );
                if (q.quarantined) quarantined.push(digest);
                else errors.push(`L3 quarantine failed ${digest}: ${q.error ?? 'unknown'}`);
              }
            }
          } finally {
            release();
          }
        })(),
      );
    }
    await Promise.all(tasks);

    return {
      status: statusFromErrors(errors),
      level: 'L3',
      processedCount: processed,
      errors,
      quarantined,
    };
  }

  /** Quarantine an explicit set of digests (ops / targeted repair). */
  async quarantineDigests(
    digests: readonly string[],
    reason: string,
  ): Promise<QuarantineBatchResult> {
    const quarantined: string[] = [];
    const failed: { digest: string; error: string }[] = [];
    for (const digest of digests) {
      const q = await this.cas.quarantineObject(digest, reason);
      if (q.quarantined) quarantined.push(digest);
      else failed.push({ digest, error: q.error ?? 'unknown' });
    }
    return { quarantined, failed };
  }
}
