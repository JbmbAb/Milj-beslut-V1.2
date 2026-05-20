import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 1. Mocka beroenden HOISTED med KORREKTA relativa sökvägar från TESTFILEN
const auditMock = vi.hoisted(() => ({
  appendAuditTrailRow: vi.fn(),
}));
const authRepoMock = vi.hoisted(() => ({
  assertProjectMembership: vi.fn(),
}));
const securityMock = vi.hoisted(() => ({
  assertPermission: vi.fn(),
}));
const envMock = vi.hoisted(() => ({
  getEnv: vi.fn().mockReturnValue('https://api.slu.se'),
}));

// Nu pekar vi rätt från tests/unit/sluService.test.ts -> server/...
vi.mock('../../server/repositories/auditRepository', () => auditMock);
vi.mock('../../server/repositories/projectAccessRepository', () => authRepoMock);
vi.mock('../../server/security/projectAccess', () => securityMock);
vi.mock('../../server/security/env', () => envMock);

// Sätt miljövariabler innan import
vi.hoisted(() => {
  process.env.SLU_SPECIES_OBS_API_KEY = 'test-key';
  process.env.SLU_SPECIES_OBS_BASE_PATH = '/obs';
});

// Mocka fetch
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import {
  searchSluByCoordinates,
  callSluProductApi,
  getSluProductStatus,
  searchSluObservations,
} from '../../server/services/sluService';

describe('sluService unit tests', () => {
  const mockUser: any = { id: 'u1', organisationId: 'o1', role: 'USER' };

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default resolution so subsequent tests don't inherit a rejected mock.
    authRepoMock.assertProjectMembership.mockResolvedValue(undefined);
    process.env.SLU_SPECIES_OBS_API_KEY = 'test-key';
    process.env.SLU_SPECIES_OBS_BASE_PATH = '/obs';
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ totalCount: 5, observations: [] })),
    });
  });

  afterEach(() => {
    delete process.env.SLU_TAXONOMY_API_KEY;
    delete process.env.SLU_TAXONOMY_BASE_PATH;
  });

  it('should call SLU API with a valid polygon for coordinate search', async () => {
    const result = await searchSluByCoordinates({
      lat: 59.3,
      lng: 18.0,
      purpose: 'Environmental impact study',
      user: mockUser,
      projectId: 'p1',
    });

    expect(fetchMock).toHaveBeenCalled();
    expect(auditMock.appendAuditTrailRow).toHaveBeenCalled();
    expect((result as any).totalCount).toBe(5);
  });

  it('should throw error if project membership check fails', async () => {
    authRepoMock.assertProjectMembership.mockRejectedValue(new Error('Access denied'));

    await expect(
      searchSluByCoordinates({
        lat: 59.3,
        lng: 18.0,
        purpose: 'Test',
        user: mockUser,
        projectId: 'p_private',
      }),
    ).rejects.toThrow('Access denied');
  });

  it('throws when purpose is missing in callSluProductApi', async () => {
    await expect(
      callSluProductApi({
        product: 'species_observations',
        method: 'POST',
        purpose: '',
        user: mockUser,
      }),
    ).rejects.toThrow('purpose is required');
  });

  it('skips project membership check when projectId is absent', async () => {
    await searchSluByCoordinates({
      lat: 59.3,
      lng: 18.0,
      purpose: 'No project context',
      user: mockUser,
      // no projectId
    });

    expect(authRepoMock.assertProjectMembership).not.toHaveBeenCalled();
  });

  it('throws when the SLU API returns a non-ok response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: () => Promise.resolve('Service Unavailable'),
    });

    await expect(
      searchSluByCoordinates({
        lat: 59.3,
        lng: 18.0,
        purpose: 'Test',
        user: mockUser,
      }),
    ).rejects.toThrow(/SLU species_observations error \(503\)/);
  });

  it('keeps raw text when API response is not valid JSON', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve('not-json-text'),
    });

    const result = await searchSluByCoordinates({
      lat: 59.3,
      lng: 18.0,
      purpose: 'Test raw',
      user: mockUser,
    });

    expect(result).toBe('not-json-text');
  });

  it('throws when species_observations API key is missing', async () => {
    delete process.env.SLU_SPECIES_OBS_API_KEY;
    delete (process.env as any).SLU_API_KEY;

    await expect(
      searchSluByCoordinates({
        lat: 59.3,
        lng: 18.0,
        purpose: 'Test',
        user: mockUser,
      }),
    ).rejects.toThrow(/Missing env variable: SLU_SPECIES_OBS_API_KEY/);

    process.env.SLU_SPECIES_OBS_API_KEY = 'test-key';
  });

  it('throws when base path is missing', async () => {
    delete process.env.SLU_SPECIES_OBS_BASE_PATH;

    await expect(
      searchSluByCoordinates({
        lat: 59.3,
        lng: 18.0,
        purpose: 'Test',
        user: mockUser,
      }),
    ).rejects.toThrow(/Missing env variable: SLU_SPECIES_OBS_BASE_PATH/);

    process.env.SLU_SPECIES_OBS_BASE_PATH = '/obs';
  });

  it('searchSluObservations throws when projectId is missing', async () => {
    await expect(
      searchSluObservations({
        projectId: '',
        purpose: 'Test',
        payload: {},
        user: mockUser,
      }),
    ).rejects.toThrow('projectId is required for species observations');
  });

  it('searchSluObservations sends payload and returns results', async () => {
    const result = await searchSluObservations({
      projectId: 'p2',
      purpose: 'Flora survey',
      payload: { filter: 'flora' },
      user: mockUser,
    });

    expect((result as any).totalCount).toBe(5);
    const [, calledOptions] = fetchMock.mock.calls[0];
    expect(calledOptions.body).toContain('flora');
  });

  it('getSluProductStatus returns status for all 4 products', () => {
    const status = getSluProductStatus();

    expect(status).toHaveLength(4);
    expect(status.map((s) => s.product)).toContain('species_observations');
    expect(status.map((s) => s.product)).toContain('taxonomy');

    const obs = status.find((s) => s.product === 'species_observations');
    expect(obs?.hasApiKey).toBe(true);
    expect(obs?.hasBasePath).toBe(true);

    const tax = status.find((s) => s.product === 'taxonomy');
    expect(tax?.hasApiKey).toBe(false);
    expect(tax?.hasBasePath).toBe(false);
  });

  it('uses custom radius when provided in searchSluByCoordinates', async () => {
    await searchSluByCoordinates({
      lat: 60.0,
      lng: 15.0,
      radiusDecimalDegrees: 0.05,
      purpose: 'Wide radius test',
      user: mockUser,
    });

    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    // With radius 0.05, the coordinates should span 0.1 degrees
    expect(body.searchArea.coordinates[0][0][0]).toBeCloseTo(14.95);
  });
});
