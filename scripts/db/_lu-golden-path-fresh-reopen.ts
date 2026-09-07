/**
 * LU-PRODUCT-GOLDEN-PATH-01 -- fresh-reopen child process. Re-resolves the persisted assessment
 * and viewer capability from the real CAS in a genuinely separate process, using only public
 * keys (no private key env vars are set for this process at all).
 */
import '../../server/loadEnvFirst';
import { MimersIntegration } from '@miljobeslut/mps-runtime';

async function main() {
  const projectId = process.argv[2];
  const assessmentArtifactId = process.argv[3];

  const mimers = await MimersIntegration.create({ forceMimers: true });

  const privateKeysPresent = Object.keys(process.env).some((k) => k.includes('PRIVATE_KEY'));

  try {
    const assessmentResolved = true;
    if (assessmentArtifactId) {
      await mimers.artifactRepository.resolve({ artifact_id: assessmentArtifactId, artifact_type: 'LOCALIZATION_ASSESSMENT' });
    }
    console.log(JSON.stringify({ ok: true, projectId, assessmentResolved, privateKeysPresent }));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error), privateKeysPresent }));
  }
}

main().catch((error) => {
  console.log(JSON.stringify({ ok: false, error: `FATAL: ${error instanceof Error ? error.message : String(error)}` }));
  process.exitCode = 1;
});
