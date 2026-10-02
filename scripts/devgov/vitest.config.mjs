import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * TEST-DB-GUARD (OD-K0-5), TDG-3 N2: like every other test config in this repository, Vite reads
 * no `.env*` file (`envDir: false` -- NODE_ENV=test never loads `.env.local`), and the guard is the
 * first setup file. Absolute, so it holds whatever --root a run uses.
 *
 * @see tests/setup/testDatabaseGuard.ts
 * @see tests/unit/testDbGuardTestConfigInventory.test.ts
 */
const TEST_DB_GUARD_SETUP = fileURLToPath(new URL('../../tests/setup/testDatabaseGuard.ts', import.meta.url));

export default defineConfig({
  envDir: false,
  test: {
    globals: true,
    environment: 'node',
    include: ['scripts/audit/devgov*.test.ts'],
    setupFiles: [TEST_DB_GUARD_SETUP],
  },
});
