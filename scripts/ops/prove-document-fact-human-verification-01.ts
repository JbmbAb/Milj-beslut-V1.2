/**
 * DOCUMENT-FACT-HUMAN-VERIFICATION-V1.
 *
 * Unit D of DOCUMENT-EVIDENCE-VERTICAL-SLICE-V1. Two modes, run as separate deliberate steps:
 *
 *   --review-only   Rebuilds the exact real candidate from DOCUMENT-FACT-CANDIDATE-V1
 *                    (commit ff9ce938), proves the RED negative proofs (self-verification
 *                    denied, tampered candidate denied, wrong-reviewer-key signature denied),
 *                    prints the full review material a human needs, and STOPS. Constructs NO
 *                    VerifiedDocumentFactArtifact.
 *
 *   --approve       Requires the real human decision to already have been given (outside this
 *                    script, in chat) as APPROVE_DECISION_TOKEN below, matching the exact
 *                    candidate_artifact_id shown by --review-only. Only then signs and
 *                    constructs the real VerifiedDocumentFactArtifact.
 *
 * There is no --reject mode that produces a canonical artifact: the frozen DocumentFactArtifact
 * model has exactly two states (CANDIDATE, VERIFIED) and deliberately no REJECTED artifact type
 * -- a rejection is recorded as a plain, non-canonical decision record, not a governed artifact.
 *
 * Usage:
 *   npx tsx scripts/ops/prove-document-fact-human-verification-01.ts --review-only
 *   npx tsx scripts/ops/prove-document-fact-human-verification-01.ts --approve
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  verifyRealDocumentFactCandidate,
  type DocumentFactReviewSigner,
} from '../../packages/mps-data-governance/src/verifyRealDocumentFactCandidate';
import { DOCUMENT_FACT_VERIFICATION_POLICY_V1 } from '../../packages/mps-data-governance/src/DocumentFactArtifact';
import type { ContentReference } from '../../packages/mps-core/src/types';

const SECRETS_DIR = 'C:/Users/jimmy/.mimers/secrets';
const EXTRACTOR_KEY_ID = 'ed25519:document-fact-extractor-v1';
const REVIEWER_KEY_ID = 'ed25519:document-fact-reviewer-v1';
const QUARANTINE_ID = '00019927-5933-499c-9be1-98991ad31f2f';
const TARGET_SPAN_TEXT =
  'MARK- OCH MILJÖÖVERDOMSTOLENS DOMSLUT 1. Mark- och miljööverdomstolen fastställer mark- och miljödomstolens dom.';

/** Set only after Jimmy has given an explicit real APPROVE decision in chat, matching this exact artifact_id. */
const APPROVE_DECISION_TOKEN: { readonly candidate_artifact_id: string } | null = null;
const REVIEWER_HUMAN_NAME = 'bjb@miljöbeslut.se';

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
  console.log(`Generated new key '${keyId}' -> ${dir}`);
  return { keyId, privatePem: privateKey, publicPem: publicKey };
}

