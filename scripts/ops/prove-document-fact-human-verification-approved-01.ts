/**
 * DOCUMENT-FACT-HUMAN-VERIFICATION-APPROVED-V1.
 *
 * Constructs exactly ONE real VerifiedDocumentFactArtifact for the corrected, human-APPROVED
 * candidate (fact-candidate-219b881f9647de06419af0df, DOCUMENT-FACT-CANDIDATE-REISSUE-V1, commit
 * 99e23003), using the real, already-given human decision (APPROVE, reviewer bjb@miljöbeslut.se,
 * see docs/architecture/DOCUMENT-FACT-CANDIDATE-REISSUE-V1-DECISION-2026-08-24.md). No new human
 * gate is required here: that decision was already real and already given for this exact
 * candidate_artifact_id -- this script records it through the frozen governance gate, it does
 * not solicit or fabricate a new one.
 *
 * Also rebuilds (read-only) the historically REJECTED candidate
 * (fact-candidate-776ae304bf01df5bca446f5e) solely to prove that this unit's approval does not,
 * and structurally cannot, transfer to it -- verifying the corrected candidate never touches,
 * mutates, or implicitly promotes the rejected one.
 *
 * Does NOT construct DocumentEvidence, persist anything to CAS, or wire into LU -- that remains
 * Unit E and later, not started here.
 *
 * Usage:
 *   npx tsx scripts/ops/prove-document-fact-human-verification-approved-01.ts --execute
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  FileCASRepository,
  DiskQuarantineStorage,
  LocalPemSigningKeyProvider,
  LocalPemVerificationKeyProvider,
} from '@miljobeslut/mimers-brunn-core';
import { ingestDocumentToTextProjection } from '../../server/text-projection/createGovernedTextIngestion';
import {
  createDocumentFactCandidate,
  isDocumentFactCandidateContentHashValid,
  type DocumentFactCandidateSigner,
} from '../../packages/mps-data-governance/src/createDocumentFactCandidate';
import {
  computeVerifiedDocumentFactIdentity,
  isVerifiedDocumentFactContentHashValid,
  verifyRealDocumentFactCandidate,
  type DocumentFactReviewInput,
  type DocumentFactReviewSigner,
} from '../../packages/mps-data-governance/src/verifyRealDocumentFactCandidate';
import { DOCUMENT_FACT_VERIFICATION_POLICY_V1, type VerifiedDocumentFactArtifact } from '../../packages/mps-data-governance/src/DocumentFactArtifact';
import type { ContentReference } from '../../packages/mps-core/src/types';

const SECRETS_DIR = 'C:/Users/jimmy/.mimers/secrets';
const EXTRACTOR_KEY_ID = 'ed25519:document-fact-extractor-v1';
const REVIEWER_KEY_ID = 'ed25519:document-fact-reviewer-v1';
const QUARANTINE_ID = '00019927-5933-499c-9be1-98991ad31f2f';
const REVIEWER_HUMAN_NAME = 'bjb@miljöbeslut.se';

const REJECTED_SPAN_TEXT =
  'MARK- OCH MILJÖÖVERDOMSTOLENS DOMSLUT 1. Mark- och miljööverdomstolen fastställer mark- och miljödomstolens dom.';
const REJECTED_CANDIDATE_ID = 'fact-candidate-776ae304bf01df5bca446f5e';

const APPROVED_SPAN_TEXT =
  'äger skogsbruksfastigheten i Bollnäs kommun. Fastigheten omfattar 92 ha. Kärandena anmälde i ' +
  'januari 2018 en planerad föryngringsavverkning av ett område om 2,7 ha inom fastigheten. ' +
  'Skogsstyrelsen har i ett beslut den 29 juni 2018 vid vite förbjudit all form av avverkning ' +
  'inom det anmälda området.';
const APPROVED_CANDIDATE_ID = 'fact-candidate-219b881f9647de06419af0df';

function loadOrGenerateKey(name: string, keyId: string) {
  const dir = `${SECRETS_DIR}/${name}`;
  const privatePath = `${dir}/private.pem`;
  const publicPath = `${dir}/public.pem`;
  if (existsSync(privatePath) && existsSync(publicPath)) {
    return { keyId, privatePem: readFileSync(privatePath, 'utf8'), publicPem: readFileSync(publicPath, 'utf8') };
  }
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const { publicKey, privateKey } = LocalPemSigningKeyProvider.generate(keyId);
  writeFileSync(privatePath, privateKey, { mode: 0o600 });
  writeFileSync(publicPath, publicKey);
  return { keyId, privatePem: privateKey, publicPem: publicKey };
}

async function main() {
  console.log('########## PROVE-DOCUMENT-FACT-HUMAN-VERIFICATION-APPROVED-01 ##########\n');
  if (!process.argv.includes('--execute')) throw new Error('Refusing to run without --execute.');

  const quarantineRoot = process.env.QUARANTINE_ROOT || path.resolve('.quarantine');
  const mimersRoot = process.env.MIMERS_ROOT || path.resolve('.data/mimers');
  const durabilityMode = (process.env.MIMERS_DURABILITY_MODE || 'best-effort') as 'strict' | 'best-effort' | 'none';

  console.log('=== STEP 1: same real governed source + deterministic text projection ===\n');
  const cas = new FileCASRepository(path.join(mimersRoot, 'cas'), { durabilityMode });
  await cas.initialize();
  const quarantine = new DiskQuarantineStorage(quarantineRoot);
  const meta = await quarantine.getMetadata(QUARANTINE_ID);
  if (!meta) throw new Error('quarantine metadata not found');
  if (meta.status !== 'promoted') throw new Error(`REJECT: not promoted (status=${meta.status})`);
  const bytes = await cas.getBytes(`sha256:${meta.content_hash}`, { verifyHash: true });
  if (!bytes) throw new Error('CAS retrieval failed');
  const source = {
    ref: { artifact_id: QUARANTINE_ID, artifact_type: 'RAW_SOURCE' },
    bytes_content_hash: { algorithm: 'sha256' as const, value: meta.content_hash },
    doc_name: meta.file_name,
    source_system: meta.source_id,
    mime_type: 'application/pdf',
  };
  const { projection } = await ingestDocumentToTextProjection({ source, bytes });

  const documentRef: ContentReference = { id: QUARANTINE_ID, content_hash: { algorithm: 'sha256', digest: meta.content_hash } };
  const projectionRef: ContentReference = { id: projection.projection_id, content_hash: { algorithm: 'sha256', digest: projection.content_hash.value } };
  const extractorIdentityId = 'document-fact-deterministic-span-extractor/v1';
  const extractorIdentityRef: ContentReference = {
    id: extractorIdentityId,
    content_hash: { algorithm: 'sha256', digest: createHash('sha256').update(extractorIdentityId, 'utf8').digest('hex') },
  };
  const extractorKey = loadOrGenerateKey('document-fact-extractor-signing-key-v1', EXTRACTOR_KEY_ID);
  const extractorSigningProvider = new LocalPemSigningKeyProvider(extractorKey.keyId, extractorKey.privatePem, extractorKey.publicPem);
  const extractorSigner: DocumentFactCandidateSigner = {
    keyId: extractorKey.keyId,
    async sign(payload) {
      const envelope = await extractorSigningProvider.sign(payload);
      return { signatureBase64: envelope.signature.replace(/^ed25519:/, '') };
    },
  };

  const buildInput = (text: string, assertedAt: string) => {
    const start = projection.text.indexOf(text);
    if (start < 0) throw new Error('REJECT: span text not found in real projection.');
    const end = start + text.length;
    return {
      input: {
        fact_type: 'PRIOR_LOCATION_RESTRICTING_DECISION' as const,
        fact_version: '1.0',
        source_document_ref: documentRef,
        inventory_ref: documentRef,
        source_span: { text_projection_ref: projectionRef, start_offset: start, end_offset: end },
        asserted_by: { identity_ref: extractorIdentityRef, role: 'SYSTEM_PROCESS' as const },
        assertion_method: 'DETERMINISTIC_EXTRACTION' as const,
        asserter_version: extractorIdentityId,
        asserted_at: assertedAt,
      },
      start,
      end,
    };
  };

  console.log('=== STEP 2: rebuild both candidates (approved + rejected), read-only ===\n');
  const approvedBuild = buildInput(APPROVED_SPAN_TEXT, '2026-08-24T14:45:00.000Z');
  const approvedCandidate = await createDocumentFactCandidate(approvedBuild.input, extractorSigner);
  const rejectedBuild = buildInput(REJECTED_SPAN_TEXT, '2026-08-24T14:30:00.000Z');
  const rejectedCandidate = await createDocumentFactCandidate(rejectedBuild.input, extractorSigner);

  const approvedMatches = approvedCandidate.artifact_id === APPROVED_CANDIDATE_ID;
  const rejectedMatches = rejectedCandidate.artifact_id === REJECTED_CANDIDATE_ID;
  console.log(`  approved candidate matches commit 99e23003 exactly: ${approvedMatches} (${approvedCandidate.artifact_id})`);
  console.log(`  rejected candidate matches commit ff9ce938 exactly: ${rejectedMatches} (${rejectedCandidate.artifact_id})\n`);
  if (!approvedMatches || !rejectedMatches) throw new Error('REJECT: rebuilt candidate identity mismatch -- refusing to proceed.');
  console.log(`  candidate content_hash integrity (approved): ${isDocumentFactCandidateContentHashValid(approvedCandidate)}`);
  console.log(`  candidate content_hash integrity (rejected): ${isDocumentFactCandidateContentHashValid(rejectedCandidate)}\n`);

  console.log('=== STEP 3: reviewer identity, distinct from extractor ===\n');
  const reviewerKey = loadOrGenerateKey('document-fact-reviewer-signing-key-v1', REVIEWER_KEY_ID);
  const keysDistinct = extractorKey.keyId !== reviewerKey.keyId && extractorKey.publicPem !== reviewerKey.publicPem;
  console.log(`  extractor key_id: ${extractorKey.keyId}`);
  console.log(`  reviewer key_id: ${reviewerKey.keyId}`);
  console.log(`  distinct: ${keysDistinct}\n`);
  const reviewerSigningProvider = new LocalPemSigningKeyProvider(reviewerKey.keyId, reviewerKey.privatePem, reviewerKey.publicPem);
  const reviewerSigner: DocumentFactReviewSigner = {
    keyId: reviewerKey.keyId,
    async sign(payload) {
      const envelope = await reviewerSigningProvider.sign(payload);
      return { signatureBase64: envelope.signature.replace(/^ed25519:/, '') };
    },
  };
  const reviewerIdentityRef: ContentReference = {
    id: REVIEWER_HUMAN_NAME,
    content_hash: { algorithm: 'sha256', digest: createHash('sha256').update(REVIEWER_HUMAN_NAME, 'utf8').digest('hex') },
  };

  const baseReview = (candidate: typeof approvedCandidate, verifiedAt: string): DocumentFactReviewInput => ({
    candidate,
    verified_by: { identity_ref: reviewerIdentityRef, role: 'GOVERNANCE_REVIEWER' },
    verification_method: 'HUMAN_REVIEW',
    policy: DOCUMENT_FACT_VERIFICATION_POLICY_V1,
    verified_at: verifiedAt,
  });

  console.log('=== NEGATIVE PROOF 2: extractor attempts verification -> DENY ===\n');
  let extractorVerifyDenied = false;
  try {
    await verifyRealDocumentFactCandidate(
      { ...baseReview(approvedCandidate, new Date().toISOString()), verified_by: { identity_ref: extractorIdentityRef, role: 'GOVERNANCE_REVIEWER' } },
      reviewerSigner,
    );
  } catch (err) {
    extractorVerifyDenied = err instanceof Error && /may not verify its own fact/i.test(err.message);
    console.log(`  denied with: ${err instanceof Error ? err.message : String(err)}`);
  }
  console.log(`  DENY: ${extractorVerifyDenied}\n`);

  console.log('=== NEGATIVE PROOF 3: wrong reviewer key (signature claims reviewer key_id, signed by impostor key) -> independent verification DENY ===\n');
  const impostor = LocalPemSigningKeyProvider.generate('ed25519:impostor');
  const fakeEnvelope = await impostor.provider.sign(Buffer.from('c'.repeat(64), 'hex'));
  const realReviewerVerifier = new LocalPemVerificationKeyProvider(reviewerKey.keyId, reviewerKey.publicPem);
  const wrongKeyAccepted = await realReviewerVerifier.verify(Buffer.from('c'.repeat(64), 'hex'), {
    algorithm: 'Ed25519', digestAlgorithm: 'sha256', canonicalization: 'RFC8785',
    keyId: reviewerKey.keyId, signature: fakeEnvelope.signature, timestamp: 0,
  });
  console.log(`  DENY: ${!wrongKeyAccepted}\n`);

  console.log('=== NEGATIVE PROOF 4: tampered candidate content_hash -> DENY ===\n');
  let tamperDenied = false;
  const tamperedCandidate = { ...approvedCandidate, content_hash: { algorithm: 'sha256' as const, digest: '0'.repeat(64) } };
  try {
    await verifyRealDocumentFactCandidate(baseReview(tamperedCandidate, new Date().toISOString()), reviewerSigner);
  } catch (err) {
    tamperDenied = err instanceof Error && /candidate content_hash does not match/i.test(err.message);
    console.log(`  denied with: ${err instanceof Error ? err.message : String(err)}`);
  }
  console.log(`  DENY: ${tamperDenied}\n`);

  console.log('=== NEGATIVE PROOF 5: altered source span / different candidate -> DENY (structurally, a different candidate_ref) ===\n');
  const alteredSpanCandidate = { ...approvedCandidate, source_span: { ...approvedCandidate.source_span, end_offset: approvedCandidate.source_span.end_offset - 1 } };
  let alteredSpanDenied = false;
  try {
    await verifyRealDocumentFactCandidate(baseReview(alteredSpanCandidate, new Date().toISOString()), reviewerSigner);
  } catch (err) {
    alteredSpanDenied = err instanceof Error && /candidate content_hash does not match/i.test(err.message);
    console.log(`  denied with: ${err instanceof Error ? err.message : String(err)}`);
  }
  console.log(`  DENY: ${alteredSpanDenied}\n`);

  console.log('=== NEGATIVE PROOF 6: the rejected candidate must NOT inherit this approval ===\n');
  console.log(`  rejected candidate_artifact_id: ${rejectedCandidate.artifact_id}`);
  console.log(`  approved candidate_artifact_id: ${approvedCandidate.artifact_id}`);
  console.log(`  no verifyRealDocumentFactCandidate call is made on the rejected candidate in this script.`);
  console.log(`  identities differ: ${rejectedCandidate.artifact_id !== approvedCandidate.artifact_id}\n`);

  console.log('=== POSITIVE PROOF 1: approved candidate + correct reviewer key + real APPROVE -> VERIFIED ===\n');
  const verified = await verifyRealDocumentFactCandidate(baseReview(approvedCandidate, new Date().toISOString()), reviewerSigner);
  console.log(`  verified.artifact_id: ${verified.artifact_id}`);
  console.log(`  verified.candidate_ref.id: ${verified.candidate_ref.id}`);
  console.log(`  verified.verification.verified_by.identity_ref.id: ${verified.verification.verified_by.identity_ref.id}`);
  console.log(`  verified.verification.verification_method: ${verified.verification.verification_method}\n`);

  console.log('=== NEGATIVE PROOF 6b: candidate_ref binds ONLY the approved candidate, not the rejected one ===\n');
  const candidateRefBindsCorrectly = verified.candidate_ref.id === approvedCandidate.artifact_id && verified.candidate_ref.id !== rejectedCandidate.artifact_id;
  console.log(`  binds correctly: ${candidateRefBindsCorrectly}\n`);

  console.log('=== NEGATIVE PROOF 7: VERIFIED body altered after signing -> independent self-consistency verification fails ===\n');
  const tamperedVerifiedBody: VerifiedDocumentFactArtifact = { ...verified, fact_version: '9.9' };
  const tamperedBodyDenied = !isVerifiedDocumentFactContentHashValid(tamperedVerifiedBody);
  console.log(`  DENY: ${tamperedBodyDenied}\n`);

  console.log('=== NEGATIVE PROOF 8: reviewer identity/ref changed after signing -> independent self-consistency verification fails ===\n');
  const tamperedVerifiedReviewer: VerifiedDocumentFactArtifact = {
    ...verified,
    verification: { ...verified.verification, verified_by: { identity_ref: { id: 'someone-else', content_hash: { algorithm: 'sha256', digest: '1'.repeat(64) } }, role: 'GOVERNANCE_REVIEWER' } },
  };
  const tamperedReviewerDenied = !isVerifiedDocumentFactContentHashValid(tamperedVerifiedReviewer);
  console.log(`  DENY: ${tamperedReviewerDenied}\n`);

  console.log('=== SELF-CONSISTENCY: independently recompute the VERIFIED artifact\'s content_hash from its own body alone ===\n');
  const selfConsistent = isVerifiedDocumentFactContentHashValid(verified);
  console.log(`  self-consistent: ${selfConsistent}\n`);

  console.log('=== RED-9: same candidate + same review semantics, different verified_at -> same verified identity (determinism) ===\n');
  const verifiedRerun = await verifyRealDocumentFactCandidate(baseReview(approvedCandidate, '2030-01-01T00:00:00.000Z'), reviewerSigner);
  const deterministic = verified.artifact_id === verifiedRerun.artifact_id && verified.artifact_id === computeVerifiedDocumentFactIdentity(baseReview(approvedCandidate, verified.verification.verified_at));
  console.log(`  deterministic: ${deterministic}\n`);

  console.log('=== SIGNATURE VERIFICATION: independently verify the real signature against the persisted reviewer public key ===\n');
  const verifier = new LocalPemVerificationKeyProvider(reviewerKey.keyId, reviewerKey.publicPem);
  const signatureValid = await verifier.verify(Buffer.from(verified.content_hash.digest, 'hex'), {
    algorithm: 'Ed25519', digestAlgorithm: 'sha256', canonicalization: 'RFC8785',
    keyId: verified.signature.key_id ?? '', signature: verified.signature.signature, timestamp: 0,
  });
  console.log(`  signature verifies: ${signatureValid}\n`);

  console.log('════════════════════════════════════════════════════════════════');
  console.log(' REAL VerifiedDocumentFactArtifact');
  console.log('════════════════════════════════════════════════════════════════\n');
  console.log(JSON.stringify(verified, null, 2));

  const ok =
    approvedMatches && rejectedMatches &&
    keysDistinct &&
    extractorVerifyDenied &&
    !wrongKeyAccepted &&
    tamperDenied &&
    alteredSpanDenied &&
    candidateRefBindsCorrectly &&
    tamperedBodyDenied &&
    tamperedReviewerDenied &&
    selfConsistent &&
    deterministic &&
    signatureValid;

  console.log(`\nALL GREEN: ${ok}`);
  process.exitCode = ok ? 0 : 1;
}

main().catch((error) => {
  console.error('FATAL:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
