// tests/unit/governanceRoutesDurableCasRoot.test.ts
//
// U30-A: server/routes/governance.routes.ts used to open its own FileCASRepository at module
// load on `process.env.MIMERS_ROOT || path.resolve(".data/mimers")` -- a silent cwd-relative
// CAS, independent of MIMERS_REQUIRED. It must now resolve the ONE durable root through the
// shared contract (resolveDurableMimersRoot, PRES-19), lazily, and fail closed with a stated
// cause when MIMERS_ROOT is missing. Nothing touches the filesystem here: the CAS, quarantine
// storage and canonical pipeline are mocked at the module boundary, and the constructor
// arguments are recorded so the chosen root is observable.

import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';

const mocks = vi.hoisted(() => ({
  casConstructed: [] as string[],
  initialize: vi.fn(),
  getBytes: vi.fn(),
}));

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

vi.mock('../../server/security/governanceSigningKey', () => ({
  getGovernanceSigningProvider: () => ({ keyId: 'ed25519:test-governance-key', sign: vi.fn(), verify: vi.fn() }),
}));

vi.mock('@miljobeslut/mimers-brunn-core', () => ({
  FileCASRepository: class {
    constructor(baseDir: string) {
      mocks.casConstructed.push(baseDir);
    }
    initialize = mocks.initialize;
    getBytes = mocks.getBytes;
  },
  DiskQuarantineStorage: class {
    list = vi.fn(async () => []);
    updateStatus = vi.fn(async () => undefined);
    get = vi.fn();
    getMetadata = vi.fn(async () => null);
  },
  QuarantinePromoter: class {
    promote = vi.fn();
  },
  createArtifactAttestation: vi.fn(),
  PROMOTION_ACTION: 'quarantine.promote',
  PROMOTION_ATTESTATION_PREDICATE_TYPE: 'mimers-brunn/quarantine-promotion/v1',
  PROMOTION_ATTESTATION_SCHEMA_VERSION: 1,
}));

vi.mock('../../packages/mps-canonical/src/CanonicalPipeline.js', () => ({
  DefaultCanonicalPipeline: class {
    initHasher = vi.fn(async () => undefined);
    hashCanonical = vi.fn().mockReturnValue({ digest: 'fake-digest' });
  },
}));

function adminHeader(): string {
  return `Bearer ${
    createTokenPair({ id: 'admin-1', organisationId: 'org-1', bankidId: 'admin:admin-1', role: 'ADMIN' }).accessToken
  }`;
}

async function loadApp() {
  vi.resetModules();
  const { governanceRouter } = await import('../../server/routes/governance.routes');
  const app = express();
  app.use(express.json());
  app.use('/api/governance', governanceRouter);
  return app;
}

describe('governance.routes durable CAS root (U30-A, PRES-19)', () => {
  const savedRoot = process.env.MIMERS_ROOT;

  beforeEach(() => {
    mocks.casConstructed.length = 0;
    mocks.initialize.mockReset().mockResolvedValue(undefined);
    mocks.getBytes.mockReset().mockResolvedValue(Buffer.from(JSON.stringify({ ok: 1 }), 'utf8'));
  });

  afterEach(() => {
    if (savedRoot === undefined) delete process.env.MIMERS_ROOT;
    else process.env.MIMERS_ROOT = savedRoot;
  });

  it('never opens a CAS under a .data/mimers fallback when MIMERS_ROOT is missing', async () => {
    delete process.env.MIMERS_ROOT;
    const app = await loadApp();

    const res = await request(app).get('/api/governance/cas/artifact/sha256:abc').set('Authorization', adminHeader());

    expect(mocks.casConstructed.filter((dir) => dir.includes('.data'))).toEqual([]);
    expect(mocks.casConstructed).toEqual([]);
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(String(res.body.error)).toMatch(/^MIMERS_ROOT_REQUIRED: /);
    expect(mocks.getBytes).not.toHaveBeenCalled();
  });

  it('opens no CAS at module load: importing the router has no storage side effect', async () => {
    process.env.MIMERS_ROOT = path.join(path.parse(process.cwd()).root, 'mimers-durable-root-under-test');
    await loadApp();

    expect(mocks.casConstructed).toEqual([]);
    expect(mocks.initialize).not.toHaveBeenCalled();
  });

  it('opens the durable root from MIMERS_ROOT on first use, once', async () => {
    const root = path.join(path.parse(process.cwd()).root, 'mimers-durable-root-under-test');
    process.env.MIMERS_ROOT = root;
    const app = await loadApp();

    const first = await request(app).get('/api/governance/cas/artifact/sha256:abc').set('Authorization', adminHeader());
    const second = await request(app).get('/api/governance/cas/artifact/sha256:def').set('Authorization', adminHeader());

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mocks.casConstructed).toEqual([path.join(path.resolve(root), 'cas')]);
    expect(mocks.initialize).toHaveBeenCalledTimes(1);
    expect(mocks.getBytes).toHaveBeenCalledWith('sha256:abc', { verifyHash: true });
  });

  it('a missing root also fails session/start closed (503) instead of using a fallback reader', async () => {
    delete process.env.MIMERS_ROOT;
    const app = await loadApp();

    const res = await request(app)
      .post('/api/governance/session/start')
      .set('Authorization', adminHeader())
      .send({ capability: { artifact_id: 'cap-1' } });

    expect(res.status).toBe(503);
    expect(String(res.body.error)).toMatch(/^MIMERS_ROOT_REQUIRED: /);
    expect(mocks.casConstructed).toEqual([]);
  });
});
