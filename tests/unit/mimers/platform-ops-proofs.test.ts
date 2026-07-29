import { describe, expect, it } from 'vitest';
import { proveBackupRestore } from '../../../scripts/mimers/prove-backup-restore';
import { proveDurabilityMatrix } from '../../../scripts/mimers/prove-durability-matrix';

describe('Sovereign DoD platform ops (§6)', () => {
  it('backup/restore reconstitutes identical CAS+ledger after live wipe', async () => {
    const report = await proveBackupRestore({ eventCount: 9 });
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.hashesMatch).toBe(true);
    expect(report.restoredMerkleRoot).toBe(report.seedMerkleRoot);
    expect(report.recoverStatus).toBe('CLEAN');
    expect(report.externalVerifyOk).toBe(true);
    expect(report.eventCount).toBe(9);
  }, 60_000);

  it('durability matrix proves none+best-effort on this platform', async () => {
    const report = await proveDurabilityMatrix();
    expect(report.platformGateOk).toBe(true);
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);

    const byMode = Object.fromEntries(report.cells.map((c) => [c.mode, c]));
    expect(byMode.none?.status).toBe('PROVEN');
    expect(byMode['best-effort']?.status).toBe('PROVEN');
    expect(['PROVEN', 'UNSUPPORTED']).toContain(byMode.strict?.status);
    expect(['SKIPPED', 'PROVEN']).toContain(byMode['nfs-failover']?.status);
  }, 60_000);
});
