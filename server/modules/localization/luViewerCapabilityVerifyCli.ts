/**
 * PRODUCT-LU-VIEWER-CAPABILITY-PROVISIONING-01 Phase B.
 *
 * Fresh, standalone verification process spawned by luViewerCapabilityProvisioning.ts after
 * issuing (or reusing) a capability. Its own env has VIEWER_CAPABILITY_ISSUER_PRIVATE_KEY_PEM
 * deleted before spawn -- this file must never import getViewerCapabilitySigningProvider, only
 * the verifier. Same pattern as luExecutionIdentityV3VerifyCli.ts.
 *
 * Re-resolves the capability from CAS and verifies it against the pinned subject using only
 * public verification keys -- never trusts the worker's own in-process claim of what it minted.
 */
import '../../loadEnvFirst';
import { MimersIntegration } from '@miljobeslut/mps-runtime';
import type { ProductViewerCapabilityArtifact } from '@miljobeslut/mps-lu';
import { verifyProductViewerCapability } from './productViewerCapabilityAuthority';
import { getViewerCapabilityVerifier } from '../../security/viewerCapabilityVerifier';
import { ProjectContextBindingProvider } from './projectContextBindingRuntime';
import { PrismaProjectContextBindingIndex } from '../../repositories/projectContextBindingRepository';
import { getProjectContextBindingIssuerVerifier } from '../../security/projectContextBindingIssuerKey';

const PRIVATE_KEY_ENV = 'VIEWER_CAPABILITY_ISSUER_PRIVATE_KEY_PEM';

async function main(): Promise<void> {
  if (process.env[PRIVATE_KEY_ENV]) {
    throw new Error('VIEWER_CAPABILITY_VERIFY_REJECTED: verification process must not have the capability issuer private key');
  }
  const [capabilityArtifactId, projectId, bindingId, viewerIdentityId, releaseId, releaseHash] = process.argv.slice(2);
  if (!capabilityArtifactId || !projectId || !bindingId || !viewerIdentityId || !releaseId || !releaseHash) {
    throw new Error(
      'VIEWER_CAPABILITY_VERIFY_REJECTED: capability-artifact-id, project-id, binding-id, viewer-identity-id, release-id and release-hash are required',
    );
  }

  const mimers = await MimersIntegration.create({ env: { ...process.env, MIMERS_REQUIRED: '1' }, forceMimers: true });
  const repo = mimers.artifactRepository;

  const capability = await repo.resolve<ProductViewerCapabilityArtifact>({
    artifact_id: capabilityArtifactId,
    artifact_type: 'viewer_capability',
  });

  const currentBindingProvider = new ProjectContextBindingProvider(
    repo,
    new PrismaProjectContextBindingIndex(),
    getProjectContextBindingIssuerVerifier(),
  );

  await verifyProductViewerCapability({
    capability,
    repository: repo,
    verification: getViewerCapabilityVerifier(),
    projectId,
    bindingId,
    viewerIdentityId,
    releaseId,
    releaseHash,
    now: new Date(),
    currentBindingProvider,
  });

  console.log(JSON.stringify({ verified: true, private_key_available: false, project_id: projectId, capability_artifact_id: capabilityArtifactId }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
