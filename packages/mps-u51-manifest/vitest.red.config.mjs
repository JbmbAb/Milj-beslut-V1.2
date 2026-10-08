// U51-CANONICAL-MANIFEST-CONTRACT-01 -- dedicated config for the RED-only contract pins.
// Deliberately NOT referenced from the root vitest.config.ts: these tests are expected to fail until the
// verifier core exists, so they must never join default discovery (npm test / CI). Run explicitly:
//   npx vitest run --config packages/mps-u51-manifest/vitest.red.config.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  test: {
    name: 'u51-manifest-red',
    environment: 'node',
    include: ['tests/**/*.red.test.ts'],
    exclude: ['**/node_modules/**'],
  },
});
