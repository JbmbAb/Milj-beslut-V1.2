/**
 * W-U402 (U40-2) -- the database URL of a process, without silent fallbacks.
 *
 * Spec U40-U50B §0 point 4 / §1.3, U40-A-DOCKER-VERIFICATION F2, owner queue decision (2026-10-02, BINDING: "U40-2 must
 * close the env fallback (DATABASE_URL deletion + localhost:5432 fallback)"): a container that received its
 * DATABASE_URL from the composition used to lose it (server/loadEnvFirst.ts deleted it so that env files would win), and
 * the database clients then fell back to localhost:5432 -- libpq's default in server/db/prisma.ts, a hard-coded
 * credential URL in the localization spatial runtime.
 *
 * Two rules, one place:
 *  - `isRuntimeEnvironmentAuthoritative`: NODE_ENV exactly 'production' OR PRESERVE_RUNTIME_ENV exactly 'true' -- the
 *    process environment (as the process was started) is the configuration, so an injected DATABASE_URL is kept.
 *    Exact, case-sensitive; nothing is trimmed or normalized into an allowed value. Anything else (development, an
 *    unset NODE_ENV) keeps the developer behaviour: the env files decide.
 *  - `requireDatabaseUrl`: a DATABASE_URL that is absent or blank is a refusal (DATABASE_URL_REQUIRED) naming the
 *    consumer and never a value; there is no default database.
 *
 * Side-effect free and dependency free: server/loadEnvFirst.ts imports it before anything else runs.
 */

export const DATABASE_URL_REQUIRED = 'DATABASE_URL_REQUIRED' as const;

export class DatabaseUrlRequiredError extends Error {
  readonly code = DATABASE_URL_REQUIRED;

  constructor(readonly consumer: string) {
    super(
      `${DATABASE_URL_REQUIRED}: DATABASE_URL is not set (or is blank) for ${consumer} ` +
        '(fail-closed: there is no default database and no localhost fallback; set DATABASE_URL explicitly ' +
        'in the environment of this process)',
    );
    this.name = 'DatabaseUrlRequiredError';
  }
}

type Env = Readonly<Record<string, string | undefined>>;

/** NODE_ENV exactly 'production' OR PRESERVE_RUNTIME_ENV exactly 'true'. */
export function isRuntimeEnvironmentAuthoritative(env: Env): boolean {
  return env.NODE_ENV === 'production' || env.PRESERVE_RUNTIME_ENV === 'true';
}

/** The DATABASE_URL, unchanged -- or DatabaseUrlRequiredError when it is absent or blank. */
export function requireDatabaseUrl(env: Env, consumer: string): string {
  const value = env.DATABASE_URL;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DatabaseUrlRequiredError(consumer);
  }
  return value;
}
