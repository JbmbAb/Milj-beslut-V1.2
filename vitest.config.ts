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
      // Live HTTP shims without archived PostGIS equivalents (Mimers Brunn policy).
      exclude: [
        'server/services/vissService.ts',
        'server/services/nmdService.ts',
        'server/services/vertexAiService.ts',
        'server/services/outlookGraphClient.ts',
        'services/chemicalApi.ts',
        'services/sewageApi.ts',
      ],
      // Baseline after unit+integration coverage (2026-06). Ramp: 72 → 75 → 80 → 85.
      thresholds: {
        lines: 69,
        branches: 58,
        functions: 70,
        statements: 68,
      },
    },
    projects: [
      {
        plugins: [react()],
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.{test,spec}.ts', 'tests/unit/**/*.{test,spec}.tsx'],
          exclude: ['tests/unit/server.services.bankIdService.test.ts'],
          environment: 'jsdom',
          setupFiles: ['tests/setup/env.ts'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'component',
          include: ['tests/components/**/*.{test,spec}.tsx'],
          environment: 'jsdom',
          globals: true,
          setupFiles: ['tests/setup/setupTests.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.{test,spec}.ts', 'tests/smoke/**/*.{test,spec}.ts'],
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
