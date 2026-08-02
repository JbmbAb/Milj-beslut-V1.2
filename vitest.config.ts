import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@miljobeslut/mimers-brunn-core': path.resolve(
        __dirname,
        'packages/mimers-brunn-core/src/index.ts',
      ),
      '@miljobeslut/mps-core': path.resolve(
        __dirname,
        'packages/mps-core/src/index.ts',
      ),
      '@miljobeslut/mps-artifact-store': path.resolve(
        __dirname,
        'packages/mps-artifact-store/src/index.ts',
      ),
      '@miljobeslut/mps-replay': path.resolve(
        __dirname,
        'packages/mps-replay/src/index.ts',
      ),
      '@miljobeslut/mps-audit': path.resolve(
        __dirname,
        'packages/mps-audit/src/index.ts',
      ),
      '@miljobeslut/mps-telemetry': path.resolve(
        __dirname,
        'packages/mps-telemetry/src/index.ts',
      ),
      '@miljobeslut/mps-policy': path.resolve(
        __dirname,
        'packages/mps-policy/src/index.ts',
      ),
      '@miljobeslut/mps-evolution': path.resolve(
        __dirname,
        'packages/mps-evolution/src/index.ts',
      ),
      '@miljobeslut/mps-canonical': path.resolve(
        __dirname,
        'packages/mps-canonical/src/index.ts',
      ),
      '@miljobeslut/mps-benchmark': path.resolve(
        __dirname,
        'packages/mps-benchmark/src/index.ts',
      ),
      '@miljobeslut/mps-control-plane': path.resolve(
        __dirname,
        'packages/mps-control-plane/src/index.ts',
      ),
      '@miljobeslut/mps-console': path.resolve(
        __dirname,
        'packages/mps-console/src/index.ts',
      ),
    },
  },
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
        branches: 70,
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
