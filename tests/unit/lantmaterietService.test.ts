import { describe, it, expect, vi, beforeEach } from 'vitest';

// 1. Mocka beroenden HOISTED
const auditMock = vi.hoisted(() => ({
  appendPropertyAudit: vi.fn(),
}));
const auditRepoMock = vi.hoisted(() => ({
  writePropertyAccessLog: vi.fn(),
}));
const authRepoMock = vi.hoisted(() => ({
  assertProjectMembership: vi.fn(),
}));
const securityMock = vi.hoisted(() => ({
  assertPermission: vi.fn(),
  validatePropertyLookupInput: vi.fn(),
}));
const envMock = vi.hoisted(() => ({
  isLantmaterietOpenMode: vi.fn().mockReturnValue(false),
  hasLantmaterietAuth: vi.fn().mockReturnValue(true),
}));
const hybridGeoMock = vi.hoisted(() => ({
  tryFetchLocalPropertyGeometry: vi.fn().mockResolvedValue(null),
}));

// VIKTIGT: Sökvägar från tests/unit/ -> server/...
vi.mock('../../server/security/auditTrail', () => auditMock);
vi.mock('../../server/repositories/auditRepository', () => auditRepoMock);
vi.mock('../../server/repositories/projectAccessRepository', () => authRepoMock);
vi.mock('../../server/security/projectAccess', () => securityMock);
vi.mock('../../server/security/env', () => envMock);
vi.mock('../../server/services/hybridGeoService', () => hybridGeoMock);

// Sätt miljövariabler innan import
vi.hoisted(() => {
  process.env.LANTMATERIET_CONSUMER_KEY = 'test-key';
  process.env.LANTMATERIET_CONSUMER_SECRET = 'test-secret';
  process.env.LANTMATERIET_LOOKUP_MODE = 'ogc';
  process.env.LANTMATERIET_BASE_URL = 'https://api.test';
});

// Mocka fetch globalt
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { lookupPropertyByDesignation } from '../../server/services/lantmaterietService';

describe('lantmaterietService unit tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.LANTMATERIET_OPEN_SUBSCRIPTION_KEY;
    hybridGeoMock.tryFetchLocalPropertyGeometry.mockResolvedValue(null);
  });

  const mockUser: any = { id: 'u1', organisationId: 'o1', role: 'USER' };

  describe('lookupPropertyByDesignation', () => {
    it('should complete a lookup flow: get token -> fetch items', async () => {
      // Mocka Token
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: 'valid-token', expires_in: 3600 }),
      });

      // Mocka Items
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            features: [
              { properties: { etikett: 'GÄVLE 1:1' }, geometry: { type: 'Point', coordinates: [17, 60] } },
            ],
          }),
      });

      const result = await lookupPropertyByDesignation(
        {
          projectId: 'p1',
          propertyDesignation: 'GÄVLE 1:1',
          purpose: 'Inspection',
        },
        mockUser,
      );

      expect(result.designation).toBe('GÄVLE 1:1');
      expect(fetchMock).toHaveBeenCalled();
    });

    it('returns local hybrid geometry before live lookup', async () => {
      hybridGeoMock.tryFetchLocalPropertyGeometry.mockResolvedValueOnce({
        designation: 'GÄVLE 1:1',
        geometry: { type: 'Polygon', coordinates: [] },
        boundaries: { id: 'local' },
      });

      const result = await lookupPropertyByDesignation(
        {
          projectId: 'p1',
          propertyDesignation: 'GÄVLE 1:1',
          purpose: 'Inspection',
        },
        mockUser,
      );

      expect(result.source).toBe('local_db_hybrid');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(auditMock.appendPropertyAudit).toHaveBeenCalled();
      expect(auditRepoMock.writePropertyAccessLog).toHaveBeenCalled();
    });
  });
});
