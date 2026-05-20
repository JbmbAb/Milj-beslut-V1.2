import { describe, it, expect, beforeAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../server/createApp';
import type { Express } from 'express';
import type { SewageApplication, SewageGISAnalysis, SewageProtectionProfile } from '../../types';

describe('Smoke Tests for Core API Endpoints', () => {
  let app: Express;
  let request: supertest.SuperTest<supertest.Test>;

  beforeAll(() => {
    app = createApp();
    request = supertest(app);
  });

  it('POST /api/sewage/submit-application should accept a valid sewage application', async () => {
    const mockApplication: SewageApplication = {
      id: 'app-smoke-1',
      propertyDesignation: 'RÖKEN 1:23',
      selectedSystemType: 'MINI_PLANT_BDTA',
      pe: 5,
    };

    const mockProtectionProfile: SewageProtectionProfile = {
      propertyId: 'app-smoke-1',
      protectionLevel: 'HIGH',
      reason: 'Närhet till vattenskyddsområde',
      nearestWell: { distance: 80, owner: 'OWN' },
      distanceToPropertyLine: 10,
    };

    const mockGisAnalysis: SewageGISAnalysis = {
      propertyId: 'app-smoke-1',
      timestamp: new Date().toISOString(),
      sguJordartData: { soilType: 'Morän', loadingCapacity: 'MEDIUM' },
      sguBrunnarData: { nearestOwnWell: { distance: 80 } },
      protectedAreas: [{ name: 'Vattenskyddsområde', type: 'WATER_PROTECTION', distance: 250 }],
      propertyBoundaries: { area: 2000, perimeter: 180, nearestNeighbor: 10 },
      floodRiskZone: { level: 'LOW' },
      overallRiskScore: 60,
      feasibilityScore: 80,
      recommendedSystems: ['MINI_PLANT_BDTA'],
      blockedSystems: ['INFILTRATION'],
      reasoning: ['Ligger i vattenskyddsområde.'],
    };

    const payload = {
      application: mockApplication,
      protectionProfile: mockProtectionProfile,
      gisAnalysis: mockGisAnalysis,
      municipalityCode: '3100', // Uppsala, configured for EMAIL fallback
      projectId: 'proj-smoke-test',
    };

    const response = await request
      .post('/api/sewage/submit-application')
      .set('Authorization', 'Bearer test-admin-token') // Assuming a test token middleware
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.referenceNumber).toBeDefined();
    expect(response.body.integrationType).toBe('EMAIL');
  });

  it('POST /api/c-notification/submit should create a submission and return 201 Created', async () => {
    const payload = {
      projectId: 'proj-smoke-c-anmalan',
      activityData: {
        code: '90.20',
        description: 'Mellanlagring av farligt avfall',
        volume_tons: 50,
      },
    };

    const response = await request
      .post('/api/c-notification/submit')
      .set('Authorization', 'Bearer test-admin-token') // Assuming a test token middleware
      .send(payload);

    expect(response.status).toBe(201);
    expect(response.body.id).toBeDefined();
    expect(response.body.submissionKey).toContain('C-ANM-');
    expect(response.body.domain).toBe('C_NOTIFICATION');
    expect(response.body.status).toBe('SUBMITTED');
  });

  it('POST /api/localization/generate-report should return a 202 Accepted response', async () => {
    const payload = {
      projectId: 'proj-smoke-lokutred',
      siteAlternatives: [
        { id: 'alt-1', lat: 59.33, lng: 18.07 },
        { id: 'alt-2', lat: 59.34, lng: 18.08 },
      ],
    };

    const response = await request
      .post('/api/localization/generate-report')
      .set('Authorization', 'Bearer test-admin-token')
      .send(payload);

    expect(response.status).toBe(202);
    expect(response.body.ok).toBe(true);
    expect(response.body.message).toContain('Rapport för lokaliseringsutredning genereras');
  });
});
