/**
 * VIEWER-IDENTITY-AUTHORITY-BOOTSTRAP-01 -- fresh-reopen verification-only child process.
 *
 * Spawned as a genuinely separate process with ONLY VIEWER_IDENTITY_ISSUER_PUBLIC_KEY_PEM (and
 * key id) set -- VIEWER_IDENTITY_ISSUER_PRIVATE_KEY_PEM is deliberately absent.
 */
import '../../server/loadEnvFirst';
import { MimersIntegration } from '@miljobeslut/mps-runtime';
import { verifyViewerIdentityArtifact } from '../../server/modules/localization/viewerIdentityAuthority';
import { getViewerIdentityVerifier } from '../../server/security/viewerIdentityVerifier';

async function main() {
  const artifactId = process.argv[2];
  const releaseId = process.argv[3];
  const releaseHash = process.argv[4];
  if (!artifactId || !releaseId || !releaseHash) {
    throw new Error('usage: _viewer-identity-fresh-reopen-verifier.ts <identityArtifactId> <releaseId> <releaseHash>');
  }

  const privateKeyEnvPresent = 'VIEWER_IDENTITY_ISSUER_PRIVATE_KEY_PEM' in process.env;
  const publicKeyEnvPresent = 'VIEWER_IDENTITY_ISSUER_PUBLIC_KEY_PEM' in process.env;

  try {
    const mimers = await MimersIntegration.create({ forceMimers: true });
    const identity = await verifyViewerIdentityArtifact({
      identityRef: { artifact_id: artifactId, artifact_type: 'viewer_identity' },
      repository: mimers.artifactRepository,
      verification: getViewerIdentityVerifier(),
      releaseId,
      releaseHash,
    });
    console.log(JSON.stringify({ ok: true, artifact_id: identity.artifact_id, privateKeyEnvPresent, publicKeyEnvPresent }));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error), privateKeyEnvPresent, publicKeyEnvPresent }));
  }
}

main().catch((error) => {
  console.log(JSON.stringify({ ok: false, error: `FATAL: ${error instanceof Error ? error.message : String(error)}` }));
  process.exitCode = 1;
});
