import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  DiskQuarantineStorage,
  FileCASRepository,
  QuarantinePromoter,
  type DatasetApprovalArtifact
} from '@miljobeslut/mimers-brunn-core';

describe('L1-10 & L1-11 Dataset Approval & Promotion Boundary', () => {
  const testRoot = path.resolve(__dirname, '.approval-test-root');
  const quarantineDir = path.join(testRoot, '.quarantine');
  const casDir = path.join(testRoot, 'cas_store');

  let quarantine: DiskQuarantineStorage;
  let cas: FileCASRepository;
  let promoter: QuarantinePromoter;

  beforeAll(async () => {
    if (fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
    fs.mkdirSync(testRoot, { recursive: true });

    quarantine = new DiskQuarantineStorage(quarantineDir);
    cas = new FileCASRepository(casDir, { durabilityMode: process.platform === 'win32' ? 'best-effort' : 'strict' });
    await cas.initialize();

    promoter = new QuarantinePromoter(quarantine, cas);
  });

  afterAll(() => {
    if (fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it('can promote raw observation from quarantine to CAS with DatasetApprovalArtifact (Step 3)', async () => {
    // 1. Lägg en råfil i karantänen
    const bytes = new TextEncoder().encode('Miljörapport Vindkraft 2026');
    const sourceId = 'mpd_v1';
    const sourceUrl = 'https://lansstyrelsen.se/mpd/vind_2026.pdf';
    const fileName = 'vind_2026.pdf';

    const qResult = await quarantine.put(sourceId, sourceUrl, fileName, bytes, { test: 'vindkraft' });
    expect(qResult.quarantine_id).toBeDefined();

    // 2. Genomför formell promotion
    const approvedBy = 'mimer-librarian-jimmy';
    const governanceRelease = 'gov-release-2026.08.08';
    
    const promoResult = await promoter.promote(qResult.quarantine_id, approvedBy, governanceRelease);

    expect(promoResult.approval_hash).toBeDefined();
    expect(promoResult.content_hash).toBe(`sha256:${qResult.hash}`);
    expect(promoResult.is_duplicate).toBe(false);

    // 3. Verifiera att rådatan sparats korrekt i CAS
    const casBytes = await cas.getBytes(promoResult.content_hash);
    expect(casBytes).toBeDefined();
    expect(new TextDecoder().decode(casBytes!)).toBe('Miljörapport Vindkraft 2026');

    // 4. Verifiera att DatasetApprovalArtifact har sparats i CAS som oföränderligt governance-bevis
    const casPayload = await cas.get<{ identity: any; metadata: any }>(promoResult.approval_hash);
    expect(casPayload).toBeDefined();
    expect(casPayload!.identity.quarantine_id).toBe(qResult.quarantine_id);
    expect(casPayload!.identity.content_hash).toBe(qResult.hash);
    expect(casPayload!.identity.approved_for_cas).toBe(true);
    expect(casPayload!.metadata.approved_by).toBe(approvedBy);
    expect(casPayload!.metadata.governance_release).toBe(governanceRelease);

    // 5. Verifiera att statusen i karantänen har uppdaterats till 'promoted'
    const qMeta = await quarantine.getMetadata(qResult.quarantine_id);
    expect(qMeta!.status).toBe('promoted');
  });

  it('prevents double-promotion of the same quarantine artifact', async () => {
    const bytes = new TextEncoder().encode('Unikt innehåll för dubbel-promotion');
    const qResult = await quarantine.put('source_abc', 'url', 'test.txt', bytes);

    // Första promotion lyckas
    await promoter.promote(qResult.quarantine_id, 'user1', 'release1');

    // Andra promotion måste misslyckas och kasta ett fel
    await expect(promoter.promote(qResult.quarantine_id, 'user2', 'release1'))
      .rejects.toThrowError(/redan befordrats/i);
  });

  it('prevents promotion of rejected quarantine artifacts', async () => {
    const bytes = new TextEncoder().encode('Skräp-innehåll som kommer avvisas');
    const qResult = await quarantine.put('source_xyz', 'url', 'bad.txt', bytes);

    // Avvisa i karantänen
    await quarantine.updateStatus(qResult.quarantine_id, 'rejected', ['INTEGRITY_FAIL: Invalid header']);

    // Försök till promotion måste blockeras
    await expect(promoter.promote(qResult.quarantine_id, 'user1', 'release1'))
      .rejects.toThrowError(/rejected/i);
  });
});
