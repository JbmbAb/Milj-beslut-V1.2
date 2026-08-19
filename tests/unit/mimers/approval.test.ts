import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  DiskQuarantineStorage,
  FileCASRepository,
  QuarantinePromoter,
  LocalPemSigningKeyProvider,
  createArtifactAttestation,
  PROMOTION_ACTION,
  PROMOTION_ATTESTATION_PREDICATE_TYPE,
  PROMOTION_ATTESTATION_SCHEMA_VERSION,
  type ArtifactAttestation,
  type SigningKeyProvider,
  type PromotionAttestationPredicate,
} from '@miljobeslut/mimers-brunn-core';

describe('L1-10 & L1-11 Dataset Approval & Promotion Boundary', () => {
  const testRoot = path.resolve(__dirname, '.approval-test-root');
  const quarantineDir = path.join(testRoot, '.quarantine');
  const casDir = path.join(testRoot, 'cas_store');

  let quarantine: DiskQuarantineStorage;
  let cas: FileCASRepository;
  let promoter: QuarantinePromoter;
  let signing: SigningKeyProvider;

  // Builds a validly signed promotion attestation for a given quarantine item — mirrors what
  // server/routes/governance.routes.ts does server-side after the ADMIN check (ADR-042 Level 2).
  async function buildAttestation(args: {
    quarantineId: string;
    contentHash: string;
    approverActorId: string;
    approverRole: string;
    governanceRelease: string;
  }): Promise<ArtifactAttestation> {
    const predicate: PromotionAttestationPredicate = {
      action: PROMOTION_ACTION,
      quarantine_artifact_id: args.quarantineId,
      quarantine_content_hash: args.contentHash,
      approver_actor_id: args.approverActorId,
      approver_role: args.approverRole,
      governance_release: args.governanceRelease,
      attestation_schema_version: PROMOTION_ATTESTATION_SCHEMA_VERSION,
      signer_key_id: signing.keyId,
    };
    return createArtifactAttestation({
      subjectDigest: `sha256:${args.contentHash}`,
      predicateType: PROMOTION_ATTESTATION_PREDICATE_TYPE,
      predicate: predicate as unknown as Record<string, unknown>,
      signing,
    });
  }

  beforeAll(async () => {
    if (fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
    fs.mkdirSync(testRoot, { recursive: true });

    quarantine = new DiskQuarantineStorage(quarantineDir);
    cas = new FileCASRepository(casDir, { durabilityMode: process.platform === 'win32' ? 'best-effort' : 'strict' });
    await cas.initialize();

    signing = LocalPemSigningKeyProvider.generate('ed25519:test-approval-suite').provider;
    promoter = new QuarantinePromoter(quarantine, cas, signing);
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

    // 2. Genomför formell promotion — routen bygger attestationen server-side; testet gör
    // detsamma explicit för att bevisa kontraktet utan HTTP-lagret.
    const approvedBy = 'mimer-librarian-jimmy';
    const approverRole = 'ADMIN';
    const governanceRelease = 'gov-release-2026.08.08';

    const attestation = await buildAttestation({
      quarantineId: qResult.quarantine_id,
      contentHash: qResult.hash,
      approverActorId: approvedBy,
      approverRole,
      governanceRelease,
    });

    const promoResult = await promoter.promote(qResult.quarantine_id, attestation, governanceRelease);

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
    expect(casPayload!.metadata.approver_role).toBe(approverRole);
    expect(casPayload!.metadata.governance_release).toBe(governanceRelease);
    // The real cryptographic proof is stored, not a reproducible hash-of-identity.
    expect(casPayload!.metadata.attestation.signature).toBe(attestation.signature);

    // 5. Verifiera att statusen i karantänen har uppdaterats till 'promoted'
    const qMeta = await quarantine.getMetadata(qResult.quarantine_id);
    expect(qMeta!.status).toBe('promoted');
  });

  it('prevents double-promotion of the same quarantine artifact', async () => {
    const bytes = new TextEncoder().encode('Unikt innehåll för dubbel-promotion');
    const qResult = await quarantine.put('source_abc', 'url', 'test.txt', bytes);

    const attestation1 = await buildAttestation({
      quarantineId: qResult.quarantine_id,
      contentHash: qResult.hash,
      approverActorId: 'user1',
      approverRole: 'ADMIN',
      governanceRelease: 'release1',
    });

    // Första promotion lyckas
    await promoter.promote(qResult.quarantine_id, attestation1, 'release1');

    const attestation2 = await buildAttestation({
      quarantineId: qResult.quarantine_id,
      contentHash: qResult.hash,
      approverActorId: 'user2',
      approverRole: 'ADMIN',
      governanceRelease: 'release1',
    });

    // Andra promotion måste misslyckas och kasta ett fel
    await expect(promoter.promote(qResult.quarantine_id, attestation2, 'release1'))
      .rejects.toThrowError(/redan befordrats/i);
  });

  it('prevents promotion of rejected quarantine artifacts', async () => {
    const bytes = new TextEncoder().encode('Skräp-innehåll som kommer avvisas');
    const qResult = await quarantine.put('source_xyz', 'url', 'bad.txt', bytes);

    // Avvisa i karantänen
    await quarantine.updateStatus(qResult.quarantine_id, 'rejected', ['INTEGRITY_FAIL: Invalid header']);

    const attestation = await buildAttestation({
      quarantineId: qResult.quarantine_id,
      contentHash: qResult.hash,
      approverActorId: 'user1',
      approverRole: 'ADMIN',
      governanceRelease: 'release1',
    });

    // Försök till promotion måste blockeras
    await expect(promoter.promote(qResult.quarantine_id, attestation, 'release1'))
      .rejects.toThrowError(/rejected/i);
  });
});
