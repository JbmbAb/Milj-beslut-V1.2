import { logger } from './logger';

function isTruthyEnv(key: string): boolean {
  return (
    String(process.env[key] ?? '')
      .trim()
      .toLowerCase() === 'true'
  );
}

/**
 * Loggar allvarlig varning om utvecklings-mockar är aktiva när NODE_ENV=production.
 * Ska inte köras före loadEnvFile() i server/index.ts.
 */
export function warnProductionDevFlags(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const flags: string[] = [];
  if (isTruthyEnv('BANKID_MOCK_MODE')) flags.push('BANKID_MOCK_MODE');
  if (isTruthyEnv('AUTHORITY_MOCK_MODE')) flags.push('AUTHORITY_MOCK_MODE');

  if (flags.length === 0) return;

  logger.error('Production configuration uses development mock flags — disable before go-live', {
    flags,
    hint: 'Unset these in Secret Manager / Cloud Run env (BankID may require real certs; authority submit requires live endpoint).',
  });
}
