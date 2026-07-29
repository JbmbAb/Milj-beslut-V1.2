import { describe, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { buildAuditBundle } from '../../../scripts/mimers/build-audit-bundle';
import { proveNfsFailover } from '../../../scripts/mimers/prove-nfs-failover';

describe('Sovereign remaining ops paths (§6 / audit)', () => {
  it('nfs proof skips cleanly without MIMERS_NFS_ROOT', async () => {
    const prev = process.env.MIMERS_NFS_ROOT;
    delete process.env.MIMERS_NFS_ROOT;
    try {
      const report = await proveNfsFailover({ sharedRoot: undefined });
      expect(report.skipped).toBe(true);
      expect(report.ok).toBe(false);
      expect(report.errors[0]).toMatch(/MIMERS_NFS_ROOT/);
    } finally {
      if (prev !== undefined) process.env.MIMERS_NFS_ROOT = prev;
    }
  });

  it('nfs proof passes on a shared local path (multi-client cold open)', async () => {
    // Local path exercises the failover *logic*; production DoD still requires a real NFS mount.
    const shared = path.resolve('tmp-artifacts', 'mimers-nfs-shared-lab');
    await rm(shared, { recursive: true, force: true });
    const report = await proveNfsFailover({ sharedRoot: shared });
    expect(report.skipped).toBe(false);
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.eventsAfterB).toBe(9);
    expect(report.nodeAReloadMatch).toBe(true);
    expect(report.externalVerifyOk).toBe(true);
  }, 60_000);

  it('audit bundle packages cas+ledger with verify report', async () => {
    const outDir = path.resolve('tmp-artifacts', 'mimers-audit-bundle-test');
    const report = await buildAuditBundle({ outDir });
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.seeded).toBe(true);
    expect(report.verifyOk).toBe(true);
    expect(report.events).toBeGreaterThanOrEqual(4);
  }, 60_000);
});
