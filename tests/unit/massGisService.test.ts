import { describe, expect, it } from 'vitest';
import { analyzeMassSiteGis } from '../../server/modules/c-notification-mass/massGisService';

describe('massGisService', () => {
  const authUser = {
    id: 'user-1',
    organisationId: 'org-1',
    bankidId: 'bankid-1',
    role: 'ADMIN' as const,
  };

  it('returns deterministic GIS analysis in vitest', async () => {
    const result = await analyzeMassSiteGis(authUser, {
      projectId: 'proj-1',
      propertyDesignation: 'GÄVLE BRYNÄS 1:1',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.analysis.propertyDesignation).toBe('GÄVLE BRYNÄS 1:1');
    expect(result.data.analysis.overallRiskScore).toBeGreaterThan(0);
    expect(result.data.siteProfile.recommendedZones).toHaveLength(3);
    expect(result.data.propertySource).toBe('vitest');
  });
});
