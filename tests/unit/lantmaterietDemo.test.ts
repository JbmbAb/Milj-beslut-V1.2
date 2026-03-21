import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../server/repositories/projectAccessRepository', () => ({
  assertProjectMembership: vi.fn(async () => undefined),
}));

vi.mock('../../server/repositories/auditRepository', () => ({
  writePropertyAccessLog: vi.fn(async () => undefined),
}));

vi.mock('../../server/security/auditTrail', () => ({
  appendPropertyAudit: vi.fn(async () => undefined),
}));

import { lookupPropertyByDesignation } from '../../server/services/lantmaterietService';
import type { AuthUser } from '../../server/security/types';

const mockUser: AuthUser = {
  id: 'user-demo-1',
  organisationId: 'org-1',
  bankidId: 'bankid-demo',
  role: 'CONSULTANT',
};

describe('Lantmäteriet demo mode (fastighetssökning utan credentials)', () => {
  const savedEnv = process.env;

  beforeEach(() => {
    process.env = { ...savedEnv };
    delete process.env.LANTMATERIET_CONSUMER_KEY;
    delete process.env.LANTMATERIET_CONSUMER_SECRET;
    delete process.env.LANTMATERIET_ACCESS_TOKEN;
    delete process.env.LANTMATERIET_API_KEY;
    delete process.env.LANTMATERIET_DEMO_MODE;
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  it('returnerar demo-data automatiskt när inga credentials är satta', async () => {
    const result = await lookupPropertyByDesignation(
      { projectId: 'proj-1', propertyDesignation: 'STOCKHOLM CITY 1:1', purpose: 'Testuppslagning' },
      mockUser,
    );

    expect(result._demo).toBe(true);
    expect(result.geometry).toBeTruthy();
    const geom = result.geometry as { type: string; coordinates: number[][][][] };
    expect(geom.type).toBe('Polygon');
    expect(geom.coordinates).toBeDefined();
  });

  it('returnerar NACKA-koordinater för NACKA-beteckning', async () => {
    const result = await lookupPropertyByDesignation(
      { projectId: 'proj-1', propertyDesignation: 'NACKA ORMINGE 7:8', purpose: 'Testuppslagning' },
      mockUser,
    );

    expect(result._demo).toBe(true);
    const geom = result.geometry as { type: string; coordinates: number[][][] };
    expect(geom.type).toBe('Polygon');
    const firstPoint = geom.coordinates[0][0];
    expect(firstPoint[0]).toBeCloseTo(18.25, 1);
    expect(firstPoint[1]).toBeCloseTo(59.33, 1);
  });

  it('returnerar ORSA-koordinater för ORSA-beteckning', async () => {
    const result = await lookupPropertyByDesignation(
      { projectId: 'proj-1', propertyDesignation: 'ORSA STACKMORA 1:23', purpose: 'Testuppslagning' },
      mockUser,
    );

    expect(result._demo).toBe(true);
    const geom = result.geometry as { type: string; coordinates: number[][][] };
    const firstPoint = geom.coordinates[0][0];
    expect(firstPoint[0]).toBeCloseTo(14.73, 1);
    expect(firstPoint[1]).toBeCloseTo(61.12, 1);
  });

  it('returnerar deterministisk geometri för godtycklig beteckning', async () => {
    const designation = 'GÖTEBORG CENTRUM 3:15';
    const result1 = await lookupPropertyByDesignation(
      { projectId: 'proj-1', propertyDesignation: designation, purpose: 'Test' },
      mockUser,
    );
    const result2 = await lookupPropertyByDesignation(
      { projectId: 'proj-1', propertyDesignation: designation, purpose: 'Test' },
      mockUser,
    );

    expect(result1._demo).toBe(true);
    expect(result2._demo).toBe(true);
    const geom1 = result1.geometry as { coordinates: number[][][] };
    const geom2 = result2.geometry as { coordinates: number[][][] };
    expect(geom1.coordinates[0][0]).toEqual(geom2.coordinates[0][0]);
  });

  it('aktiveras även via LANTMATERIET_DEMO_MODE=true', async () => {
    process.env.LANTMATERIET_DEMO_MODE = 'true';
    const result = await lookupPropertyByDesignation(
      { projectId: 'proj-1', propertyDesignation: 'MALMÖ CENTRUM 1:1', purpose: 'Test' },
      mockUser,
    );
    expect(result._demo).toBe(true);
  });
});
