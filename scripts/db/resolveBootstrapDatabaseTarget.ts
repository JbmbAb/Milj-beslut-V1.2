export class BootstrapDatabaseTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BootstrapDatabaseTargetError';
  }
}

export type BootstrapDatabaseTarget = {
  databaseUrl: string;
  databaseName: string;
};

function parseDatabaseName(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl.replace(/^postgresql:\/\//, 'postgres://'));
    return decodeURIComponent(url.pathname.replace(/^\//, '')).split('/')[0] || '';
  } catch {
    throw new BootstrapDatabaseTargetError('DATABASE_URL is malformed.');
  }
}

/**
 * Fail-closed gate for destructive-capable bootstrap operations.
 * Requires explicit operator confirmation via DB_BOOTSTRAP_CONFIRM=yes.
 */
export function resolveBootstrapDatabaseTarget(
  env: Record<string, string | undefined>,
): BootstrapDatabaseTarget {
  const databaseUrl = String(env.DATABASE_URL || '').trim();
  if (!databaseUrl) {
    throw new BootstrapDatabaseTargetError('DATABASE_URL is required for database bootstrap.');
  }

  const confirm = String(env.DB_BOOTSTRAP_CONFIRM || '')
    .trim()
    .toLowerCase();
  if (confirm !== 'yes') {
    throw new BootstrapDatabaseTargetError(
      'Refusing bootstrap without DB_BOOTSTRAP_CONFIRM=yes (operator gate).',
    );
  }

  const databaseName = parseDatabaseName(databaseUrl);
  if (!databaseName) {
    throw new BootstrapDatabaseTargetError('DATABASE_URL must include a database name.');
  }

  return { databaseUrl, databaseName };
}
