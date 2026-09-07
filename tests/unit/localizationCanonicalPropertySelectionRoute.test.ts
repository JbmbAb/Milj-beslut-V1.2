import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const localization = vi.hoisted(() => ({
  searchCanonicalPropertyCandidates: vi.fn(),
  resolveCanonicalPropertySelection: vi.fn(),
  createLocalizationProject: vi.fn(),
  enqueueProjectContextBootstrapRequest: vi.fn(),
}));

vi.mock('../../server/security/auth', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.authUser = { id: 'user-1', organisationId: 'org-1', bankidId: 'bankid-1', role: 'CONSULTANT' };
    next();
  },
}));
vi.mock('../../server/security/rateLimit', () => ({
  rateLimitByUser: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));
vi.mock('../../server/security/projectAccess', () => ({ assertProjectAccess: vi.fn() }));
vi.mock('../../server/db/prisma', () => ({ prisma: { project: { findUnique: vi.fn() } } }));
vi.mock('../../server/modules/localization/public', () => ({
  searchCanonicalPropertyCandidates: localization.searchCanonicalPropertyCandidates,
  resolveCanonicalPropertySelection: localization.resolveCanonicalPropertySelection,
  createLocalizationProject: localization.createLocalizationProject,
  enqueueProjectContextBootstrapRequest: localization.enqueueProjectContextBootstrapRequest,
  listProjectsForProperty: vi.fn(),
  getBootstrapRequestStatusForProject: vi.fn(),
  ensureViewerCapabilityProvisioningEnqueuedForCompletedBootstrap: vi.fn(),
}));

import localizationRoutes from '../../server/routes/localization.routes';

const app = express();
app.use(express.json());
app.use(localizationRoutes);

const canonicalProperty = {
  sourceKey: 'source-a',
  sourceDataset: 'lm_fastighetsytor',
  designation: 'FALKENBERG ULLARED 2:215',
  municipality: 'FALKENBERG',
  municipalityCode: '1382',
  countyCode: '13',
  matchKind: 'exact' as const,
};

describe('localization canonical property selection route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localization.resolveCanonicalPropertySelection.mockResolvedValue(canonicalProperty);
    localization.createLocalizationProject.mockResolvedValue({ id: 'project-1', name: 'Ullared', propertyDesignation: canonicalProperty.designation, status: 'ACTIVE', createdAt: new Date() });
    localization.enqueueProjectContextBootstrapRequest.mockResolvedValue({ id: 'bootstrap-1', status: 'PENDING' });
  });

  it('returns discovery candidates without selecting a candidate as authority', async () => {
    localization.searchCanonicalPropertyCandidates.mockResolvedValue([canonicalProperty]);

    const response = await request(app).get('/api/localization/property-candidates?query=Ullared%202%3A215');

    expect(response.status).toBe(200);
    expect(response.body.candidates).toEqual([canonicalProperty]);
    expect(localization.createLocalizationProject).not.toHaveBeenCalled();
  });

  it('rejects free-text project creation before any project write', async () => {
    const response = await request(app)
      .post('/api/localization/localization-projects')
      .send({ propertyDesignation: 'ULLARED 2:215', name: 'Ullared' });

    expect(response.status).toBe(400);
    expect(localization.resolveCanonicalPropertySelection).not.toHaveBeenCalled();
    expect(localization.createLocalizationProject).not.toHaveBeenCalled();
  });

  it('re-resolves the selected identity before creating and bootstrapping the project', async () => {
    const response = await request(app)
      .post('/api/localization/localization-projects')
      .send({ property: { sourceKey: 'source-a', sourceDataset: 'lm_fastighetsytor', designation: 'FALKENBERG ULLARED 2:215' }, name: 'Ullared' });

    expect(response.status).toBe(201);
    expect(localization.resolveCanonicalPropertySelection).toHaveBeenCalledWith({
      sourceKey: 'source-a', sourceDataset: 'lm_fastighetsytor', designation: 'FALKENBERG ULLARED 2:215',
    });
    expect(localization.createLocalizationProject).toHaveBeenCalledWith(expect.objectContaining({ property: canonicalProperty }));
    expect(localization.enqueueProjectContextBootstrapRequest).toHaveBeenCalledWith(expect.objectContaining({ propertyDesignation: canonicalProperty.designation }));
  });
});
