/**
 * ORSA-EXECUTION-IDENTITY-REISSUE-01 -- required proof matrix.
 *
 * Read-only against real CAS/DB except where noted. No writes, no re-issuance.
 */
import '../../server/loadEnvFirst';
import { readFileSync } from 'node:fs';
import { LocalPemVerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';
import { MimersIntegration } from '@miljobeslut/mps-runtime';
import { verifyExecutionIdentityAttestation, buildExecutionIdentityAttestationPredicate } from '../../packages/mps-lu/src/execution/ExecutionIdentityAttestation';

const SECRETS_DIR = 'C:/Users/jimmy/.mimers/secrets';
const REAL_ISSUER_KEY_ID = 'ed25519:lu-execution-issuer-v1-656368e58631c925';
const NEW_IDENTITY_ID = 'lu-identity-v2-35944be3cb076e62565e69ac0bfe8d9c9e4abc564282d69f5fd8322c19878860';
const OLD_V1_IDENTITY_ID = 'lu-identity-lm_fastighetsytor_merged:merged:ORSASTACKMORA3:12';
const SITE_ID = 'lm_fastighetsytor_merged:merged:ORSASTACKMORA3:12';
const CURRENT_BINDING = { artifact_id: 'project-context-binding-dd8e2bb706cfa9affab8fc19', artifact_type: 'project_context_binding' } as const;
const OTHER_BINDING = { artifact_id: 'project-context-binding-32f1ff68cf89421ac4b75d86', artifact_type: 'project_context_binding' } as const;
const CURRENT_RELEASE = { artifact_id: 'product-release-772aceb600c4690777593ea8', artifact_type: 'product_release_manifest' } as const;
const OTHER_RELEASE = { artifact_id: 'product-release-DOES-NOT-EXIST', artifact_type: 'product_release_manifest' } as const;
const DETERMINISTIC_SEED = '1a577df297951120a3b0210f0e4b71cb76716eecc6bb5721c70958670c6ee7b8';
const CAPABILITY_REF = { artifact_id: 'cap-lu-site-assessment-v1', artifact_type: 'CAPABILITY_DEFINITION' } as const;
const ACTOR_REF = { artifact_id: 'lu.site_assessment.actor', artifact_type: 'execution_identity' } as const;
const RELEASE_SNAPSHOT_ID = 'lu-registry-snapshot-v1';

async function main() {
  const privateKeyEnvVars = Object.keys(process.env).filter((k) => /PRIVATE_KEY/i.test(k));
  if (privateKeyEnvVars.length > 0) {
    throw new Error(`PRIVATE KEY MATERIAL PRESENT IN THIS PROCESS: ${privateKeyEnvVars.join(', ')} -- verification voided.`);
  }
  console.log('SELF-CHECK PASS: no *PRIVATE_KEY* environment variable present in this process.\n');

  const issuerPublic = readFileSync(`${SECRETS_DIR}/lu-execution-authority/issuer-public.pem`, 'utf8');
  const issuerVerification = new LocalPemVerificationKeyProvider(REAL_ISSUER_KEY_ID, issuerPublic);
  const mimers = await MimersIntegration.create({ forceMimers: true });
  const repo = mimers.artifactRepository;

  const identity = await repo.resolve<any>({ artifact_id: NEW_IDENTITY_ID, artifact_type: 'execution_identity' });
  const attestation = await repo.resolve<any>(identity.signature_envelope_ref);

  const basePredicate = buildExecutionIdentityAttestationPredicate({
    execution_identity_id: identity.artifact_id,
    actor_ref: identity.actor_ref,
    capability_ref: identity.capability_ref,
    release_snapshot_id: RELEASE_SNAPSHOT_ID,
    site_id: SITE_ID,
    deterministic_seed: DETERMINISTIC_SEED,
  });

  console.log('=== proof: current V2 subject -> verifies ===');
  const okResult = await verifyExecutionIdentityAttestation({
    identity, attestation, expectedPredicate: basePredicate, authorityVerifier: issuerVerification,
    expectedSubjectV2: { site_id: SITE_ID, project_context_binding_ref: CURRENT_BINDING, product_release_ref: CURRENT_RELEASE, execution_contract_version: 'lu-execution-identity-v1' },
  });
  console.log('  result:', okResult.verified);
  if (!okResult.verified) throw new Error('EXPECTED PASS, GOT DENY: ' + JSON.stringify(okResult));

  console.log('=== proof: old superseded-binding V1 identity NOT accepted for current (V2-expecting) execution ===');
  const oldIdentity = await repo.resolve<any>({ artifact_id: OLD_V1_IDENTITY_ID, artifact_type: 'execution_identity' });
  const oldAttestation = await repo.resolve<any>(oldIdentity.signature_envelope_ref);
  const oldResult = await verifyExecutionIdentityAttestation({
    identity: oldIdentity, attestation: oldAttestation, expectedPredicate: basePredicate, authorityVerifier: issuerVerification,
    expectedSubjectV2: { site_id: SITE_ID, project_context_binding_ref: CURRENT_BINDING, product_release_ref: CURRENT_RELEASE, execution_contract_version: 'lu-execution-identity-v1' },
  });
  console.log('  result (mismatched predicate too):', oldResult.verified, !oldResult.verified ? (oldResult as any).reason : '');
  if (oldResult.verified) throw new Error('EXPECTED DENY (legacy identity for current V2 execution), GOT PASS');

  // Isolate the LEGACY_IDENTITY_NOT_ALLOWED branch specifically: use the OLD identity's OWN
  // real predicate (its actual mint-time site_id/seed), so only expectedSubjectV2 differs.
  const oldOwnPredicate = buildExecutionIdentityAttestationPredicate({
    execution_identity_id: oldIdentity.artifact_id,
    actor_ref: oldIdentity.actor_ref,
    capability_ref: oldIdentity.capability_ref,
    release_snapshot_id: RELEASE_SNAPSHOT_ID,
    site_id: SITE_ID,
    deterministic_seed: oldAttestation.predicate.deterministic_seed,
  });
  const oldResultIsolated = await verifyExecutionIdentityAttestation({
    identity: oldIdentity, attestation: oldAttestation, expectedPredicate: oldOwnPredicate, authorityVerifier: issuerVerification,
    expectedSubjectV2: { site_id: SITE_ID, project_context_binding_ref: CURRENT_BINDING, product_release_ref: CURRENT_RELEASE, execution_contract_version: 'lu-execution-identity-v1' },
  });
  console.log('  result (own predicate, V2 expected -> isolates the legacy-rejection branch):', oldResultIsolated.verified, !oldResultIsolated.verified ? (oldResultIsolated as any).reason : '');
  if (oldResultIsolated.verified || (oldResultIsolated as any).reason !== 'LEGACY_IDENTITY_NOT_ALLOWED') {
    throw new Error('EXPECTED LEGACY_IDENTITY_NOT_ALLOWED, GOT: ' + JSON.stringify(oldResultIsolated));
  }

  console.log('=== proof: wrong binding -> DENY ===');
  const wrongBindingResult = await verifyExecutionIdentityAttestation({
    identity, attestation, expectedPredicate: basePredicate, authorityVerifier: issuerVerification,
    expectedSubjectV2: { site_id: SITE_ID, project_context_binding_ref: OTHER_BINDING, product_release_ref: CURRENT_RELEASE, execution_contract_version: 'lu-execution-identity-v1' },
  });
  console.log('  result:', wrongBindingResult.verified, !wrongBindingResult.verified ? (wrongBindingResult as any).reason : '');
  if (wrongBindingResult.verified) throw new Error('EXPECTED DENY (wrong binding), GOT PASS');

  console.log('=== proof: wrong release -> DENY ===');
  const wrongReleaseResult = await verifyExecutionIdentityAttestation({
    identity, attestation, expectedPredicate: basePredicate, authorityVerifier: issuerVerification,
    expectedSubjectV2: { site_id: SITE_ID, project_context_binding_ref: CURRENT_BINDING, product_release_ref: OTHER_RELEASE, execution_contract_version: 'lu-execution-identity-v1' },
  });
  console.log('  result:', wrongReleaseResult.verified, !wrongReleaseResult.verified ? (wrongReleaseResult as any).reason : '');
  if (wrongReleaseResult.verified) throw new Error('EXPECTED DENY (wrong release), GOT PASS');

  console.log('=== proof: tampered identity content -> DENY ===');
  const tampered = { ...identity, capability_ref: { artifact_id: 'cap-SOMETHING-ELSE', artifact_type: 'CAPABILITY_DEFINITION' } };
  const tamperedResult = await verifyExecutionIdentityAttestation({
    identity: tampered, attestation, expectedPredicate: basePredicate, authorityVerifier: issuerVerification,
    expectedSubjectV2: { site_id: SITE_ID, project_context_binding_ref: CURRENT_BINDING, product_release_ref: CURRENT_RELEASE, execution_contract_version: 'lu-execution-identity-v1' },
  });
  console.log('  result:', tamperedResult.verified, !tamperedResult.verified ? (tamperedResult as any).reason : '');
  if (tamperedResult.verified) throw new Error('EXPECTED DENY (tampered content), GOT PASS');

  console.log('\nALL PROOFS PASS');
}
main().catch((e) => { console.error('PROOF FAILED:', e instanceof Error ? e.message : e); process.exitCode = 1; });
