// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * W-U42 (U42a, point 3) -- the running release is visible in the API, the liveness probe says nothing about it, and
 * every process logs its identity at start.
 *
 *  - Owner decision 2026-10-02 row 7 (DP-23): authenticated `GET /api/release` + a MINIMAL `/health` without release
 *    details. `/api/release` carries the running release id, hash, contract version, the full build identity (commit,
 *    tree, digest, composition hash, build args hash, the three file hashes) and what the process measured itself;
 *    never a secret, never a path, never a word about authenticity or verification of assessments.
 *  - A process that started without a release identity (explicit development/test process) answers
 *    PRODUCT_RELEASE_IDENTITY_UNAVAILABLE (503) instead of inventing one.
 *  - The web process and the four LU workers call the start-up gate before they serve or poll (source pins).
 *
 * Hermetic: a bare express app with the release router, a hermetic Prisma stand-in (any database touch fails the
 * test), tokens signed with the test JWT secret, no CAS, no network.
 */

vi.mock('../../server/db/prisma', async () => (await import('../helpers/hermeticPrismaGuard')).hermeticPrismaModule());
vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
}));
vi.mock('../../server/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { createTokenPair } from '../../server/security/auth';
import releaseRouter from '../../server/routes/release.routes';
import { PRODUCT_RELEASE_IDENTITY_UNAVAILABLE } from '../../server/modules/release/productReleaseBuildIdentity';
import {
  resetRunningProductReleaseForTests,
  setRunningProductRelease,
  type RunningProductRelease,
} from '../../server/modules/release/runningProductRelease';
import { hermeticPrismaTouches } from '../helpers/hermeticPrismaGuard';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const app = express();
app.use(express.json());
app.use(releaseRouter);

const token = (role: 'USER' | 'ADMIN' = 'USER') =>
  createTokenPair({ id: `user-u42-${role.toLowerCase()}`, organisationId: 'org-u42', bankidId: `bankid:u42-${role}`, role }).accessToken;
const get = (withToken: boolean | 'USER' | 'ADMIN' = 'USER') => {
  const r = request(app).get('/api/release');
  return withToken === false ? r : r.set('Authorization', `Bearer ${token(withToken === true ? 'USER' : withToken)}`);
};

const RUNNING: RunningProductRelease = {
  process_role: 'web',
  release_artifact_id: 'product-release-0123456789abcdef01234567',
  release_hash: '1'.repeat(64),
  contract_version: 'product-release-v3',
  product_name: 'Miljöbeslut',
  build_identity: {
    package_lock_sha256: '2'.repeat(64),
    package_manifest_sha256: '3'.repeat(64),
    runtime_entrypoint_sha256: '4'.repeat(64),
    source_commit_sha: '5'.repeat(40),
    source_tree_sha: '6'.repeat(40),
    source_digest_sha256: '7'.repeat(64),
    composition_manifest_sha256: '8'.repeat(64),
    build_args_sha256: '9'.repeat(64),
  },
  measured: { source_digest_sha256: '7'.repeat(64), file_count: 4321 },
  delivered_root: 'D:\\secret-looking\\delivered\\root',
  cas_root: 'D:\\mimer-demo\\cas-root',
};

beforeEach(() => {
  resetRunningProductReleaseForTests();
  hermeticPrismaTouches.length = 0;
});
afterEach(() => {
  expect(hermeticPrismaTouches).toEqual([]);
});

function keysDeep(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => keysDeep(v, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { out.push(k); keysDeep(v, out); }
  return out;
}

describe('GET /api/release (W-U42, owner decision row 7)', () => {
  it('requires a bearer token (401), whatever the running identity', async () => {
    setRunningProductRelease(RUNNING);
    const res = await get(false);
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain(RUNNING.release_artifact_id);
  });

  it('answers 503 PRODUCT_RELEASE_IDENTITY_UNAVAILABLE, retryable false, when the process runs without a release identity', async () => {
    const res = await get();
    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      ok: false,
      code: PRODUCT_RELEASE_IDENTITY_UNAVAILABLE,
      retryable: false,
      error: expect.stringMatching(/releaseidentitet/i),
    });
    expect(res.body).not.toHaveProperty('release');
  });

  it.each(['USER', 'ADMIN'] as const)('answers the running release for an authenticated %s: id, hash, contract, full build identity, own measurement', async (role) => {
    setRunningProductRelease(RUNNING);
    const res = await get(role);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      release: {
        artifact_id: RUNNING.release_artifact_id,
        release_hash: RUNNING.release_hash,
        contract_version: 'product-release-v3',
        product_name: 'Miljöbeslut',
        build_identity: RUNNING.build_identity,
      },
      measured: { source_digest_sha256: RUNNING.measured.source_digest_sha256, file_count: 4321 },
      process: { role: 'web' },
    });
  });

  it('carries no secret, no path and no authenticity claim, and is deterministic between calls', async () => {
    setRunningProductRelease(RUNNING);
    const first = await get();
    const second = await get();
    expect(first.body).toEqual(second.body);
    const text = JSON.stringify(first.body);
    expect(text).not.toMatch(/secret-looking|mimer-demo|delivered_root|cas_root|\\\\|[A-Z]:\\/);
    expect(keysDeep(first.body).join(' ')).not.toMatch(/secret|private|password|pem|token|key_id|ts|timestamp|version$/i);
    expect(text).not.toMatch(/authentic|äkthet|verified|verifierad|tamper|manipulation/i);
  });
});

