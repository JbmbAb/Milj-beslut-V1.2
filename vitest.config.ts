import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['tests/setup/env.ts'],
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
      exclude: [
        'components/**',
        'scripts/**',
        'tests/**',
        'db.server.ts',
        'types.ts',
        'constants.ts',
        '**/*.config.*',
        '**/*.d.ts',
        'node_modules/**',
        'src/ui/**',
        'src/infrastructure/**',
        'src/types/**',
        'src/api/platform.master.ts',
        'src/platform/audit.service.ts',
        'src/application/get-property-details.usecase.ts',
        'server/**',
        'services/**',
      ],
    },
    projects: [
      {
        plugins: [react()],
        test: {
          name: 'unit',
          include: ['**/unit/**/*.test.ts', '**/unit/**/*.test.tsx'],
          exclude: ['tests/unit/server.services.bankIdService.test.ts'],
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
          globalSetup: 'tests/setup/database.ts',
          include: ['tests/integration/**/*.test.ts', 'tests/smoke/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['tests/setup/env.ts', 'tests/setup/integrationCsrfBypass.ts'],
          testTimeout: 30000,
          hookTimeout: 30000,
          fileParallelism: false,
          maxConcurrency: 1,
        },
      },

    ],
  },
});
