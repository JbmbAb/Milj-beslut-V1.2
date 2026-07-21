import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('Lantmateriet live policy (fastighetssokning utan credentials)', () => {
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

  it.each(['STOCKHOLM CITY 1:1', 'NACKA ORMINGE 7:8', 'ORSA STACKMORA 1:23', 'GOTEBORG CENTRUM 3:15'])(
    'blockerar demo-geometri for %s nar credentials saknas',
    async (propertyDesignation) => {
      await expect(
        lookupPropertyByDesignation(
          { projectId: 'proj-1', propertyDesignation, purpose: 'Testuppslagning' },
          mockUser,
        ),
      ).rejects.toThrow(/LIVE_LANTMATERIET_REQUIRED/);
    },
  );

  it('blockerar LANTMATERIET_DEMO_MODE=true och returnerar aldrig demo-geometri', async () => {
    process.env.LANTMATERIET_DEMO_MODE = 'true';

    await expect(
      lookupPropertyByDesignation(
        { projectId: 'proj-1', propertyDesignation: 'MALMO CENTRUM 1:1', purpose: 'Test' },
        mockUser,
      ),
    ).rejects.toThrow(/LIVE_LANTMATERIET_REQUIRED/);
  });
});
