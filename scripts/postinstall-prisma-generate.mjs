#!/usr/bin/env node
/**
 * prisma generate requires DATABASE_URL in prisma.config.ts even though no DB connection is made.
 * CI/typecheck jobs set a dummy URL when none is configured.
 */
import { spawnSync } from 'node:child_process';

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://localhost:5432/postinstall_dummy';
}

const result = spawnSync('npx', ['prisma', 'generate'], {
  stdio: 'inherit',
  shell: true,
});

process.exit(result.status ?? 1);
