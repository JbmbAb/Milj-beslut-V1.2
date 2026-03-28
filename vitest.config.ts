import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      thresholds: {
        lines: process.env.CI ? 75 : 10,
        branches: process.env.CI ? 75 : 10,
        functions: process.env.CI ? 75 : 10,
        statements: process.env.CI ? 75 : 10,
      },
    },
    projects: [
      {
        plugins: [react()],
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['tests/setup/env.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['tests/setup/env.ts'],
          testTimeout: 30000,
          hookTimeout: 30000,
        },
      },
    ],
  },
});
