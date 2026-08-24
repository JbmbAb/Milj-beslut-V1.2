/**
 * DOCUMENT-FACT-CANDIDATE-REISSUE-V1.
 *
 * ONE corrected real DocumentFactCandidateArtifact, from the same governed CAS source and the
 * same deterministic text projection as the rejected candidate (commit ff9ce938, rejected in
 * DOCUMENT-FACT-HUMAN-VERIFICATION-V1, see docs/architecture/
 * DOCUMENT-FACT-HUMAN-VERIFICATION-V1-REJECTION-2026-08-24.md), but a DIFFERENT, narrower, real
 * source span.
 *
 * The rejected span (offsets 646-758, the DOMSLUT) affirmed a lower-court judgment without
 * itself stating what was restricted. The corrected span below is the lower court's own BAKGRUND
 * restatement (the Östersunds tingsrätt judgment, reproduced in full as an appendix inside this
 * same MMOD PDF): it names the property (skogsbruksfastigheten i Bollnäs kommun, 92 ha), the
 * notified area (2,7 ha), AND the actual prohibition decision (Skogsstyrelsen förbjudit
 * avverkning, 29 juni 2018) -- all three required elements (a real restrictive decision, what
 * the restriction is, and location/property context) inside ONE contiguous, literal span, with
 * nothing left for a reviewer to infer from elsewhere in the document.
 *
 * The rejected candidate (fact-candidate-776ae304bf01df5bca446f5e) is NEVER reconstructed here
 * with intent to mutate or replace it -- it is rebuilt read-only, once, solely to prove its
 * identity is unchanged and differs from the new one (RED-2/RED-7). Its rejection record
 * (the doc above) is not touched by this script.
 *
 * Usage:
 *   npx tsx scripts/ops/prove-document-fact-candidate-reissue-01.ts --execute
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { FileCASRepository, DiskQuarantineStorage, LocalPemSigningKeyProvider } from '@miljobeslut/mimers-brunn-core';
import { ingestDocumentToTextProjection } from '../../server/text-projection/createGovernedTextIngestion';
import {
  createDocumentFactCandidate,
  computeDocumentFactCandidateIdentity,
  isDocumentFactCandidateContentHashValid,
  type DocumentFactCandidateSigner,
} from '../../packages/mps-data-governance/src/createDocumentFactCandidate';
import type { ContentReference } from '../../packages/mps-core/src/types';

const SECRETS_DIR = 'C:/Users/jimmy/.mimers/secrets';
const EXTRACTOR_KEY_ID = 'ed25519:document-fact-extractor-v1';
const QUARANTINE_ID = '00019927-5933-499c-9be1-98991ad31f2f';

const REJECTED_SPAN_TEXT =
  'MARK- OCH MILJÖÖVERDOMSTOLENS DOMSLUT 1. Mark- och miljööverdomstolen fastställer mark- och miljödomstolens dom.';
const REJECTED_CANDIDATE_ID = 'fact-candidate-776ae304bf01df5bca446f5e';

// The new, tighter span: property + notified area + the actual prohibition decision, all in one
// contiguous passage (the lower court's own BAKGRUND restatement, verbatim in this MMOD PDF).
const CORRECTED_SPAN_TEXT =
  'äger skogsbruksfastigheten i Bollnäs kommun. Fastigheten omfattar 92 ha. Kärandena anmälde i ' +
  'januari 2018 en planerad föryngringsavverkning av ett område om 2,7 ha inom fastigheten. ' +
  'Skogsstyrelsen har i ett beslut den 29 juni 2018 vid vite förbjudit all form av avverkning ' +
  'inom det anmälda området.';

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
  console.log('########## PROVE-DOCUMENT-FACT-CANDIDATE-REISSUE-01 ##########\n');
  if (!process.argv.includes('--execute')) throw new Error('Refusing to run without --execute.');

  const quarantineRoot = process.env.QUARANTINE_ROOT || path.resolve('.quarantine');
  const mimersRoot = process.env.MIMERS_ROOT || path.resolve('.data/mimers');
  const durabilityMode = (process.env.MIMERS_DURABILITY_MODE || 'best-effort') as 'strict' | 'best-effort' | 'none';

  console.log('=== STEP 1: same governed CAS source, same deterministic text projection ===\n');
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
  console.log(`  projection_id: ${projection.projection_id} (same as the rejected candidate's)\n`);

  console.log('=== STEP 2 (RED-5/RED-6): literal substring verification for BOTH spans ===\n');
  const rejectedStart = projection.text.indexOf(REJECTED_SPAN_TEXT);
  const correctedStart = projection.text.indexOf(CORRECTED_SPAN_TEXT);
  if (rejectedStart < 0) throw new Error('REJECT: rejected span text not found -- refusing to proceed.');
  if (correctedStart < 0) throw new Error('REJECT: corrected span text not found -- refusing to fabricate a span.');
  const rejectedEnd = rejectedStart + REJECTED_SPAN_TEXT.length;
  const correctedEnd = correctedStart + CORRECTED_SPAN_TEXT.length;
  console.log(`  rejected span offsets:  ${rejectedStart}-${rejectedEnd}`);
  console.log(`  corrected span offsets: ${correctedStart}-${correctedEnd}`);
  console.log(`  both literal, exact, reproducible: true\n`);

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

  const buildInput = (spanStart: number, spanEnd: number, assertedAt: string) => ({
    fact_type: 'PRIOR_LOCATION_RESTRICTING_DECISION' as const,
    fact_version: '1.0',
    source_document_ref: documentRef,
    inventory_ref: documentRef,
    source_span: { text_projection_ref: projectionRef, start_offset: spanStart, end_offset: spanEnd },
    asserted_by: { identity_ref: extractorIdentityRef, role: 'SYSTEM_PROCESS' as const },
    assertion_method: 'DETERMINISTIC_EXTRACTION' as const,
    asserter_version: extractorIdentityId,
    asserted_at: assertedAt,
  });

  console.log('=== STEP 3: rebuild the REJECTED candidate read-only, to prove its identity is unchanged ===\n');
  const rejectedRebuilt = await createDocumentFactCandidate(buildInput(rejectedStart, rejectedEnd, '2026-08-24T14:30:00.000Z'), extractorSigner);
  const rejectedIdentityUnchanged = rejectedRebuilt.artifact_id === REJECTED_CANDIDATE_ID;
  console.log(`  rebuilt rejected candidate artifact_id: ${rejectedRebuilt.artifact_id}`);
  console.log(`  matches historical rejected identity exactly (unchanged): ${rejectedIdentityUnchanged}\n`);

  console.log('=== STEP 4: build the NEW corrected candidate ===\n');
  const correctedInput = buildInput(correctedStart, correctedEnd, new Date().toISOString());
  const corrected = await createDocumentFactCandidate(correctedInput, extractorSigner);
  console.log(`  corrected candidate_artifact_id: ${corrected.artifact_id}`);
  console.log(`  content_hash: ${corrected.content_hash.digest}\n`);

  console.log('=== STEP 5 (RED-2/RED-7): rejected span/identity != corrected span/identity ===\n');
  const identityDiffersFromRejected = corrected.artifact_id !== rejectedRebuilt.artifact_id;
  const spanDiffersFromRejected = correctedStart !== rejectedStart || correctedEnd !== rejectedEnd;
  console.log(`  span differs from rejected: ${spanDiffersFromRejected}`);
  console.log(`  artifact_id differs from rejected: ${identityDiffersFromRejected}\n`);

  console.log('=== STEP 6 (RED-1): same new source/span/semantics -> deterministic candidate identity ===\n');
  const correctedRerun = await createDocumentFactCandidate(buildInput(correctedStart, correctedEnd, '2030-01-01T00:00:00.000Z'), extractorSigner);
  const identityStable = corrected.artifact_id === correctedRerun.artifact_id;
  const identityMatchesPureCompute = corrected.artifact_id === computeDocumentFactCandidateIdentity(correctedInput);
  console.log(`  identity stable across different asserted_at: ${identityStable}`);
  console.log(`  matches pure identity computation: ${identityMatchesPureCompute}\n`);

  console.log('=== STEP 7 (RED-3): modified new span -> identity changes ===\n');
  const shiftedInput = buildInput(correctedStart, correctedEnd - 1, correctedInput.asserted_at);
  const shifted = await createDocumentFactCandidate(shiftedInput, extractorSigner);
  const shiftedIdentityDiffers = shifted.artifact_id !== corrected.artifact_id;
  console.log(`  1-char-shorter span produces a different artifact_id: ${shiftedIdentityDiffers}\n`);

  console.log('=== STEP 8 (RED-4): out-of-range/malformed span -> DENY ===\n');
  let malformedDenied = false;
  try {
    await createDocumentFactCandidate(buildInput(correctedEnd, correctedStart, correctedInput.asserted_at), extractorSigner);
  } catch (err) {
    malformedDenied = err instanceof Error && /source_span is mandatory/i.test(err.message);
    console.log(`  denied with: ${err instanceof Error ? err.message : String(err)}`);
  }
  console.log(`  malformed span denied: ${malformedDenied}\n`);

  console.log('=== STEP 9 (RED-8/9/10): scope check -- no VerifiedDocumentFact, DocumentEvidence, or LU wiring in this script ===\n');
  console.log('  this script imports only createDocumentFactCandidate and text-projection/CAS reads.');
  console.log('  no verifyDocumentFactCandidate / verifyRealDocumentFactCandidate call exists above.\n');

  console.log('=== STEP 10: candidate content_hash integrity + full provenance traceability ===\n');
  const integrityValid = isDocumentFactCandidateContentHashValid(corrected);
  const traceable =
    corrected.source_document_ref.id === QUARANTINE_ID &&
    corrected.source_span.text_projection_ref.id === projection.projection_id &&
    corrected.source_span.start_offset === correctedStart &&
    corrected.source_span.end_offset === correctedEnd;
  console.log(`  content_hash integrity valid: ${integrityValid}`);
  console.log(`  traceable to source_document_ref + text_projection_ref + exact offsets: ${traceable}\n`);

  console.log('════════════════════════════════════════════════════════════════');
  console.log(' NEW REVIEW MATERIAL -- a fresh, explicit human decision is required');
  console.log(' (the prior REJECT of fact-candidate-776ae304bf01df5bca446f5e does NOT carry over)');
  console.log('════════════════════════════════════════════════════════════════\n');
  console.log(`  new candidate_artifact_id : ${corrected.artifact_id}`);
  console.log(`  new candidate content_hash: ${corrected.content_hash.digest}`);
  console.log(`  fact_type                 : ${corrected.fact_type}\n`);
  console.log('  --- Source document (same as before) ---');
  console.log(`  file_name : ${meta.file_name}`);
  console.log(`  source    : ${meta.source_id}`);
  console.log(`  quarantine_id: ${QUARANTINE_ID}\n`);
  console.log('  --- NEW exact source span ---');
  console.log(`  text_projection_ref: ${corrected.source_span.text_projection_ref.id}`);
  console.log(`  start_offset: ${correctedStart}, end_offset: ${correctedEnd}`);
  console.log('  EXACT SPAN TEXT:');
  console.log(`    "${projection.text.slice(correctedStart, correctedEnd)}"\n`);
  console.log('  --- Surrounding context ---');
  console.log(`  BEFORE: ...${projection.text.slice(Math.max(0, correctedStart - 150), correctedStart)}`);
  console.log(`  AFTER : ${projection.text.slice(correctedEnd, correctedEnd + 150)}...\n`);
  console.log('  --- Why this span is claimed to support PRIOR_LOCATION_RESTRICTING_DECISION ---');
  console.log('  The span, on its own, states: (1) a named property (skogsbruksfastigheten i');
  console.log('  Bollnäs kommun, 92 ha), (2) the notified area within it (2,7 ha), and (3) that');
  console.log('  Skogsstyrelsen, by decision of 2018-06-29, prohibited (förbjudit, vid vite) all');
  console.log('  logging within the notified area. All three elements a reviewer needs -- that a');
  console.log('  restriction exists, what it restricts, and where -- are inside this one span; none');
  console.log('  require reading elsewhere in the document.\n');

  const ok =
    rejectedIdentityUnchanged &&
    identityDiffersFromRejected &&
    spanDiffersFromRejected &&
    identityStable &&
    identityMatchesPureCompute &&
    shiftedIdentityDiffers &&
    malformedDenied &&
    integrityValid &&
    traceable;

  console.log(`ALL PROOFS GREEN: ${ok}`);
  console.log('\nSTOPPING. No VerifiedDocumentFactArtifact constructed. Awaiting a fresh, explicit human decision.');
  process.exitCode = ok ? 0 : 1;
}

main().catch((error) => {
  console.error('FATAL:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
