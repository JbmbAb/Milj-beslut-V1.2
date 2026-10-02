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
