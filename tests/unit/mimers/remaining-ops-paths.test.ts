import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildAuditBundle } from '../../../scripts/mimers/build-audit-bundle';
import { proveNfsFailover } from '../../../scripts/mimers/prove-nfs-failover';

// TEST-DB-GUARD, TDG-4: the proofs' outputs -- the shared lab, the evidence JSON and the audit bundle -- go
// to a temp directory of this test, never into `<cwd>/tmp-artifacts` of the tree the run happens in (with
// cwd in a product worktree that was the live tree; the write guard now refuses it).
const tempWorkDir = (prefix: string) => mkdtempSync(path.join(os.tmpdir(), prefix));

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
    const work = tempWorkDir('mimers-nfs-proof-');
    const shared = path.join(work, 'mimers-nfs-shared-lab');
    // The proof writes its evidence to path.resolve('tmp-artifacts'): run it as if from `work`.
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(work);
    try {
      const report = await proveNfsFailover({ sharedRoot: shared });
      expect(report.skipped).toBe(false);
      expect(report.errors).toEqual([]);
      expect(report.ok).toBe(true);
      expect(report.eventsAfterB).toBe(9);
      expect(report.nodeAReloadMatch).toBe(true);
      expect(report.externalVerifyOk).toBe(true);
      expect(report.evidencePath).toBe(path.join(work, 'tmp-artifacts', 'mimers-nfs-failover.json'));
    } finally {
      cwd.mockRestore();
    }
  }, 60_000);

  it('audit bundle packages cas+ledger with verify report', async () => {
    const outDir = path.join(tempWorkDir('mimers-audit-bundle-'), 'bundle');
    const report = await buildAuditBundle({ outDir });
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.seeded).toBe(true);
    expect(report.verifyOk).toBe(true);
    expect(report.events).toBeGreaterThanOrEqual(4);
  }, 60_000);
});
