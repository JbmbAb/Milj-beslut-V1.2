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