async function rebuildRealCandidate() {
  const quarantineRoot = process.env.QUARANTINE_ROOT || path.resolve('.quarantine');
  const mimersRoot = process.env.MIMERS_ROOT || path.resolve('.data/mimers');
  const durabilityMode = (process.env.MIMERS_DURABILITY_MODE || 'best-effort') as 'strict' | 'best-effort' | 'none';

  const cas = new FileCASRepository(path.join(mimersRoot, 'cas'), { durabilityMode });
  await cas.initialize();
  const quarantine = new DiskQuarantineStorage(quarantineRoot);
  const meta = await quarantine.getMetadata(QUARANTINE_ID);
  if (!meta) throw new Error(`quarantine metadata not found for ${QUARANTINE_ID}`);
  if (meta.status !== 'promoted') throw new Error(`REJECT: quarantine item is not promoted (status=${meta.status})`);

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

  const startOffset = projection.text.indexOf(TARGET_SPAN_TEXT);
  if (startOffset < 0) throw new Error('REJECT: target span text not found in real projected text.');
  const endOffset = startOffset + TARGET_SPAN_TEXT.length;

  const documentRef: ContentReference = { id: QUARANTINE_ID, content_hash: { algorithm: 'sha256', digest: meta.content_hash } };
  const projectionRef: ContentReference = { id: projection.projection_id, content_hash: { algorithm: 'sha256', digest: projection.content_hash.value } };
  const extractorIdentityId = 'document-fact-deterministic-span-extractor/v1';
  const { createHash } = await import('node:crypto');
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

  const candidate = await createDocumentFactCandidate(
    {
      fact_type: 'PRIOR_LOCATION_RESTRICTING_DECISION',
      fact_version: '1.0',
      source_document_ref: documentRef,
      inventory_ref: documentRef,
      source_span: { text_projection_ref: projectionRef, start_offset: startOffset, end_offset: endOffset },
      asserted_by: { identity_ref: extractorIdentityRef, role: 'SYSTEM_PROCESS' },
      assertion_method: 'DETERMINISTIC_EXTRACTION',
      asserter_version: extractorIdentityId,
      asserted_at: '2026-08-24T14:30:00.000Z',
    },
    extractorSigner,
  );

  return { candidate, extractorKey, extractorIdentityRef, meta, projection, startOffset, endOffset };
}

