// tests/unit/mimers/quarantinePromotionAttestation.test.ts
//
// ADR-042 Level 2 — Cryptographic Promotion Authority.
// See docs/architecture/GAP-REPORT-harvest-governance-2026-08-10.md, "SPEC TIGHTENED".
//
// QuarantinePromoter.promote() now requires a signed ArtifactAttestation that cryptographically
// binds the exact promotion operation (action, quarantine artifact id, its content hash,
// approver id/role, governance_release, signer key id) — not a bare "who approved" string.
// This suite proves the promoter itself is the trust boundary, independent of the HTTP route:
// every test here calls promoter.promote() directly, bypassing Express entirely, exactly as
// the spec's "Kritiskt" acceptance criterion requires.
//
// Covers the spec's required test plan:
//   - direct call, no route involved, missing/invalid attestation -> rejected
//   - 4 named negative binding tests (artifact substitution, action substitution,
//     governance_release tampering, content-hash tampering)
//   - 1 replay/determinism test
// Plus two extra binding checks (wrong signer key, missing approver fields) that the spec's
// 8-step ordered checklist calls out explicitly even though they weren't named among the
// "four new" tests.

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  DiskQuarantineStorage,
  FileCASRepository,
  QuarantinePromoter,
  GovernanceAttestationError,
  LocalPemSigningKeyProvider,
  createArtifactAttestation,
  verifyArtifactAttestation,
  PROMOTION_ACTION,
  PROMOTION_ATTESTATION_PREDICATE_TYPE,
  PROMOTION_ATTESTATION_SCHEMA_VERSION,
  type ArtifactAttestation,
  type SigningKeyProvider,
  type PromotionAttestationPredicate,
} from '@miljobeslut/mimers-brunn-core';

