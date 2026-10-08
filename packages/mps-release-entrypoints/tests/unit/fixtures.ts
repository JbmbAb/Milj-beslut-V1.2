import { memoryTreeReader } from '../../src/treeReaders';

/** A small, internally consistent release tree: one web process, one worker, one non-production worker, two libraries. */
export function baseFiles(): Record<string, string> {
  return {
    'deploy/onprem/entrypoints.json': JSON.stringify(
      {
        schema: 'u51-entrypoints-1',
        entries: [
          { id: 'web', role: 'web', argv: ['npm', 'start'], entry_file: 'server/index.ts' },
          { id: 'worker-a', role: 'worker', argv: ['node', '--import', 'tsx', 'server/workers/a-worker.ts'], entry_file: 'server/workers/a-worker.ts' },
        ],
        not_production: [{ entry_file: 'server/workers/b-worker.ts', reason: 'Not a production root of this synthetic profile; it is a fixture for the tests.' }],
      },
      null,
      2,
    ),
    Dockerfile: ['FROM node:22 AS base', '# CMD ["node","server/workers/zzz.ts"] is only a comment', 'RUN echo hi', 'FROM base AS web', 'CMD ["npm", "start"]', 'FROM base AS b', 'CMD ["npx", "tsx", "server/workers/b-worker.ts"]'].join('\n'),
    'package.json': JSON.stringify({ scripts: { start: 'node --import tsx server/index.ts', 'worker:a': 'node --import tsx server/workers/a-worker.ts' } }),
    'deploy/onprem/image-smoke/smoke.mjs': "const ENTRYPOINTS = [\n  'server/index.ts',\n  'server/workers/a-worker.ts',\n];\n",
    'server/index.ts': "import './app';\nconsole.log('start');\n",
    'server/app.ts': 'export const app = 1;\n',
    'server/workers/a-worker.ts': "import { boot } from './bootstrap';\nasync function main() { boot(); }\nmain();\n",
    'server/workers/b-worker.ts': "import { boot } from './bootstrap';\nfunction main() { boot(); }\nmain();\n",
    'server/workers/bootstrap.ts': 'export function boot(): void {}\n',
    'server/workers/registry.ts': 'export function startAll(): void {}\n',
  };
}

export function baseTree(overrides: Record<string, string | null> = {}) {
  const files = baseFiles();
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) delete files[k];
    else files[k] = v;
  }
  return memoryTreeReader(files);
}
