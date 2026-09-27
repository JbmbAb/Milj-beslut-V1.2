// DEMO-01 local API: runs server/index.ts from the worktree root with the demo flag on.
// Usage: node --import tsx scripts/demo01/dev-api.mjs   (or with an absolute tsx loader path)
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.chdir(root); // .env/.env.local and .data/demo-01 resolve from cwd
process.env.PRESERVE_RUNTIME_ENV = 'true'; // keep the values below; .env.local must not override them
process.env.NODE_ENV ??= 'development';
process.env.PORT ??= '8797';
process.env.DEMO_C_ANMALAN_ENABLED ??= 'true';
process.env.ALLOW_DEV_LOGIN ??= 'true';
await import(pathToFileURL(path.join(root, 'server/index.ts')).href);
