/**
 * DOCUMENT-FACT-CANDIDATE-V1.
 *
 * Unit C of DOCUMENT-EVIDENCE-VERTICAL-SLICE-V1. Builds exactly ONE real
 * `DocumentFactCandidateArtifact` from the already-promoted real MMOD court decision and its
 * proven deterministic text projection (DOCUMENT-SOURCE-TO-TEXT-PROJECTION-V1, commit 97e7173f):
 *
 *   real MMOD CAS source -> deterministic text projection -> exact source span
 *     -> DocumentFactCandidateArtifact
 *
 * The real span (offsets 646-758 in the real projected text) is the case's own DOMSLUT:
 *   "MARK- OCH MILJÖÖVERDOMSTOLENS DOMSLUT 1. Mark- och miljööverdomstolen fastställer
 *    mark- och miljödomstolens dom."
 * -- Mark- och miljööverdomstolen (the Land and Environment Court of Appeal) affirms the lower
 * court's judgment, which itself affirmed Skogsstyrelsen's avverkningsförbud (logging
 * prohibition, 12 kap. 6 § miljöbalken) on a specific property in Bollnäs kommun. That is a real
 * prior, location-restricting decision -- the one fact type PRIOR_LOCATION_RESTRICTING_DECISION
 * admits (DocumentFactArtifact.ts's vocabulary is closed to exactly this one type).
 *
 * `assertion_method: "DETERMINISTIC_EXTRACTION"` -- honest about the actual mechanism: the exact
 * offsets are produced by a literal, reproducible substring search
 * (`text.indexOf(exact_known_string)`) against the real canonical text projection, not by an ML
 * classifier and not typed in by hand. It is an assertion, not a verification: verification_status
 * stays "CANDIDATE" throughout this script. Unit D (real human verification) is a separate,
 * later, unstarted unit.
 *
 * `inventory_ref` is bound to the SAME real content reference as `source_document_ref`: there is
 * no separate Tier-3 Inventory registry running in production yet (confirmed by
 * docs/architecture/F4B-DOCUMENT-FACT-MODEL-CHECK-2026-08-12.md's own recon) -- rather than
 * fabricate one, the promoted document stands in as its own inventory entry for now. This is a
 * documented simplification, not invented data: the id/hash are real.
 *
 * `subject_ref` (the specific property) is deliberately left unset: the real document names the
 * property only as "fastigheten i Bollnäs kommun" with no fastighetsbeteckning in the extracted
 * text, and this document is not bound to any real ProjectPropertyBindingArtifact in this system.
 * Fabricating a subject binding would violate "no fabricated ... " for the same reason a
 * fabricated page number would.
 *
 * Signed by a real, persisted Ed25519 "document-fact-extractor" identity key -- distinct from the
 * governance-promotion key used in Unit A/B, because asserting a fact and admitting a source into
 * CAS are different authorities. This candidate is NOT written to CAS: constructing it proves the
 * contract; governance-owned CAS admission for this artifact family is a later unit (E, per ADR-27).
 *
 * Usage:
 *   npx tsx scripts/ops/prove-document-fact-candidate-01.ts --execute
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
  type DocumentFactCandidateSigner,
} from '../../packages/mps-data-governance/src/createDocumentFactCandidate';
import type { ContentReference } from '../../packages/mps-core/src/types';

const SECRETS_DIR = 'C:/Users/jimmy/.mimers/secrets';
const EXTRACTOR_KEY_ID = 'ed25519:document-fact-extractor-v1';

// The already-promoted quarantine item from DOCUMENT-SOURCE-TO-TEXT-PROJECTION-V1 (commit 97e7173f).
const QUARANTINE_ID = '00019927-5933-499c-9be1-98991ad31f2f';

// The exact, literal DOMSLUT text -- verified present in the real projected text at this run.
// `text.indexOf` on this literal string is the entire "extraction": deterministic and reproducible
// by anyone re-running this script against the same source.
const TARGET_SPAN_TEXT =
  'MARK- OCH MILJÖÖVERDOMSTOLENS DOMSLUT 1. Mark- och miljööverdomstolen fastställer mark- och miljödomstolens dom.';

function loadOrGenerateExtractorSigningKey(): { keyId: string; privatePem: string; publicPem: string } {
  const dir = `${SECRETS_DIR}/document-fact-extractor-signing-key-v1`;
  const privatePath = `${dir}/private.pem`;
  const publicPath = `${dir}/public.pem`;
  if (existsSync(privatePath) && existsSync(publicPath)) {
    return { keyId: EXTRACTOR_KEY_ID, privatePem: readFileSync(privatePath, 'utf8'), publicPem: readFileSync(publicPath, 'utf8') };
  }
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const { publicKey, privateKey } = LocalPemSigningKeyProvider.generate(EXTRACTOR_KEY_ID);
  writeFileSync(privatePath, privateKey, { mode: 0o600 });
  writeFileSync(publicPath, publicKey);
  console.log(`Generated new document-fact-extractor signing key -> ${dir}`);
  return { keyId: EXTRACTOR_KEY_ID, privatePem: privateKey, publicPem: publicKey };
}

async function main() {
  console.log('########## PROVE-DOCUMENT-FACT-CANDIDATE-01 ##########\n');
  if (!process.argv.includes('--execute')) {
    throw new Error('Refusing to run without --execute.');
  }

  const quarantineRoot = process.env.QUARANTINE_ROOT || path.resolve('.quarantine');
  const mimersRoot = process.env.MIMERS_ROOT || path.resolve('.data/mimers');
  const durabilityMode = (process.env.MIMERS_DURABILITY_MODE || 'best-effort') as 'strict' | 'best-effort' | 'none';

  console.log('=== STEP 1: re-resolve the real already-promoted MMOD source (Unit A/B, commit 97e7173f) ===\n');
  const cas = new FileCASRepository(path.join(mimersRoot, 'cas'), { durabilityMode });
  await cas.initialize();
  const quarantine = new DiskQuarantineStorage(quarantineRoot);
  const meta = await quarantine.getMetadata(QUARANTINE_ID);
  if (!meta) throw new Error(`quarantine metadata not found for ${QUARANTINE_ID}`);
  if (meta.status !== 'promoted') {
    throw new Error(`REJECT: quarantine item ${QUARANTINE_ID} is not promoted (status=${meta.status}). Re-run Unit A/B first.`);
  }
  console.log(`  quarantine_id: ${QUARANTINE_ID} (status: ${meta.status})`);
  console.log(`  file_name: ${meta.file_name}`);

  const bytes = await cas.getBytes(`sha256:${meta.content_hash}`, { verifyHash: true });
  if (!bytes) throw new Error('CAS retrieval failed -- promoted bytes not found or hash mismatch.');
  console.log(`  CAS bytes retrieved and hash-reverified: ${bytes.length} bytes\n`);

  console.log('=== STEP 2: real deterministic text projection (same contract as Unit A/B) ===\n');
  const source = {
    ref: { artifact_id: QUARANTINE_ID, artifact_type: 'RAW_SOURCE' },
    bytes_content_hash: { algorithm: 'sha256' as const, value: meta.content_hash },
    doc_name: meta.file_name,
    source_system: meta.source_id,
    mime_type: 'application/pdf',
  };
  const { projection } = await ingestDocumentToTextProjection({ source, bytes });
  console.log(`  projection_id: ${projection.projection_id}`);
  console.log(`  projection content_hash: ${projection.content_hash.value}`);
  console.log(`  char_count: ${projection.char_count}\n`);

  console.log('=== STEP 3: locate the exact, real source span (deterministic substring search) ===\n');
  const startOffset = projection.text.indexOf(TARGET_SPAN_TEXT);
  if (startOffset < 0) {
    throw new Error('REJECT: target DOMSLUT text not found in the real projected text -- refusing to fabricate a span.');
  }
  const endOffset = startOffset + TARGET_SPAN_TEXT.length;
  const recoveredSpanText = projection.text.slice(startOffset, endOffset);
  if (recoveredSpanText !== TARGET_SPAN_TEXT) {
    throw new Error('REJECT: recovered span text does not exactly match the target -- refusing to proceed.');
  }
  console.log(`  start_offset: ${startOffset}, end_offset: ${endOffset}`);
  console.log(`  span text: ${JSON.stringify(recoveredSpanText)}\n`);

  console.log('=== STEP 4: build and sign the real DocumentFactCandidateArtifact ===\n');
  const documentRef: ContentReference = {
    id: QUARANTINE_ID,
    content_hash: { algorithm: 'sha256', digest: meta.content_hash },
  };
  const projectionRef: ContentReference = {
    id: projection.projection_id,
    content_hash: { algorithm: 'sha256', digest: projection.content_hash.value },
  };
  const extractorIdentityId = 'document-fact-deterministic-span-extractor/v1';
  const extractorIdentityRef: ContentReference = {
    id: extractorIdentityId,
    // Real hash of the identity's own stable id string -- not a placeholder.
    content_hash: { algorithm: 'sha256', digest: createHash('sha256').update(extractorIdentityId, 'utf8').digest('hex') },
  };

  const key = loadOrGenerateExtractorSigningKey();
  const signingProvider = new LocalPemSigningKeyProvider(key.keyId, key.privatePem, key.publicPem);
  const signer: DocumentFactCandidateSigner = {
    keyId: key.keyId,
    async sign(payload) {
      const envelope = await signingProvider.sign(payload);
      return { signatureBase64: envelope.signature.replace(/^ed25519:/, '') };
    },
  };

  const candidate = await createDocumentFactCandidate(
    {
      fact_type: 'PRIOR_LOCATION_RESTRICTING_DECISION',
      fact_version: '1.0',
      source_document_ref: documentRef,
      // No separate Tier-3 Inventory registry exists yet -- see file header.
      inventory_ref: documentRef,
      source_span: { text_projection_ref: projectionRef, start_offset: startOffset, end_offset: endOffset },
      asserted_by: { identity_ref: extractorIdentityRef, role: 'SYSTEM_PROCESS' },
      assertion_method: 'DETERMINISTIC_EXTRACTION',
      asserter_version: 'document-fact-deterministic-span-extractor/v1',
      asserted_at: new Date().toISOString(),
    },
    signer,
  );

  console.log(`  artifact_id: ${candidate.artifact_id}`);
  console.log(`  content_hash: ${candidate.content_hash.digest}`);
  console.log(`  signature.key_id: ${candidate.signature.key_id}`);
  console.log(`  verification_status: ${candidate.verification_status}\n`);

  console.log('=== STEP 5: re-run STEP 4 to prove identity is deterministic (RED-1) ===\n');
  const candidateRerun = await createDocumentFactCandidate(
    {
      fact_type: 'PRIOR_LOCATION_RESTRICTING_DECISION',
      fact_version: '1.0',
      source_document_ref: documentRef,
      inventory_ref: documentRef,
      source_span: { text_projection_ref: projectionRef, start_offset: startOffset, end_offset: endOffset },
      asserted_by: { identity_ref: extractorIdentityRef, role: 'SYSTEM_PROCESS' },
      assertion_method: 'DETERMINISTIC_EXTRACTION',
      asserter_version: 'document-fact-deterministic-span-extractor/v1',
      // Deliberately a different wall-clock timestamp -- must not affect identity (IMPORT-TIME-001).
      asserted_at: new Date(Date.now() + 60_000).toISOString(),
    },
    signer,
  );
  const identityStable = candidate.artifact_id === candidateRerun.artifact_id;
  console.log(`  rerun artifact_id: ${candidateRerun.artifact_id}`);
  console.log(`  identity stable across different asserted_at: ${identityStable}\n`);

  console.log('=== STEP 6: independently verify the candidate signature against the persisted public key ===\n');
  const verifier = new LocalPemVerificationKeyProvider(key.keyId, key.publicPem);
  const signatureValid = await verifier.verify(
    Buffer.from(candidate.content_hash.digest, 'hex'),
    {
      algorithm: 'Ed25519',
      digestAlgorithm: 'sha256',
      canonicalization: 'RFC8785',
      keyId: candidate.signature.key_id ?? '',
      signature: candidate.signature.signature,
      timestamp: 0,
    },
  );
  const tamperedValid = await verifier.verify(
    Buffer.from('0'.repeat(64), 'hex'),
    {
      algorithm: 'Ed25519',
      digestAlgorithm: 'sha256',
      canonicalization: 'RFC8785',
      keyId: candidate.signature.key_id ?? '',
      signature: candidate.signature.signature,
      timestamp: 0,
    },
  );
  console.log(`  signature verifies against real content_hash: ${signatureValid}`);
  console.log(`  signature rejects a tampered content_hash: ${!tamperedValid}\n`);

  const ok =
    identityStable &&
    candidate.verification_status === 'CANDIDATE' &&
    candidate.source_document_ref.id === QUARANTINE_ID &&
    candidate.source_span.text_projection_ref.id === projection.projection_id &&
    candidate.source_span.start_offset === startOffset &&
    candidate.source_span.end_offset === endOffset &&
    /^ed25519:/.test(candidate.signature.signature) &&
    signatureValid &&
    !tamperedValid;

  console.log('\n========== SUMMARY ==========');
  console.log(
    JSON.stringify(
      {
        quarantine_id: QUARANTINE_ID,
        source_document_content_hash: meta.content_hash,
        projection_id: projection.projection_id,
        projection_content_hash: projection.content_hash.value,
        candidate_artifact_id: candidate.artifact_id,
        candidate_content_hash: candidate.content_hash.digest,
        candidate_signature_key_id: candidate.signature.key_id,
        fact_type: candidate.fact_type,
        source_span: candidate.source_span,
        identity_stable_across_rerun: identityStable,
        signature_verifies: signatureValid,
        signature_rejects_tampered_hash: !tamperedValid,
      },
      null,
      2,
    ),
  );
  console.log(`\nALL GREEN: ${ok}`);
  process.exitCode = ok ? 0 : 1;
}

main().catch((error) => {
  console.error('FATAL:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
