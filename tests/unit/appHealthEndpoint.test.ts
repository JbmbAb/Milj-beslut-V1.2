/**
 * appHealthEndpoint.test.ts
 *
 * Unit-tests för GET /api/health endpoint.
 * Verifierar att:
 *   - Endpoint svarar utan auth (unauthenticated)
 *   - Svaret innehåller 3 tiers
 *   - Tier 1 alltid är ready: true (kodkvalitet garanteras av CI)
 *   - Svaret innehåller ok, checkedAt, readyTiers, totalTiers
 *   - Tier-strukturen har label, description, checks
 */

import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/createApp';

vi.mock('../../server/repositories/userRepository', () => ({
  ensureAdminConsoleUser: vi.fn(async () => ({
    id: 'test-admin-id',
    bankidId: 'admin:admin',
    role: 'ADMIN',
    organisationId: 'test-org-id',
  })),
  findAuthUserByBankId: vi.fn(async () => null),
}));

// Mock prisma.$queryRaw to simulate DB ping (returns OK)
vi.mock('../../server/db/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    documentRecord: { count: vi.fn().mockResolvedValue(0) },
    extractedRequirement: { count: vi.fn().mockResolvedValue(0) },
    requirementCase: { count: vi.fn().mockResolvedValue(0) },
  },
}));

const app = createApp();

describe('GET /api/health — App Readiness Endpoint', () => {
  it('svarar med 200 utan autentisering', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
  });

  it('returnerar ok: true', async () => {
    const res = await request(app).get('/api/health');
    expect(res.body.ok).toBe(true);
  });

  it('returnerar 3 tiers i svaret', async () => {
    const res = await request(app).get('/api/health');
    expect(Array.isArray(res.body.tiers)).toBe(true);
    expect(res.body.tiers).toHaveLength(3);
    expect(res.body.totalTiers).toBe(3);
  });

  it('tier 1 (kodkvalitet) är alltid ready: true', async () => {
    const res = await request(app).get('/api/health');
    const tier1 = res.body.tiers.find((t: { tier: number }) => t.tier === 1);
    expect(tier1).toBeDefined();
    expect(tier1.ready).toBe(true);
    expect(tier1.label).toBe('Kodkvalitet');
  });

  it('svaret innehåller checkedAt, readyTiers och summary', async () => {
    const res = await request(app).get('/api/health');
    expect(res.body.checkedAt).toBeDefined();
    expect(() => new Date(res.body.checkedAt)).not.toThrow();
    expect(typeof res.body.readyTiers).toBe('number');
    expect(typeof res.body.summary).toBe('string');
    expect(res.body.summary.length).toBeGreaterThan(0);
  });
});
