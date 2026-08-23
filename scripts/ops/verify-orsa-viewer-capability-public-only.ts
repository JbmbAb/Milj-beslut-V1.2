/**
 * LEGACY / MANUAL. Ties to the manual ORSA reissue script below -- normal product use now
 * provisions and fresh-verifies ViewerCapability automatically
 * (server/workers/lu-viewer-capability-worker.ts, PRODUCT-LU-VIEWER-CAPABILITY-PROVISIONING-01).
 *
 * Fresh, independent verification process for the ORSA viewer capability provisioned by
 * scripts/ops/orsa-viewer-capability-reissue-01.ts. Must be launched with an environment that
 * contains ONLY public verification key material -- no *_PRIVATE_KEY_PEM variable of any kind.
 * Self-checks that before doing anything else, then reopens persistent state fresh and proves the
 * installed capability resolves as current using only VerificationKeyProvider material.
 */
import '../../server/loadEnvFirst';
import { MimersIntegration } from '@miljobeslut/mps-runtime';
import { verifyInstalledLocalizationViewerCapability } from '../../server/modules/localization/installLocalizationViewerCapability';
import { readLocalizationViewerRuntimeConfig } from '../../server/modules/localization/createLocalizationViewerRuntime';
import { ProjectContextBindingProvider } from '../../server/modules/localization/projectContextBindingRuntime';
import { PrismaProjectContextBindingIndex } from '../../server/repositories/projectContextBindingRepository';
import { getProjectContextBindingIssuerVerifier } from '../../server/security/projectContextBindingIssuerKey';

async function main() {
  const privateKeyEnvVars = Object.keys(process.env).filter((k) => /PRIVATE_KEY/i.test(k));
  if (privateKeyEnvVars.length > 0) {
    throw new Error(`PRIVATE KEY MATERIAL PRESENT IN THIS PROCESS: ${privateKeyEnvVars.join(', ')} -- verification voided.`);
  }
  console.log('SELF-CHECK PASS: no *PRIVATE_KEY* environment variable present in this process.');

  const config = readLocalizationViewerRuntimeConfig();
  console.log('Read runtime config from env (LU_VIEWER_*):', JSON.stringify(config));

  const mimers = await MimersIntegration.create({ forceMimers: true });
  const currentBindingProvider = new ProjectContextBindingProvider(
    mimers.artifactRepository,
    new PrismaProjectContextBindingIndex(),
    getProjectContextBindingIssuerVerifier(),
  );

  const runtime = await verifyInstalledLocalizationViewerCapability({
    artifactRepository: mimers.artifactRepository,
    config,
    currentBindingProvider,
  });

  console.log(
    JSON.stringify(
      {
        fresh_public_only_verification: 'PASS',
        capability_artifact_id: runtime.capability.artifact_id,
        release_hash: runtime.capability.release_hash.value,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error('FRESH VERIFICATION FAILED:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
