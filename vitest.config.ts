import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  test: {
    globalSetup: 'tests/setup/database.ts',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      // Trösklar: höj stegvis (t.ex. 85 → 88) när baseline är grön; `npm run coverage:gaps` visar var fokus ska ligga.
      thresholds: {
        lines: 85,
        branches: 85,
        functions: 85,
        statements: 85,
      },
    },
    projects: [
      {
        plugins: [react()],
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
          exclude: ['tests/unit/bankIdService.test.ts'], // Keep existing exclusion if intentional
          environment: 'jsdom',
          setupFiles: ['tests/setup/env.ts'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'component',
          include: ['tests/components/**/*.test.tsx'],
          environment: 'jsdom',
          globals: true,
          setupFiles: ['tests/setup/setupTests.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts', 'tests/smoke/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['tests/setup/env.ts', 'tests/setup/integrationCsrfBypass.ts'],
          testTimeout: 30000,
          hookTimeout: 30000,
          fileParallelism: false,
        },
      },
    ],
  },
});
