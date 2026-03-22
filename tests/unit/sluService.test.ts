import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appendAuditTrailRow: vi.fn(),
  assertPermission: vi.fn(),
  assertProjectMembership: vi.fn(),
  getEnv: vi.fn(),
}));

vi.mock('../../server/repositories/auditRepository', () => ({
  appendAuditTrailRow: mocks.appendAuditTrailRow,
}));

vi.mock('../../server/repositories/projectAccessRepository', () => ({
  assertProjectMembership: mocks.assertProjectMembership,
}));

vi.mock('../../server/security/env', () => ({
  getEnv: mocks.getEnv,
}));

vi.mock('../../server/security/projectAccess', () => ({
  assertPermission: mocks.assertPermission,
}));

import {
  callSluProductApi,
  getSluProductStatus,
  pingSluProduct,
  searchSluByCoordinates,
  searchSluObservations,
} from '../../server/services/sluService';

describe('sluService', () => {
  const user = {
    id: 'user-1',
    organisationId: 'org-1',
    role: 'ADMIN' as const,
    bankidId: '191212121212',
  };
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();

    process.env.SLU_API_KEY = 'fallback-key';
    process.env.SLU_SPECIES_OBS_API_KEY = 'species-key';
    process.env.SLU_SPECIES_OBS_BASE_PATH = '/species';
    process.env.SLU_TAXONOMY_API_KEY = 'taxonomy-key';
    process.env.SLU_TAXONOMY_BASE_PATH = '/taxonomy';
    process.env.SLU_ARTFAKTA_BASE_PATH = '/artfakta';
    process.env.SLU_METODKATALOG_BASE_PATH = '/metod';

    mocks.getEnv.mockImplementation((name: string) => {
      if (name === 'SLU_API_BASE_URL') {
        return 'https://slu.example.test/';
      }
      throw new Error(`Unexpected env lookup: ${name}`);
    });
    mocks.assertPermission.mockImplementation(() => undefined);
    mocks.assertProjectMembership.mockResolvedValue(undefined);
    mocks.appendAuditTrailRow.mockResolvedValue(undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;

    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('reports per-product runtime status from env configuration', () => {
    const result = getSluProductStatus();

    expect(result).toEqual([
      { product: 'species_observations', hasApiKey: true, hasBasePath: true },
      { product: 'taxonomy', hasApiKey: true, hasBasePath: true },
      { product: 'artfakta', hasApiKey: true, hasBasePath: true },
      { product: 'metodkatalog', hasApiKey: true, hasBasePath: true },
    ]);
  });

  it('calls a product api, validates membership and appends an audit row', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ total: 2, items: ['wolf'] }),
    } as Response);

    const result = await callSluProductApi({
      product: 'species_observations',
      method: 'POST',
      pathSuffix: 'observations',
      query: {
        page: 2,
        includeInactive: false,
      },
      payload: {
        species: 'wolf',
      },
      projectId: 'project-1',
      purpose: 'permit-review',
      user,
    });

    expect(result).toEqual({ total: 2, items: ['wolf'] });
    expect(mocks.assertPermission).toHaveBeenCalledWith(user, 'PROPERTY_LOOKUP');
    expect(mocks.assertProjectMembership).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      organisationId: 'org-1',
      role: 'ADMIN',
    });
    expect(vi.mocked(global.fetch)).toHaveBeenCalledWith(
      'https://slu.example.test/species/observations?page=2&includeInactive=false',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Ocp-Apim-Subscription-Key': 'species-key',
        }),
        body: JSON.stringify({ species: 'wolf' }),
      }),
    );
    expect(mocks.appendAuditTrailRow).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'SLUApiCall',
        entityId: 'project-1',
        action: 'READ',
        userId: 'user-1',
        payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });

  it('returns raw text responses when SLU returns non-json payloads', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      text: async () => 'plain text response',
    } as Response);

    const result = await callSluProductApi({
      product: 'taxonomy',
      method: 'GET',
      pathSuffix: '/taxa',
      purpose: 'taxonomy-check',
      user,
    });

    expect(result).toBe('plain text response');
    expect(mocks.assertProjectMembership).not.toHaveBeenCalled();
    expect(mocks.appendAuditTrailRow).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: 'global:taxonomy',
      }),
    );
  });

  it('rejects missing purposes before attempting permission checks', async () => {
    await expect(
      callSluProductApi({
        product: 'taxonomy',
        method: 'GET',
        purpose: '',
        user,
      }),
    ).rejects.toThrow(/purpose is required/i);

    expect(mocks.assertPermission).not.toHaveBeenCalled();
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
  });

  it('rejects unsafe path suffixes', async () => {
    await expect(
      callSluProductApi({
        product: 'taxonomy',
        method: 'GET',
        pathSuffix: 'https://evil.test/redirect',
        purpose: 'taxonomy-check',
        user,
      }),
    ).rejects.toThrow(/invalid slu pathsuffix/i);
  });

  it('surfaces SLU upstream errors with product context', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => 'temporarily unavailable',
    } as Response);

    await expect(
      callSluProductApi({
        product: 'taxonomy',
        method: 'GET',
        purpose: 'taxonomy-check',
        user,
      }),
    ).rejects.toThrow(/SLU taxonomy error \(503\): temporarily unavailable/);
  });

  it('pings configured products using probe-specific endpoints', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
    } as Response);

    const result = await pingSluProduct('artfakta');

    expect(result).toEqual({
      ok: true,
      status: 200,
      endpoint: 'https://slu.example.test/artfakta/speciesdata?taxa=100024',
    });
    expect(vi.mocked(global.fetch)).toHaveBeenCalledWith(
      'https://slu.example.test/artfakta/speciesdata?taxa=100024',
      expect.objectContaining({
        method: 'GET',
        body: undefined,
      }),
    );
  });

  it('requires project ids for species observation searches', async () => {
    await expect(
      searchSluObservations({
        projectId: '',
        purpose: 'species-check',
        payload: {},
        user,
      }),
    ).rejects.toThrow(/projectId is required/i);
  });

  it('builds coordinate polygons for location-based observation searches', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ hits: 1 }),
    } as Response);

    const result = await searchSluByCoordinates({
      lat: 60.14,
      lng: 15.2,
      purpose: 'field-review',
      projectId: 'project-2',
      user,
    });

    expect(result).toEqual({ hits: 1 });
    const [, options] = vi.mocked(global.fetch).mock.calls[0] || [];
    const payload = JSON.parse(String(options?.body || '{}'));
    expect(payload).toEqual({
      coordinateSystem: 'WGS84',
      searchArea: {
        type: 'Polygon',
        coordinates: [
          [
            [15.19, 60.13],
            [15.209999999999999, 60.13],
            [15.209999999999999, 60.15],
            [15.19, 60.15],
            [15.19, 60.13],
          ],
        ],
      },
    });
  });
});
