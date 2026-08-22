/**
 * PRODUCT-LU-EXECUTION-IDENTITY-V3-PROVISIONING-01 Phase B.
 *
 * Fresh, standalone verification process spawned by luExecutionIdentityV3Provisioning.ts after
 * issuing an identity. Its own env has LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM deleted before spawn
 * -- this file must never import getLuExecutionAuthoritySigningProvider, only the verifier. Same
 * pattern as luProjectContextBootstrapVerifyCli.ts.
 *
 * Re-derives the expected V3 subject FRESH from real, independently-resolved canonical state
 * (never trusts the worker's own in-process claim of what it minted), then verifies the persisted
 * identity/attestation against it using only the public verification key.
 */
import '../../loadEnvFirst';
import { MimersIntegration } from '@miljobeslut/mps-runtime';
import {
  deriveLuExecutionSeed,
  createLuRegistryRuntime,
  LU_SITE_ASSESSMENT_CAPABILITY_KEY,
  LU_EXECUTION_PRINCIPAL_ID,
  type LocalizationGeometryArtifact,
} from '@miljobeslut/mps-lu';
import type { ExecutionIdentityArtifact } from '../../../packages/mps-runtime/src/execution/ExecutionIdentityArtifact';
import type { ExecutionIdentitySubjectV3 } from '../../../packages/mps-runtime/src/execution/ExecutionIdentityScopeV2';
import {
  buildExecutionIdentityAttestationPredicate,
  verifyExecutionIdentityAttestation,
} from '../../../packages/mps-lu/src/execution/ExecutionIdentityAttestation';
import { getLuExecutionAuthorityVerifier } from '../../../packages/mps-lu/src/execution/LuExecutionAuthorityVerifier';
import { resolveCanonicalProjectContext } from '../../../src/application/resolveCanonicalProjectContext';
import { resolveCurrentProductRelease } from '../../../src/application/resolveCurrentProductRelease';

const PRIVATE_KEY_ENV = 'LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM';
const EXECUTION_CONTRACT_VERSION = 'lu-execution-identity-v1';

async function main(): Promise<void> {
  if (process.env[PRIVATE_KEY_ENV]) {
    throw new Error('LU_EXECUTION_IDENTITY_V3_VERIFY_REJECTED: verification process must not have the execution authority private key');
  }
  const [identityArtifactId, projectId, geometryArtifactId] = process.argv.slice(2);
  if (!identityArtifactId || !projectId || !geometryArtifactId) {
    throw new Error('LU_EXECUTION_IDENTITY_V3_VERIFY_REJECTED: identity-artifact-id, project-id and geometry-artifact-id are required');
  }

  const mimers = await MimersIntegration.create({ env: { ...process.env, MIMERS_REQUIRED: '1' }, forceMimers: true });
  const repo = mimers.artifactRepository;

  const geometry = await repo.resolve<LocalizationGeometryArtifact>({ artifact_id: geometryArtifactId, artifact_type: 'localization_geometry' });
  const canonicalContext = await resolveCanonicalProjectContext(projectId, repo);
  const currentRelease = await resolveCurrentProductRelease(repo);
  const registry = createLuRegistryRuntime();
  const capability = registry.resolveCapabilityByKey(LU_SITE_ASSESSMENT_CAPABILITY_KEY);
  if (!capability) throw new Error('LU_EXECUTION_IDENTITY_V3_VERIFY_REJECTED: LU capability unavailable');

  const geometryRef = { artifact_id: geometry.artifact_id, artifact_type: geometry.artifact_type } as const;
  const subject: ExecutionIdentitySubjectV3 = {
    site_id: canonicalContext.propertyIdentity,
    project_context_binding_ref: canonicalContext.contextBindingRef,
    product_release_ref: currentRelease.releaseRef,
    execution_contract_version: EXECUTION_CONTRACT_VERSION,
    localization_geometry_ref: geometryRef,
  };
  const deterministicSeed = deriveLuExecutionSeed({
    site_id: subject.site_id,
    project_id: projectId,
    project_context_ref: canonicalContext.projectContextRef,
    property_context_ref: canonicalContext.propertyContextRef,
    project_context_binding_ref: canonicalContext.contextBindingRef,
    product_release_ref: currentRelease.releaseRef,
    product_release_hash: currentRelease.releaseHash,
    execution_contract_version: EXECUTION_CONTRACT_VERSION,
    rule_registry_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
    localization_geometry_ref: geometryRef,
  });

  const identity = await repo.resolve<ExecutionIdentityArtifact>({ artifact_id: identityArtifactId, artifact_type: 'execution_identity' });
  const attestation = await repo.resolve(identity.signature_envelope_ref);

  const expectedPredicate = buildExecutionIdentityAttestationPredicate({
    execution_identity_id: identityArtifactId,
    actor_ref: { artifact_id: LU_EXECUTION_PRINCIPAL_ID, artifact_type: 'execution_identity' },
    capability_ref: { artifact_id: capability.artifact_id, artifact_type: capability.artifact_type },
    release_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
    site_id: subject.site_id,
    deterministic_seed: deterministicSeed,
  });

  const result = await verifyExecutionIdentityAttestation({
    identity,
    attestation: attestation as Parameters<typeof verifyExecutionIdentityAttestation>[0]['attestation'],
    expectedPredicate,
    authorityVerifier: getLuExecutionAuthorityVerifier(),
    expectedSubjectV3: subject,
  });
  if (!result.verified) {
    throw new Error(`LU_EXECUTION_IDENTITY_V3_VERIFY_REJECTED: fresh public-key-only verification failed (${(result as { reason?: string }).reason})`);
  }
  console.log(JSON.stringify({ verified: true, private_key_available: false, project_id: projectId, identity_artifact_id: identityArtifactId }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
