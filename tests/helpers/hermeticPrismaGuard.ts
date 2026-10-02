/**
 * DEMO M1a-repair (F3). Hermetic stand-in for `server/db/prisma` in unit tests that must never
 * reach a real database.
 *
 * Why a module mock and not "just unset DATABASE_URL": server/db/prisma.ts loads `.env.local` from
 * the current working directory whenever DATABASE_URL is unset, and in a developer worktree that
 * file can name the live database. Replacing the module means the real file is never evaluated, so
 * no env file is read, no pool is created and no query can be sent -- whatever the shell or cwd.
 *
 * Usage (in the test file, next to the other vi.mock calls):
 *
 *   vi.mock('../../server/db/prisma', async () =>
 *     (await import('../helpers/hermeticPrismaGuard')).hermeticPrismaModule());
 *
 * Every property read on `prisma` or `Prisma` is recorded in `hermeticPrismaTouches` and throws, so
 * a test that silently depends on a database fails loudly instead of passing against whatever
 * database the environment happens to resolve. Tests assert `hermeticPrismaTouches` stays empty.
 */
export const hermeticPrismaTouches: string[] = [];

function guard(name: string): object {
  return new Proxy(
    {},
    {
      get(_target, property) {
        // Not a database access: symbol probes (inspection, iteration) and thenable checks.
        if (typeof property === 'symbol' || property === 'then') return undefined;
        const touch = `${name}.${String(property)}`;
        hermeticPrismaTouches.push(touch);
        throw new Error(`HERMETIC_TEST_GUARD: real database client reached (${touch})`);
      },
    },
  );
}

export function hermeticPrismaModule(): { prisma: object; Prisma: object } {
  return { prisma: guard('prisma'), Prisma: guard('Prisma') };
}
