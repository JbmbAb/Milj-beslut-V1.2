import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * TEST-DB-GUARD (OD-K0-5), TDG-3 N2: `npm test` in this package (`vitest run`) uses this config.
 * Like every other test config in this repository: Vite reads no `.env*` file, and the guard is
 * the first setup file (absolute: the run's root is this package directory).
 *
 * @see tests/unit/testDbGuardTestConfigInventory.test.ts
 */
const TEST_DB_GUARD_SETUP = fileURLToPath(new URL('../../tests/setup/testDatabaseGuard.ts', import.meta.url));

export default defineConfig({
  envDir: false,
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: [TEST_DB_GUARD_SETUP],
  },
});