describe('minimal /health and the start-up wiring (source pins, W-U42)', () => {
  it('createApp mounts the release router and the /health handler exposes no release detail (no version, no timestamp)', () => {
    const src = read('server/createApp.ts');
    expect(src).toMatch(/import releaseRouter from '\.\/routes\/release\.routes'/);
    expect(src).toMatch(/app\.use\(releaseRouter\)/);
    const health = /app\.get\('\/health',[\s\S]*?\n  \}\);/.exec(src)?.[0] ?? '';
    expect(health.length, 'the /health handler is found').toBeGreaterThan(0);
    expect(health).not.toMatch(/npm_package_version|version|toISOString|ts:/);
    expect(health).toMatch(/liveness: 'up'/);
  });

  it('the web process runs the release start-up gate after the CAS gate and before it listens', () => {
    const src = read('server/index.ts');
    const gate = src.indexOf("assertProductReleaseIdentityAtStartup({ role: 'web'");
    expect(gate, 'server/index.ts calls the gate for the web role').toBeGreaterThan(0);
    expect(src.indexOf('assertMimersCasReady(process.env)')).toBeLessThan(gate);
    expect(gate).toBeLessThan(src.indexOf('server.listen('));
  });

  it.each([
    ['lu-project-context-bootstrap-worker.ts', 'lu-bootstrap-worker'],
    ['lu-execution-identity-v3-worker.ts', 'lu-identity-v3-worker'],
    ['lu-viewer-capability-worker.ts', 'lu-viewer-capability-worker'],
    ['lu-geometry-supersession-worker.ts', 'lu-geometry-supersession-worker'],
  ])('%s runs the release start-up gate as %s after its durable-CAS gate', (file, role) => {
    const src = read(`server/workers/${file}`);
    const cas = src.indexOf(`assertLuWorkerDurableCas('${role}')`);
    const release = src.indexOf(`assertLuWorkerProductReleaseIdentity('${role}')`);
    expect(cas, 'the durable-CAS gate stays').toBeGreaterThan(0);
    expect(release, 'the release gate is called with the same role name').toBeGreaterThan(cas);
    expect(release).toBeLessThan(src.indexOf('logger.info('));
  });

  it('the worker gate is one function in server/workers/bootstrap.ts that delegates to the shared start-up module', () => {
    const src = read('server/workers/bootstrap.ts');
    expect(src).toMatch(/export async function assertLuWorkerProductReleaseIdentity\(/);
    expect(src).toMatch(/assertProductReleaseIdentityAtStartup\(\{ role: workerName/);
  });
});
