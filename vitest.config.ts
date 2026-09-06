import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * Paths that are inside the checkout but are NOT this repository's own tests.
 *
 * @see tests/unit/testDiscoveryWorktreeIsolation.test.ts
 */
const WORKTREE_EXCLUDES = ['**/.claude/worktrees/**', '.claude/worktrees/**'];

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
      '@miljobeslut/mps-compass': path.resolve(
        __dirname,
        'packages/mps-compass/src/index.ts',
      ),
      '@miljobeslut/mps-identity': path.resolve(
        __dirname,
        'packages/mps-identity/src/index.ts',
      ),
      '@miljobeslut/mps-lu': path.resolve(
        __dirname,
        'packages/mps-lu/src/index.ts',
      ),
      '@miljobeslut/mps-data-governance': path.resolve(
        __dirname,
        'packages/mps-data-governance/src/ImportGate.ts',
      ),
      '@miljobeslut/mps-diagnostics': path.resolve(
        __dirname,
        'packages/mps-diagnostics/src/index.ts',
      ),
      '@miljobeslut/mps-retrieval-governance': path.resolve(
        __dirname,
        'packages/mps-retrieval-governance/src/index.ts',
      ),
      '@miljobeslut/mps-query-budget': path.resolve(
        __dirname,
        'packages/mps-query-budget/src/index.ts',
      ),
      '@miljobeslut/mps-retrieval-trace': path.resolve(
        __dirname,
        'packages/mps-retrieval-trace/src/index.ts',
      ),
      '@miljobeslut/mps-cas-boundary': path.resolve(
        __dirname,
        'packages/mps-cas-boundary/src/index.ts',
      ),
      '@miljobeslut/mps-governance-runtime': path.resolve(
        __dirname,
        'packages/mps-governance-runtime/src/index.ts',
      ),
      '@miljobeslut/mps-chunking': path.resolve(
        __dirname,
        'packages/mps-chunking/src/index.ts',
      ),
      '@miljobeslut/mps-text-projection': path.resolve(
        __dirname,
        'packages/mps-text-projection/src/index.ts',
      ),
      '@miljobeslut/mps-legal-corpus': path.resolve(
        __dirname,
        'packages/mps-legal-corpus/src/index.ts',
      ),
      // KNOWLEDGE-K2.2-GOVERNED-CORPUS-EXPANSION-EVAL-V1
      '@miljobeslut/mps-knowledge-corpus': path.resolve(
        __dirname,
        'packages/mps-knowledge-corpus/src/index.ts',
      ),
      '@miljobeslut/mps-knowledge-index': path.resolve(
        __dirname,
        'packages/mps-knowledge-index/src/index.ts',
      ),
      '@miljobeslut/mps-knowledge-eval': path.resolve(
        __dirname,
        'packages/mps-knowledge-eval/src/index.ts',
      ),
      '@miljobeslut/spatial-provider-postgis': path.resolve(
        __dirname,
        'packages/spatial-provider-postgis/src/index.ts',
      ),
    },
  },
  test: {
    globals: true,
    setupFiles: ['tests/setup/env.ts'],
    /**
     * TEST_DISCOVERY_WORKTREE_ISOLATION-01 — proof runs must be hermetic.
     *
     * `.claude/worktrees/` holds other agents' checkouts of THIS repository, each with a full
     * copy of the test tree. Collecting them made the discovered set depend on which agent
     * worktrees happened to exist on the machine: same HEAD, different external state,
     * different test collection. Every suite result used as a release proof inherited that.
     *
     * Declared here rather than as a `--exclude` flag per command, because an isolation rule
     * each invocation must remember is one some invocation will forget, silently.
     *
     * Narrow on purpose: only the path the recon proved. No blanket hidden-directory rule.
     */
    exclude: [...WORKTREE_EXCLUDES, '**/node_modules/**', '**/dist/**'],
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
        'packages/**',
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
        // Explicit, not inherited: same root-level-does-not-reach-projects behavior noted in
        // the compliance project below. tests/unit/*.test.ts files that exercise server code
        // wired against mps-legal-corpus/mps-chunking (LEGAL-CORPUS-MATERIALIZATION-V1) need
        // these aliases resolvable here, not just under the compliance project.
        resolve: {
          alias: {
            '@miljobeslut/mps-legal-corpus': path.resolve(
              __dirname,
              'packages/mps-legal-corpus/src/index.ts',
            ),
            '@miljobeslut/mps-chunking': path.resolve(
              __dirname,
              'packages/mps-chunking/src/index.ts',
            ),
            // LEGAL-RETRIEVAL-LAW-METADATA-ROUTING-01: tests/unit/*.test.ts exercising the
            // routing module's trace integration need this resolvable here too, same reason as
            // the two aliases above.
            '@miljobeslut/mps-retrieval-trace': path.resolve(
              __dirname,
              'packages/mps-retrieval-trace/src/index.ts',
            ),
            // LEGAL-RETRIEVAL-PRODUCTION-COMPOSITION-01: same reason again.
            '@miljobeslut/mps-embedding-identity': path.resolve(
              __dirname,
              'packages/mps-embedding-identity/src/index.ts',
            ),
            '@miljobeslut/mps-legal-retrieval-contract': path.resolve(
              __dirname,
              'packages/mps-legal-retrieval-contract/src/index.ts',
            ),
            '@miljobeslut/mps-retrieval-governance': path.resolve(
              __dirname,
              'packages/mps-retrieval-governance/src/index.ts',
            ),
            // LEGAL-RETRIEVAL-RAG-ANSWER-COMPOSITION-01: same reason again.
            '@miljobeslut/mps-legal-answer-contract': path.resolve(
              __dirname,
              'packages/mps-legal-answer-contract/src/index.ts',
            ),
            // KNOWLEDGE-K2.2: server/modules/legal/materialization/ChunkAdmission.ts is now a
            // re-export of the corpus package, so its tests/unit test needs this alias too.
            '@miljobeslut/mps-knowledge-corpus': path.resolve(
              __dirname,
              'packages/mps-knowledge-corpus/src/index.ts',
            ),
            '@miljobeslut/mps-text-projection': path.resolve(
              __dirname,
              'packages/mps-text-projection/src/index.ts',
            ),
          },
        },
        test: {
          name: 'unit',
          include: ['**/unit/**/*.test.ts', '**/unit/**/*.test.tsx'],
          // merged: a second `exclude` key would override WORKTREE_EXCLUDES silently.
          exclude: [...WORKTREE_EXCLUDES, 'tests/unit/server.services.bankIdService.test.ts'],
          environment: 'jsdom',
          setupFiles: ['tests/setup/env.ts'],
          testTimeout: 20000,
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'component',
          exclude: [...WORKTREE_EXCLUDES],
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
          exclude: [...WORKTREE_EXCLUDES],
          include: ['tests/integration/**/*.test.ts', 'tests/smoke/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['tests/setup/env.ts', 'tests/setup/integrationCsrfBypass.ts'],
          testTimeout: 30000,
          hookTimeout: 30000,
          fileParallelism: false,
          maxConcurrency: 1,
        },
      },
      {
        resolve: {
          alias: {
            '@miljobeslut/spatial-provider-postgis': path.resolve(
              __dirname,
              'packages/spatial-provider-postgis/src/index.ts',
            ),
            '@miljobeslut/mps-lu': path.resolve(
              __dirname,
              'packages/mps-lu/src/index.ts',
            ),
            '@miljobeslut/mps-runtime': path.resolve(
              __dirname,
              'packages/mps-runtime/src/index.ts',
            ),
            // Explicit, not inherited: this project already needed its own overrides for the
            // three aliases above even though they also exist at root level — evidence that
            // root-level `resolve.alias` does not reliably reach vitest `projects` entries in
            // this setup. mps-legal-corpus's tests import both of these directly, so they're
            // added here rather than assumed to fall through from the top-level config.
            '@miljobeslut/mimers-brunn-core': path.resolve(
              __dirname,
              'packages/mimers-brunn-core/src/index.ts',
            ),
            '@miljobeslut/mps-core': path.resolve(
              __dirname,
              'packages/mps-core/src/index.ts',
            ),
            '@miljobeslut/mps-legal-corpus': path.resolve(
              __dirname,
              'packages/mps-legal-corpus/src/index.ts',
            ),
            // LEGAL-RETRIEVAL-IDENTITY-CONTRACT-01: mps-legal-retrieval-contract's tests import
            // these three by package name (cross-package), unlike mps-retrieval-governance's and
            // mps-retrieval-trace's OWN tests, which only ever use relative '../src/...' imports
            // and so never needed this alias before now.
            '@miljobeslut/mps-embedding-identity': path.resolve(
              __dirname,
              'packages/mps-embedding-identity/src/index.ts',
            ),
            '@miljobeslut/mps-retrieval-governance': path.resolve(
              __dirname,
              'packages/mps-retrieval-governance/src/index.ts',
            ),
            '@miljobeslut/mps-retrieval-trace': path.resolve(
              __dirname,
              'packages/mps-retrieval-trace/src/index.ts',
            ),
            '@miljobeslut/mps-legal-retrieval-contract': path.resolve(
              __dirname,
              'packages/mps-legal-retrieval-contract/src/index.ts',
            ),
            '@miljobeslut/mps-legal-answer-contract': path.resolve(
              __dirname,
              'packages/mps-legal-answer-contract/src/index.ts',
            ),
            // KNOWLEDGE-K2.2-GOVERNED-CORPUS-EXPANSION-EVAL-V1
            '@miljobeslut/mps-knowledge-corpus': path.resolve(
              __dirname,
              'packages/mps-knowledge-corpus/src/index.ts',
            ),
            '@miljobeslut/mps-knowledge-index': path.resolve(
              __dirname,
              'packages/mps-knowledge-index/src/index.ts',
            ),
            '@miljobeslut/mps-knowledge-eval': path.resolve(
              __dirname,
              'packages/mps-knowledge-eval/src/index.ts',
            ),
          },
        },
        test: {
          name: 'compliance',
          exclude: [...WORKTREE_EXCLUDES],
          include: [
            'packages/mps-compliance/**/*.test.ts',
            'packages/mps-runtime/**/*.test.ts',
            'packages/mps-artifact-store/**/*.test.ts',
            'packages/mps-lu/**/*.test.ts',
            'packages/mps-data-governance/**/*.test.ts',
            'packages/mps-decision-governance/**/*.test.ts',
            'packages/mps-materialization/**/*.test.ts',
            'packages/mps-diagnostics/**/*.test.ts',
            'packages/mps-retrieval-governance/**/*.test.ts',
            'packages/mps-query-budget/**/*.test.ts',
            'packages/mps-retrieval-trace/**/*.test.ts',
            'packages/mps-runtime-snapshot/**/*.test.ts',
            'packages/mps-cas-boundary/**/*.test.ts',
            'packages/mps-governance-runtime/**/*.test.ts',
            'packages/mps-chunking/**/*.test.ts',
            'packages/mps-text-projection/**/*.test.ts',
            'packages/mps-legal-corpus/**/*.test.ts',
            'packages/mps-embedding-identity/**/*.test.ts',
            'packages/mps-legal-retrieval-contract/**/*.test.ts',
            'packages/mps-legal-answer-contract/**/*.test.ts',
            'packages/spatial-provider-postgis/**/*.test.ts',
            'scripts/audit/**/*.test.ts',
            // KNOWLEDGE-K2.2-GOVERNED-CORPUS-EXPANSION-EVAL-V1
            'packages/mps-knowledge-corpus/**/*.test.ts',
            'packages/mps-knowledge-index/**/*.test.ts',
            'packages/mps-knowledge-eval/**/*.test.ts',
          ],
          environment: 'node',
          setupFiles: ['tests/setup/env.ts'],
        },
      },

    ],
  },
});