async function reviewOnly() {
  console.log('########## PROVE-DOCUMENT-FACT-HUMAN-VERIFICATION-01 (--review-only) ##########\n');

  console.log('=== STEP 1: rebuild the exact real candidate from Unit C (commit ff9ce938) ===\n');
  const { candidate, extractorKey, meta, projection, startOffset, endOffset } = await rebuildRealCandidate();
  console.log(`  candidate_artifact_id: ${candidate.artifact_id}`);
  const identityMatchesCommit = candidate.artifact_id === 'fact-candidate-776ae304bf01df5bca446f5e';
  console.log(`  matches ff9ce938's candidate_artifact_id exactly: ${identityMatchesCommit}\n`);
  if (!identityMatchesCommit) throw new Error('REJECT: rebuilt candidate does not match the committed identity -- refusing to proceed.');

  console.log('=== STEP 2: candidate content_hash integrity ===\n');
  const integrityValid = isDocumentFactCandidateContentHashValid(candidate);
  console.log(`  content_hash matches candidate's own carried fields: ${integrityValid}\n`);

  console.log('=== STEP 3: real reviewer identity, distinct from the extractor ===\n');
  const reviewerKey = loadOrGenerateKey('document-fact-reviewer-signing-key-v1', REVIEWER_KEY_ID);
  const keysDistinct = extractorKey.keyId !== reviewerKey.keyId && extractorKey.publicPem !== reviewerKey.publicPem;
  console.log(`  extractor key_id: ${extractorKey.keyId}`);
  console.log(`  reviewer key_id: ${reviewerKey.keyId}`);
  console.log(`  extractor key !== reviewer key: ${keysDistinct}\n`);

  const reviewerSigningProvider = new LocalPemSigningKeyProvider(reviewerKey.keyId, reviewerKey.privatePem, reviewerKey.publicPem);
  const reviewerSigner: DocumentFactReviewSigner = {
    keyId: reviewerKey.keyId,
    async sign(payload) {
      const envelope = await reviewerSigningProvider.sign(payload);
      return { signatureBase64: envelope.signature.replace(/^ed25519:/, '') };
    },
  };

  console.log('=== STEP 4 (RED-1): extractor identity attempts to verify its own candidate (even claiming a governance role) -> must DENY ===\n');
  let redSelfVerifyDenied = false;
  try {
    await verifyRealDocumentFactCandidate(
      {
        candidate,
        // Same identity_ref.id that asserted the candidate -- but now claiming GOVERNANCE_REVIEWER,
        // to isolate the "asserter == verifier" check from the separate "role must be
        // governance/human" check (a plain SYSTEM_PROCESS role trips the latter first and would
        // prove the wrong thing).
        verified_by: { identity_ref: candidate.assertion.asserted_by.identity_ref, role: 'GOVERNANCE_REVIEWER' },
        verification_method: 'HUMAN_REVIEW',
        policy: DOCUMENT_FACT_VERIFICATION_POLICY_V1,
        verified_at: new Date().toISOString(),
      },
      reviewerSigner,
    );
  } catch (err) {
    redSelfVerifyDenied = err instanceof Error && /may not verify its own fact/i.test(err.message);
    console.log(`  denied with: ${err instanceof Error ? err.message : String(err)}`);
  }
  console.log(`  RED-1 self-verification denied: ${redSelfVerifyDenied}\n`);

  console.log('=== STEP 5 (RED-3/4): a tampered candidate (mutated span) -> must DENY ===\n');
  let redTamperDenied = false;
  const tampered = { ...candidate, source_span: { ...candidate.source_span, start_offset: 0, end_offset: 48 } };
  try {
    await verifyRealDocumentFactCandidate(
      {
        candidate: tampered,
        verified_by: { identity_ref: candidate.assertion.asserted_by.identity_ref, role: 'GOVERNANCE_REVIEWER' },
        verification_method: 'HUMAN_REVIEW',
        policy: DOCUMENT_FACT_VERIFICATION_POLICY_V1,
        verified_at: new Date().toISOString(),
      },
      reviewerSigner,
    );
  } catch (err) {
    redTamperDenied = err instanceof Error && /candidate content_hash does not match/i.test(err.message);
    console.log(`  denied with: ${err instanceof Error ? err.message : String(err)}`);
  }
  console.log(`  RED-3/4 tamper denied: ${redTamperDenied}\n`);

  console.log('=== STEP 6 (RED-2): a signature claiming the reviewer key_id but signed by a DIFFERENT key -> independent verification must DENY ===\n');
  const impostorKeyPair = LocalPemSigningKeyProvider.generate('ed25519:impostor');
  const fakeSignedEnvelope = await impostorKeyPair.provider.sign(Buffer.from('c'.repeat(64), 'hex'));
  const realReviewerVerifier = new LocalPemVerificationKeyProvider(reviewerKey.keyId, reviewerKey.publicPem);
  const wrongKeyAccepted = await realReviewerVerifier.verify(Buffer.from('c'.repeat(64), 'hex'), {
    algorithm: 'Ed25519',
    digestAlgorithm: 'sha256',
    canonicalization: 'RFC8785',
    keyId: reviewerKey.keyId,
    signature: fakeSignedEnvelope.signature,
    timestamp: 0,
  });
  console.log(`  signature from a different (impostor) key verifies against the real reviewer public key: ${wrongKeyAccepted}`);
  console.log(`  RED-2 wrong-reviewer-key denied: ${!wrongKeyAccepted}\n`);

  console.log('════════════════════════════════════════════════════════════════');
  console.log(' REAL REVIEW MATERIAL -- human decision required before Unit D can proceed');
  console.log('════════════════════════════════════════════════════════════════\n');
  console.log(`  candidate_artifact_id : ${candidate.artifact_id}`);
  console.log(`  candidate content_hash: ${candidate.content_hash.digest}`);
  console.log(`  fact_type             : ${candidate.fact_type}`);
  console.log(`  verification_status   : ${candidate.verification_status} (not yet a legal fact)\n`);
  console.log('  --- Source document ---');
  console.log(`  file_name  : ${meta.file_name}`);
  console.log(`  source     : ${meta.source_id} (Domstolsverket PUH -- registered, APPROVED national source)`);
  console.log(`  source_url : ${meta.source_url}`);
  console.log(`  quarantine_id (source_document_ref): ${QUARANTINE_ID}`);
  console.log(`  document sha256 content_hash: ${meta.content_hash}\n`);
  console.log('  --- Assertion ---');
  console.log(`  asserted_by.role   : ${candidate.assertion.asserted_by.role}`);
  console.log(`  assertion_method   : ${candidate.assertion.assertion_method}`);
  console.log(`  asserter_version   : ${candidate.assertion.asserter_version}`);
  console.log('  (a literal, reproducible substring search against the real deterministic text');
  console.log('   projection -- no ML classifier, no LLM wording, no hand-typed offsets)\n');
  console.log('  --- Exact source span (text_projection offsets) ---');
  console.log(`  text_projection_ref: ${candidate.source_span.text_projection_ref.id}`);
  console.log(`  start_offset: ${startOffset}, end_offset: ${endOffset}`);
  console.log(`  EXACT SPAN TEXT:`);
  console.log(`    "${projection.text.slice(startOffset, endOffset)}"\n`);
  console.log('  --- Surrounding context (200 chars before/after, for human comparison) ---');
  console.log(`  BEFORE: ...${projection.text.slice(Math.max(0, startOffset - 200), startOffset)}`);
  console.log(`  AFTER : ${projection.text.slice(endOffset, endOffset + 200)}...\n`);
  console.log('  --- What the fact means ---');
  console.log('  PRIOR_LOCATION_RESTRICTING_DECISION claims: this document is a real, prior legal');
  console.log('  decision that restricts land use at a specific location. The exact span above is');
  console.log('  the DOMSLUT of Mark- och miljööverdomstolen (M 5246-25): the court affirms the');
  console.log('  lower court, which affirmed Skogsstyrelsens avverkningsförbud (12 kap. 6 §');
  console.log('  miljöbalken) on a property in Bollnäs kommun.\n');
  console.log('  APPROVE means: the exact span text above genuinely supports');
  console.log('  PRIOR_LOCATION_RESTRICTING_DECISION for this document, as written, with no');
  console.log('  paraphrase or inference beyond what the quoted text states.\n');
  console.log('  REJECT means: the span does not support the claimed fact_type, is miscut, or the');
  console.log('  candidate is otherwise wrong -- the vertical slice stops here and is NOT forced');
  console.log('  through; no VerifiedDocumentFactArtifact is constructed.\n');

  const ok = identityMatchesCommit && integrityValid && keysDistinct && redSelfVerifyDenied && redTamperDenied && !wrongKeyAccepted;
  console.log(`ALL RED PROOFS + PRE-REVIEW CHECKS GREEN: ${ok}`);
  console.log('\nSTOPPING. No VerifiedDocumentFactArtifact has been constructed. Awaiting real human decision.');
  process.exitCode = ok ? 0 : 1;
}

