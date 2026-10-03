import { loadEnvFile } from '../loadEnv';
import { warnProductionDevFlags } from '../warnProductionDevFlags';

export function bootstrapWorkerProcess(): void {
  const preserveRuntimeEnv =
    process.env.PRESERVE_RUNTIME_ENV === 'true' ||
    Boolean(process.env.PLAYWRIGHT_LOCAL_API_PORT) ||
    process.env.NODE_ENV === 'test';
  loadEnvFile();
  loadEnvFile('.env.local', { overrideExisting: !preserveRuntimeEnv });
  warnProductionDevFlags();
}

/**
 * U30-A start gate for the LU workers: they persist governed artifacts in the one durable Mimers
 * CAS (PRES-19), so a worker without it must refuse to START, instead of starting and failing
 * every job one by one. Same gate as the web process (`assertMimersCasReady`): unconditional
 * outside an explicit test environment, no fallback directory, no memory CAS.
 *
 * Imported lazily so the non-LU workers do not load the Mimers runtime.
 */
export async function assertLuWorkerDurableCas(
  workerName: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const { assertMimersCasReady } = await import(
    '../../packages/mps-runtime/src/repository/createKernelArtifactRepository.js'
  );
  try {
    await assertMimersCasReady(env);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${workerName}: durable Mimers CAS is not ready -- refusing to start. ${detail}`, {
      cause: error,
    });
  }
}

/**
 * W-U42 release-identity start gate for the LU workers -- the same gate as the web process
 * (`assertProductReleaseIdentityAtStartup`): the worker re-measures the files it runs and refuses to START unless
 * they are the build the configured product release (PRODUCT_RELEASE_ARTIFACT_ID) was issued for; without
 * release-identity.json and release id only an explicit development/test process starts, and then without identity.
 * Logs the worker's release id, digest and CAS root at start (no secrets). Imported lazily like the CAS gate.
 */
export async function assertLuWorkerProductReleaseIdentity(
  workerName: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const { assertProductReleaseIdentityAtStartup } = await import('../modules/release/productReleaseStartup');
  try {
    await assertProductReleaseIdentityAtStartup({ role: workerName, env });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${workerName}: release identity check failed -- refusing to start. ${detail}`, {
      cause: error,
    });
  }
}
