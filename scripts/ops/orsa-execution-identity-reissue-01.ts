/**
 * OWNER DECISION -- ORSA-EXECUTION-IDENTITY-REISSUE-01 (2026-08-22).
 *
 * A distinct owner-provisioning action, same shape as ORSA-VIEWER-CAPABILITY-PROVISIONING-01.
 * Issues exactly one real ExecutionIdentity V2 for ORSA's CURRENT canonical subject: the one real
 * ExecutionIdentity that already existed for ORSA (`lu-identity-lm_fastighetsytor_merged:...`) is
 * the legacy V1, site-only shape, minted under ORSA's OLD, now-superseded binding
 * (project-context-binding-32f1ff68...) by scripts/ops/bootstrap-lu-execution-authority.ts. It is
 * correctly refused by generate-localization-report.usecase.ts, which always supplies
 * identity_subject_v2 and therefore requires a real V2 identity for the CURRENT binding
 * (project-context-binding-dd8e2bb7...) -- none has ever been issued.
 *
 * Reuses, does not recreate: the existing persisted LU execution authority root+issuer keys
 * (~/.mimers/secrets/lu-execution-authority/{root,issuer}-{private,public}.pem). No new key,
 * issuer, trust root, or authority is created here. The private signing key is loaded and used
 * only inside this offline script's own process; it is never written to .env/.env.local.
 *
 * Usage: MIMERS_ROOT="C:\Users\jimmy\.mimers" PRODUCT_RELEASE_ARTIFACT_ID=<verified-release> npx tsx scripts/ops/orsa-execution-identity-reissue-01.ts --execute
 */