/**
 * The real reviewer's decision on candidate `fact-candidate-776ae304bf01df5bca446f5e`, given in
 * chat 2026-08-24. Not a canonical governed artifact: the frozen DocumentFactArtifact model
 * (OWNER FREEZE 2026-08-12) has exactly two states, CANDIDATE and VERIFIED, and deliberately no
 * REJECTED artifact type -- inventing one here would extend a frozen contract without an owner
 * decision. This is a plain, honestly-labeled decision record instead.
 */
const REAL_REJECTION_DECISION = {
  decision: 'REJECTED' as const,
  reviewer: REVIEWER_HUMAN_NAME,
  reviewer_role: 'GOVERNANCE_REVIEWER' as const,
  reason:
    "Span doesn't establish restriction: the quoted DOMSLUT text affirms the lower court's " +
    'judgment but does not itself state what the restriction was -- the logging prohibition ' +
    '(avverkningsförbud, 12 kap. 6 § miljöbalken) is stated earlier in the document, in the ' +
    "BAKGRUND section describing Skogsstyrelsens beslut, not in the DOMSLUT paragraph the " +
    'candidate\'s deterministic extraction step picked. The span alone does not support the ' +
    'claimed fact_type.',
  reviewed_at: '2026-08-24T15:00:00.000Z',
};

