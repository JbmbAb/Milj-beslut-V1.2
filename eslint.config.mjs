import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'coverage',
      'playwright-report',
      'test-results',
      'node_modules',
      '.codex-logs/**',
      '.postqode/**',
      '.tmp-*',
      '.tmp-*.*',
      'figma-plugin/**',
      '**/__pycache__/**',
      'scripts/build-tokens-css.mjs',
      'tmp_*',
      'tmp_*.*',
      'tmp-*',
      'tmp-*.*',
      'scripts/test-api.js',
      'raw_test.ts',
      'diag_gemini.ts',
      'tmp-*.csv',
      'tmp-*.html',
      'tmp-*.json',
      'tmp-*.log',
      // Legacy root-level utility/git/push/verify scripts (not part of the app)
      'verify-antireplay.mjs',
      'verify-tests.mjs',
      'verify-git.js',
      'commit-via-api.js',
      'check-gh-cli.js',
      'cleanup-old-tests.mjs',
      'exec-git-direct.js',
      'git-push-tests.mjs',
      'git-push.js',
      'git-stage-commit.js',
      'push-tests-github.js',
      'push-tests-to-github.js',
      'push-tests.js',
      'push-via-api.js',
      'push-with-spawn.js',
      'run-commit.js',
      'scripts/push-tests-github-api.mjs',
      'scripts/verify-repository-coverage.mjs',
      // Diagnostic / one-off scripts
      'scripts/diag/**',
      'scripts/gather-report-to-desktop.ts',
      'scripts/import/extract-deep-ai.ts',
      'scripts/test-write.ts',
      'scratch/**',
      '.cursor/**',
      '.agents/**',
      'clean-migration.cjs',
      'search.js',
      'scripts/**/*.cjs',
      'scripts/**/*.mjs',
      'get_domstol_api.ts',
      'scripts/verify-bankid-test.mjs',
      'scripts/generate-lokaliseringsutredning.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        require: 'readonly',
        module: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
      },
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/immutability': 'off',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-control-regex': 'off',
      // TypeScript's own type checker validates identifier names; ESLint's no-undef
      // creates false positives for Node.js globals (Buffer, setTimeout, fetch, etc.)
      // and for ambient declarations from @types/* packages.
      'no-undef': 'off',
    },
  },
  {
    // Allow require() in plain .js files that have not been converted to ESM
    files: ['**/*.js'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['cleanup.js', 'scripts/diag/cleanup.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        __dirname: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-regex-spaces': 'off',
    },
  },
  {
    files: ['public/sw.js'],
    languageOptions: {
      globals: {
        self: 'readonly',
        caches: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
      },
    },
  },
);
