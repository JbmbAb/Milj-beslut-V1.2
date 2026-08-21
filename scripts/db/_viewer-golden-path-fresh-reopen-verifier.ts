/**
 * VIEWER-IDENTITY-AUTHORITY-BOOTSTRAP-01 -- step 7 fresh-reopen verification-only child process.
 *
 * Spawned with ONLY public keys for both VIEWER_IDENTITY_ISSUER_V1 and VIEWER_CAPABILITY_ISSUER_V1
 * set (both private keys deliberately absent). Reads runtime config from env
 * (LU_VIEWER_CAPABILITY_ARTIFACT_ID etc.), resolves + verifies the full V2 chain, and proves
 * ViewerKernel.exportAsGeoJSON against the one proof-fixture evidence artifact.
 */
import '../../server/loadEnvFirst';
import { createLocalizationViewerRuntime } from '../../server/modules/localization/createLocalizationViewerRuntime';

async function main() {
  const evidenceArtifactId = process.argv[2];
  if (!evidenceArtifactId) throw new Error('usage: _viewer-golden-path-fresh-reopen-verifier.ts <evidenceArtifactId>');

  const privateKeysPresent = [
    'VIEWER_IDENTITY_ISSUER_PRIVATE_KEY_PEM' in process.env,
    'VIEWER_CAPABILITY_ISSUER_PRIVATE_KEY_PEM' in process.env,
  ].some(Boolean);
  const publicKeysPresent = [
    'VIEWER_IDENTITY_ISSUER_PUBLIC_KEY_PEM' in process.env,
    'VIEWER_CAPABILITY_ISSUER_PUBLIC_KEY_PEM' in process.env,
  ].every(Boolean);

  try {
    const runtime = await createLocalizationViewerRuntime();
    const exported = await runtime.viewer.exportAsGeoJSON([evidenceArtifactId]);
    console.log(JSON.stringify({
      ok: true,
      capability_artifact_id: runtime.capability.artifact_id,
      viewer_identity_ref: runtime.capability.viewer_identity_ref.artifact_id,
      exported_feature_count: exported.features.length,
      exported_properties: exported.features[0]?.properties ?? null,
      privateKeysPresent,
      publicKeysPresent,
    }));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error), privateKeysPresent, publicKeysPresent }));
  }
}

main().catch((error) => {
  console.log(JSON.stringify({ ok: false, error: `FATAL: ${error instanceof Error ? error.message : String(error)}` }));
  process.exitCode = 1;
});