async function recordRejection() {
  console.log('########## PROVE-DOCUMENT-FACT-HUMAN-VERIFICATION-01 (--record-rejection) ##########\n');
  const { candidate } = await rebuildRealCandidate();

  const record = {
    ...REAL_REJECTION_DECISION,
    candidate_artifact_id: candidate.artifact_id,
    candidate_content_hash: candidate.content_hash.digest,
    fact_type: candidate.fact_type,
    source_span: candidate.source_span,
  };

  console.log('=== REAL REJECTION RECORD (not a canonical artifact -- see file header) ===\n');
  console.log(JSON.stringify(record, null, 2));
  console.log('\nNo VerifiedDocumentFactArtifact was constructed. The vertical slice stops here for');
  console.log('this candidate, honestly, per Jimmy\'s real review decision -- not forced through.');
}

async function approve() {
  console.log('########## PROVE-DOCUMENT-FACT-HUMAN-VERIFICATION-01 (--approve) ##########\n');
  const { candidate } = await rebuildRealCandidate();

  if (!APPROVE_DECISION_TOKEN || APPROVE_DECISION_TOKEN.candidate_artifact_id !== candidate.artifact_id) {
    throw new Error(
      'REJECT: no real, explicit human APPROVE decision recorded for this exact candidate_artifact_id. ' +
        'Refusing to construct a VerifiedDocumentFactArtifact. Set APPROVE_DECISION_TOKEN only after ' +
        'Jimmy has given an explicit approval in chat for this exact candidate.',
    );
  }

  const reviewerKey = loadOrGenerateKey('document-fact-reviewer-signing-key-v1', REVIEWER_KEY_ID);
  const reviewerSigningProvider = new LocalPemSigningKeyProvider(reviewerKey.keyId, reviewerKey.privatePem, reviewerKey.publicPem);
  const reviewerSigner: DocumentFactReviewSigner = {
    keyId: reviewerKey.keyId,
    async sign(payload) {
      const envelope = await reviewerSigningProvider.sign(payload);
      return { signatureBase64: envelope.signature.replace(/^ed25519:/, '') };
    },
  };

  const { createHash } = await import('node:crypto');
  const reviewerIdentityRef: ContentReference = {
    id: REVIEWER_HUMAN_NAME,
    content_hash: { algorithm: 'sha256', digest: createHash('sha256').update(REVIEWER_HUMAN_NAME, 'utf8').digest('hex') },
  };

  const verified = await verifyRealDocumentFactCandidate(
    {
      candidate,
      verified_by: { identity_ref: reviewerIdentityRef, role: 'GOVERNANCE_REVIEWER' },
      verification_method: 'HUMAN_REVIEW',
      policy: DOCUMENT_FACT_VERIFICATION_POLICY_V1,
      verified_at: new Date().toISOString(),
    },
    reviewerSigner,
  );

  console.log('=== REAL VerifiedDocumentFactArtifact ===\n');
  console.log(JSON.stringify(verified, null, 2));

  const verifier = new LocalPemVerificationKeyProvider(reviewerKey.keyId, reviewerKey.publicPem);
  const signatureValid = await verifier.verify(Buffer.from(verified.content_hash.digest, 'hex'), {
    algorithm: 'Ed25519',
    digestAlgorithm: 'sha256',
    canonicalization: 'RFC8785',
    keyId: verified.signature.key_id ?? '',
    signature: verified.signature.signature,
    timestamp: 0,
  });
  console.log(`\nsignature independently verifies against the real reviewer public key: ${signatureValid}`);
  console.log(`\nALL GREEN: ${signatureValid}`);
  process.exitCode = signatureValid ? 0 : 1;
}

async function main() {
  if (process.argv.includes('--review-only')) return reviewOnly();
  if (process.argv.includes('--record-rejection')) return recordRejection();
  if (process.argv.includes('--approve')) return approve();
  throw new Error('Specify exactly one of --review-only, --record-rejection, or --approve.');
}

main().catch((error) => {
  console.error('FATAL:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