describe('QuarantinePromoter — Level 2 cryptographic promotion authority', () => {
  const testRoot = path.resolve(__dirname, '.attestation-test-root');
  const quarantineDir = path.join(testRoot, '.quarantine');
  const casDir = path.join(testRoot, 'cas_store');

  let quarantine: DiskQuarantineStorage;
  let cas: FileCASRepository;
  let signing: SigningKeyProvider;
  let promoter: QuarantinePromoter;
  let otherSigning: SigningKeyProvider; // A different, independently-valid key pair.

  async function putItem(label: string) {
    const bytes = new TextEncoder().encode(`content for ${label} ${Math.random()}`);
    return quarantine.put(`source_${label}`, `https://example.se/${label}`, `${label}.txt`, bytes);
  }

  async function buildPredicate(args: {
    quarantineId: string;
    contentHash: string;
    governanceRelease: string;
    action?: string;
    approverActorId?: string;
    approverRole?: string;
    signerKeyId?: string;
  }): Promise<PromotionAttestationPredicate> {
    return {
      action: (args.action ?? PROMOTION_ACTION) as typeof PROMOTION_ACTION,
      quarantine_artifact_id: args.quarantineId,
      quarantine_content_hash: args.contentHash,
      approver_actor_id: args.approverActorId ?? 'admin-1',
      approver_role: args.approverRole ?? 'ADMIN',
      governance_release: args.governanceRelease,
      attestation_schema_version: PROMOTION_ATTESTATION_SCHEMA_VERSION,
      signer_key_id: args.signerKeyId ?? signing.keyId,
    };
  }

  async function sign(
    predicate: PromotionAttestationPredicate,
    withSigning: SigningKeyProvider = signing,
  ): Promise<ArtifactAttestation> {
    return createArtifactAttestation({
      subjectDigest: `sha256:${predicate.quarantine_content_hash}`,
      predicateType: PROMOTION_ATTESTATION_PREDICATE_TYPE,
      predicate: predicate as unknown as Record<string, unknown>,
      signing: withSigning,
    });
  }

  beforeAll(async () => {
    if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true, force: true });
    fs.mkdirSync(testRoot, { recursive: true });

    quarantine = new DiskQuarantineStorage(quarantineDir);
    cas = new FileCASRepository(casDir, { durabilityMode: process.platform === 'win32' ? 'best-effort' : 'strict' });
    await cas.initialize();

    signing = LocalPemSigningKeyProvider.generate('ed25519:test-governance-authority').provider;
    otherSigning = LocalPemSigningKeyProvider.generate('ed25519:not-the-governance-key').provider;
    promoter = new QuarantinePromoter(quarantine, cas, signing);
  });

  afterAll(() => {
    if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('direct call bypassing the HTTP route, with a self-constructed but invalid attestation, is rejected', async () => {
    const q = await putItem('bypass-http');

    const forged: ArtifactAttestation = {
      subjectDigest: `sha256:${q.hash}`,
      predicateType: PROMOTION_ATTESTATION_PREDICATE_TYPE,
      predicate: {
        action: PROMOTION_ACTION,
        quarantine_artifact_id: q.quarantine_id,
        quarantine_content_hash: q.hash,
        approver_actor_id: 'attacker',
        approver_role: 'ADMIN',
        governance_release: 'v1',
        attestation_schema_version: PROMOTION_ATTESTATION_SCHEMA_VERSION,
        signer_key_id: signing.keyId,
      },
      hashAlgorithm: 'sha256',
      signatureAlgorithm: 'Ed25519',
      signer: signing.keyId,
      signature: 'ed25519:not-a-real-signature==',
    };

    await expect(promoter.promote(q.quarantine_id, forged, 'v1')).rejects.toThrow(GovernanceAttestationError);
    await expect(promoter.promote(q.quarantine_id, forged, 'v1')).rejects.toThrow(/kryptografiska signatur är ogiltig/i);

    // Never mutated: still quarantined, nothing written to CAS under this hash.
    const meta = await quarantine.getMetadata(q.quarantine_id);
    expect(meta!.status).toBe('quarantined');
  });

  it('rejects a missing attestation entirely (undefined predicate access)', async () => {
    const q = await putItem('missing-attestation');
    // Deliberately bypasses the type system to prove runtime fail-closed behavior even if a
    // caller ignores the type contract (e.g. dynamically-typed callers, deserialized JSON).
    await expect(
      promoter.promote(q.quarantine_id, undefined as unknown as ArtifactAttestation, 'v1'),
    ).rejects.toThrow();
  });

  it('[negative 1/4] a validly signed attestation for artifact A cannot promote artifact B', async () => {
    const a = await putItem('artifact-a');
    const b = await putItem('artifact-b');

    const predicateForA = await buildPredicate({
      quarantineId: a.quarantine_id,
      contentHash: a.hash,
      governanceRelease: 'v1',
    });
    const attestationForA = await sign(predicateForA);

    // Attempt to use it to promote B instead.
    await expect(promoter.promote(b.quarantine_id, attestationForA, 'v1')).rejects.toThrow(
      /bunden till en annan karantänsartefakt/i,
    );

    const metaB = await quarantine.getMetadata(b.quarantine_id);
    expect(metaB!.status).toBe('quarantined');
  });

  it('[negative 2/4] an attestation signed for a different action cannot be replayed as a promotion', async () => {
    const q = await putItem('wrong-action');
    const predicate = await buildPredicate({
      quarantineId: q.quarantine_id,
      contentHash: q.hash,
      governanceRelease: 'v1',
      action: 'quarantine.reject',
    });
    const attestation = await sign(predicate);

    await expect(promoter.promote(q.quarantine_id, attestation, 'v1')).rejects.toThrow(
      /action är inte 'quarantine\.promote'/i,
    );
  });

  it("[negative 3/4] a valid signature whose governance_release was changed after signing is rejected", async () => {
    const q = await putItem('release-tamper');
    const predicate = await buildPredicate({
      quarantineId: q.quarantine_id,
      contentHash: q.hash,
      governanceRelease: 'gov-release-A',
    });
    const attestation = await sign(predicate);

    // Signature itself is untouched and structurally valid — only the call-site argument
    // (what the caller now claims the release is) differs from what was signed.
    await expect(promoter.promote(q.quarantine_id, attestation, 'gov-release-B')).rejects.toThrow(
      /governance_release matchar inte anropets värde/i,
    );
  });

  it('[negative 4/4] an attestation whose signed content hash no longer matches the quarantine item is rejected', async () => {
    const q = await putItem('content-hash-tamper');
    const predicate = await buildPredicate({
      quarantineId: q.quarantine_id,
      contentHash: '0000000000000000000000000000000000000000000000000000000000000',
      governanceRelease: 'v1',
    });
    const attestation = await sign(predicate);

    await expect(promoter.promote(q.quarantine_id, attestation, 'v1')).rejects.toThrow(
      /quarantine_content_hash matchar inte/i,
    );
  });

  it('[bonus] an attestation validly signed by a different (non-governance) key is rejected', async () => {
    const q = await putItem('wrong-signer');
    // Signed by otherSigning — cryptographically valid, just not the promoter's configured key.
    const predicate = await buildPredicate({
      quarantineId: q.quarantine_id,
      contentHash: q.hash,
      governanceRelease: 'v1',
      signerKeyId: otherSigning.keyId,
    });
    const attestation = await sign(predicate, otherSigning);

    // Sanity: this attestation IS internally self-consistent (verifiable against otherSigning).
    await expect(verifyArtifactAttestation(attestation, otherSigning)).resolves.toBe(true);

    // But the promoter only trusts its own configured governance key.
    await expect(promoter.promote(q.quarantine_id, attestation, 'v1')).rejects.toThrow(
      /inte signerad med den förväntade governance-nyckeln|kryptografiska signatur är ogiltig/i,
    );
  });

  it('[bonus] an attestation missing approver identity in the signed predicate is rejected', async () => {
    const q = await putItem('missing-approver');
    const predicate = await buildPredicate({
      quarantineId: q.quarantine_id,
      contentHash: q.hash,
      governanceRelease: 'v1',
      approverActorId: '',
    });
    const attestation = await sign(predicate);

    await expect(promoter.promote(q.quarantine_id, attestation, 'v1')).rejects.toThrow(
      /approver_actor_id\/approver_role/i,
    );
  });

  it('[replay] identical inputs produce a deterministic signature, and reusing the same attestation after promotion is safely and consistently rejected', async () => {
    const q = await putItem('replay');
    const predicate = await buildPredicate({
      quarantineId: q.quarantine_id,
      contentHash: q.hash,
      governanceRelease: 'v1',
    });

    const attestationA = await sign(predicate);
    const attestationB = await sign(predicate); // Same predicate, signed again independently.

    // Ed25519 signing over canonicalized bytes is deterministic: same predicate + same key
    // => byte-identical signature. This is what makes "the same attestation" a coherent,
    // well-defined concept to replay in the first place (see GAP-REPORT "SPEC TIGHTENED").
    expect(attestationA.signature).toBe(attestationB.signature);
    await expect(verifyArtifactAttestation(attestationA, signing)).resolves.toBe(true);
    await expect(verifyArtifactAttestation(attestationA, signing)).resolves.toBe(true); // replaying verification is stable

    // First promotion with this attestation succeeds.
    const first = await promoter.promote(q.quarantine_id, attestationA, 'v1');
    expect(first.content_hash).toBe(`sha256:${q.hash}`);

    // Replaying the exact same (still cryptographically valid) attestation again does not
    // silently no-op, does not produce a second CAS write, and does not throw an
    // unpredictable/generic error — it deterministically hits the "already promoted" guard,
    // every time.
    await expect(promoter.promote(q.quarantine_id, attestationA, 'v1')).rejects.toThrow(/redan befordrats/i);
    await expect(promoter.promote(q.quarantine_id, attestationA, 'v1')).rejects.toThrow(/redan befordrats/i);

    // The independently-signed but predicate-identical attestationB is equally rejected —
    // the guard is on quarantine state, not on attestation object identity.
    await expect(promoter.promote(q.quarantine_id, attestationB, 'v1')).rejects.toThrow(/redan befordrats/i);
  });

  it('a correctly bound, validly signed attestation promotes exactly once and stores the attestation as governance evidence', async () => {
    const q = await putItem('happy-path');
    const predicate = await buildPredicate({
      quarantineId: q.quarantine_id,
      contentHash: q.hash,
      governanceRelease: 'gov-release-happy',
    });
    const attestation = await sign(predicate);

    const result = await promoter.promote(q.quarantine_id, attestation, 'gov-release-happy');
    expect(result.content_hash).toBe(`sha256:${q.hash}`);

    const casPayload = await cas.get<{ identity: any; metadata: any }>(result.approval_hash);
    expect(casPayload!.metadata.approved_by).toBe('admin-1');
    expect(casPayload!.metadata.approver_role).toBe('ADMIN');
    expect(casPayload!.metadata.attestation.signature).toBe(attestation.signature);
    expect(casPayload!.metadata.attestation.predicate.action).toBe(PROMOTION_ACTION);

    const meta = await quarantine.getMetadata(q.quarantine_id);
    expect(meta!.status).toBe('promoted');
  });
});