import '../../server/loadEnvFirst';
import { readFileSync } from 'node:fs';
import { LocalPemSigningKeyProvider, LocalPemVerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';
import { MimersIntegration } from '@miljobeslut/mps-runtime';
import {
  deriveLuExecutionSeed,
  LU_EXECUTION_PRINCIPAL_ID,
  LU_EXECUTION_AUTHORITY_ISSUER_TYPE,
} from '@miljobeslut/mps-lu';
import { createLuRegistryRuntime } from '../../packages/mps-lu/src/registry/createLuRegistryRuntime';
import { LU_SITE_ASSESSMENT_CAPABILITY_KEY } from '../../packages/mps-lu/src/registry/LuSiteAssessmentRegistry';
import { issueExecutionIdentityV2 } from '../../packages/mps-lu/src/execution/LuExecutionIdentityIssuer';
import { verifyLuExecutionAuthorityChain } from '../../packages/mps-lu/src/execution/LuExecutionAuthorityChain';
import {
  buildExecutionIdentityAttestationPredicate,
  verifyExecutionIdentityAttestation,
} from '../../packages/mps-lu/src/execution/ExecutionIdentityAttestation';
import { resolveCanonicalProjectContext } from '../../src/application/resolveCanonicalProjectContext';
import { resolveCanonicalProductRelease } from '../../server/modules/release/productReleaseRuntime';

const SECRETS_DIR = 'C:/Users/jimmy/.mimers/secrets';
const PROJECT_ID = 'cmt2m7bdj0000h0f7uj4jykis';
const EXPECTED_CURRENT_BINDING_ID = 'project-context-binding-dd8e2bb706cfa9affab8fc19';
// The real, already-persisted LU execution authority issuer -- resolved from the existing V1
// identity's own references, not reconstructed. Its stored public_key_fingerprint uses a
// different derivation than a plain sha256(PEM-text) guess would reproduce; resolving the real
// artifact_id directly sidesteps that entirely, and verifyLuExecutionAuthorityChain below proves
// cryptographically (not just by fingerprint metadata) that the local key files are the real,
// currently-trusted ones for this exact issuer.
const REAL_ISSUER_REF = { artifact_id: 'lu-execution-authority-issuer-8a7861f9da74621c6bda9032', artifact_type: LU_EXECUTION_AUTHORITY_ISSUER_TYPE } as const;

async function main() {
  if (!process.argv.includes('--execute')) throw new Error('refusing to write without --execute');
  if (!process.env.MIMERS_ROOT?.trim()) throw new Error('MIMERS_ROOT is required.');

  // Existing public verification material only, reused. Set in this process so the reused
  // resolveCanonicalProjectContext -> ProjectContextBindingProvider chain can run.
  process.env.PROJECT_CONTEXT_BINDING_ISSUER_KEY_ID = 'project-context-binding-issuer-v1-fb38fb09cba8f5f8';
  process.env.PROJECT_CONTEXT_BINDING_ISSUER_PUBLIC_KEY_PEM = readFileSync(`${SECRETS_DIR}/project-context-binding-issuer-v1-public.pem`, 'utf8');

  // Existing LU execution authority key pair -- private key used ONLY in this offline process.
  const rootKeyId = 'ed25519:lu-execution-root-v1-839f2a91ad203e79';
  const rootPublic = readFileSync(`${SECRETS_DIR}/lu-execution-authority/root-public.pem`, 'utf8');
  const rootPrivate = readFileSync(`${SECRETS_DIR}/lu-execution-authority/root-private.pem`, 'utf8');
  const issuerKeyId = 'ed25519:lu-execution-issuer-v1-656368e58631c925';
  const issuerPublic = readFileSync(`${SECRETS_DIR}/lu-execution-authority/issuer-public.pem`, 'utf8');
  process.env.LU_EXECUTION_AUTHORITY_SIGNING_KEY_ID = issuerKeyId;
  process.env.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM = issuerPublic;
  process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM = readFileSync(`${SECRETS_DIR}/lu-execution-authority/issuer-private.pem`, 'utf8');
  process.env.LU_EXECUTION_AUTHORITY_ROOT_KEY_ID = rootKeyId;
  process.env.LU_EXECUTION_AUTHORITY_ROOT_PUBLIC_KEY_PEM = rootPublic;

  const rootVerification = new LocalPemVerificationKeyProvider(rootKeyId, rootPublic);
  const issuerVerification = new LocalPemVerificationKeyProvider(issuerKeyId, issuerPublic);
  void rootPrivate; // not needed to reuse an already-persisted issuer; kept only to prove it's loadable, never signed with here.

  const mimers = await MimersIntegration.create({ forceMimers: true });
  const repo = mimers.artifactRepository;

  // Resolve the REAL, already-persisted issuer (not reconstructed) and cryptographically verify
  // the full chain against it using only the local key files.
  await verifyLuExecutionAuthorityChain({
    issuerRef: REAL_ISSUER_REF,
    repository: repo,
    rootVerification,
    issuerVerification,
  });
  console.log(`STEP: reused existing, verified LU execution authority chain (issuer=${REAL_ISSUER_REF.artifact_id})`);

  // Step 1: resolve current canonical project/context state FRESH -- the exact same real
  // function the product usecase itself calls.
  const canonicalContext = await resolveCanonicalProjectContext(PROJECT_ID, repo);
  if (canonicalContext.contextBindingRef.artifact_id !== EXPECTED_CURRENT_BINDING_ID) {
    throw new Error(`STOP: resolved current binding ${canonicalContext.contextBindingRef.artifact_id} does not match expected ${EXPECTED_CURRENT_BINDING_ID}.`);
  }
  const release = await resolveCanonicalProductRelease({ artifactRepository: repo });
  const currentRelease = {
    releaseRef: { artifact_id: release.artifact_id, artifact_type: release.artifact_type },
    releaseHash: release.release_hash.value,
  };
  console.log(`STEP 1 PASS: current binding = ${canonicalContext.contextBindingRef.artifact_id}, current release = ${currentRelease.releaseRef.artifact_id}`);

  // Step 2: derive identity_subject_v2 from that verified state.
  const subject = {
    site_id: canonicalContext.propertyIdentity,
    project_context_binding_ref: canonicalContext.contextBindingRef,
    product_release_ref: currentRelease.releaseRef,
    execution_contract_version: 'lu-execution-identity-v1',
  };

  const registry = createLuRegistryRuntime();
  const capability = registry.resolveCapabilityByKey(LU_SITE_ASSESSMENT_CAPABILITY_KEY);
  if (!capability) throw new Error('LU capability unavailable');

  // Must be byte-identical to what generate-localization-report.usecase.ts derives at runtime,
  // since the attestation predicate embeds it and admission recomputes + compares.
  const seed = deriveLuExecutionSeed({
    site_id: subject.site_id,
    project_id: PROJECT_ID,
    project_context_ref: canonicalContext.projectContextRef,
    property_context_ref: canonicalContext.propertyContextRef,
    project_context_binding_ref: canonicalContext.contextBindingRef,
    product_release_ref: currentRelease.releaseRef,
    product_release_hash: currentRelease.releaseHash,
    execution_contract_version: subject.execution_contract_version,
    rule_registry_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
  });

  // Step 6: issue exactly one ExecutionIdentity V2 for the current subject.
  const identity = await issueExecutionIdentityV2({
    subject,
    deterministic_seed: seed,
    actor_ref: { artifact_id: LU_EXECUTION_PRINCIPAL_ID, artifact_type: 'execution_identity' },
    capability_ref: { artifact_id: capability.artifact_id, artifact_type: capability.artifact_type },
    release_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
    issuer_ref: REAL_ISSUER_REF,
    governed_references: [
      canonicalContext.contextBindingRef,
      canonicalContext.projectContextRef,
      canonicalContext.propertyContextRef,
      currentRelease.releaseRef,
    ],
    artifact_repository: repo,
  });
  console.log(`STEP 6 PASS: issued ${identity.artifact_id}`);

  // Step 8/9 (in-process sanity, real fresh-process public-only proof is a separate script):
  // re-verify what was just issued via the same real verification function admission uses.
  const attestation = await repo.resolve<any>(identity.signature_envelope_ref);
  const expectedPredicate = buildExecutionIdentityAttestationPredicate({
    execution_identity_id: identity.artifact_id,
    actor_ref: identity.actor_ref,
    capability_ref: identity.capability_ref,
    release_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
    site_id: subject.site_id,
    deterministic_seed: seed,
  });
  const result = await verifyExecutionIdentityAttestation({
    identity,
    attestation,
    expectedPredicate,
    authorityVerifier: issuerVerification,
    expectedSubjectV2: subject,
  });
  if (!result.verified) throw new Error(`STOP: freshly issued identity does not verify: ${JSON.stringify(result)}`);
  console.log('STEP 8/9 PASS: freshly issued identity verifies against its own expected subject.');

  console.log(
    JSON.stringify(
      {
        owner_provisioning: 'REAL_EXECUTION_IDENTITY_V2_ISSUED_VERIFIED',
        project_id: PROJECT_ID,
        subject,
        deterministic_seed: seed,
        release_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
        capability_ref: { artifact_id: capability.artifact_id, artifact_type: capability.artifact_type },
        issuer_ref: REAL_ISSUER_REF,
        execution_identity_artifact_id: identity.artifact_id,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
