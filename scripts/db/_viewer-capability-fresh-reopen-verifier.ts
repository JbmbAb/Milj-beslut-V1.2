/**
 * VIEWER-CAPABILITY-ISSUER-TRUST-CHAIN-V1 -- fresh-reopen verification-only child process.
 *
 * Spawned as a genuinely separate process with ONLY VIEWER_CAPABILITY_ISSUER_PUBLIC_KEY_PEM (and
 * key id) set -- VIEWER_CAPABILITY_ISSUER_PRIVATE_KEY_PEM is deliberately absent. Resolves the
 * persisted capability from the real Mimer CAS by artifact_id and verifies it.
 */
import '../../server/loadEnvFirst';
import { MimersIntegration } from '@miljobeslut/mps-runtime';
import type { ProductViewerCapabilityArtifact } from '@miljobeslut/mps-lu';
import { verifyProductViewerCapability } from '../../server/modules/localization/productViewerCapabilityAuthority';
import { getViewerCapabilityVerifier } from '../../server/security/viewerCapabilityVerifier';

async function main() {
  const artifactId = process.argv[2];
  if (!artifactId) throw new Error('usage: _viewer-capability-fresh-reopen-verifier.ts <artifactId>');

  const privateKeyEnvPresent = 'VIEWER_CAPABILITY_ISSUER_PRIVATE_KEY_PEM' in process.env;
  const publicKeyEnvPresent = 'VIEWER_CAPABILITY_ISSUER_PUBLIC_KEY_PEM' in process.env;

  try {
    const mimers = await MimersIntegration.create({ forceMimers: true });
    const capability = await mimers.artifactRepository.resolve<ProductViewerCapabilityArtifact>({
      artifact_id: artifactId,
      artifact_type: 'viewer_capability',
    });
    await verifyProductViewerCapability({
      capability,
      repository: mimers.artifactRepository,
      verification: getViewerCapabilityVerifier(),
      projectId: capability.payload.subject_project_id,
      bindingId: capability.payload.project_context_binding_ref.artifact_id,
      viewerIdentityId: capability.payload.viewer_identity_ref.artifact_id,
      releaseId: capability.payload.product_release_ref.artifact_id,
      releaseHash: capability.payload.product_release_hash,
      now: new Date('2026-08-21T12:00:00.000Z'),
    });
    console.log(JSON.stringify({ ok: true, artifact_id: capability.artifact_id, privateKeyEnvPresent, publicKeyEnvPresent }));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error), privateKeyEnvPresent, publicKeyEnvPresent }));
  }
}

main().catch((error) => {
  console.log(JSON.stringify({ ok: false, error: `FATAL: ${error instanceof Error ? error.message : String(error)}` }));
  process.exitCode = 1;
});
