import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';

const mocks = vi.hoisted(() => ({
  countProjectsForOrganisation: vi.fn(),
  listProjectsPageForOrganisation: vi.fn(),
  countTransportBookings: vi.fn(),
  listTransportBookingsPage: vi.fn(),
}));

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

vi.mock('../../server/modules/platform/public', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../server/modules/platform/public')>();
  return {
    ...mod,
    countProjectsForOrganisation: mocks.countProjectsForOrganisation,
    listProjectsPageForOrganisation: mocks.listProjectsPageForOrganisation,
    countTransportBookings: mocks.countTransportBookings,
    listTransportBookingsPage: mocks.listTransportBookingsPage,
  };
});

import projectV1Routes from '../../server/routes/project.v1.routes';
import logisticsRoutes from '../../server/routes/logistics.routes';

const app = express();
app.use(express.json());
app.use(projectV1Routes);
app.use(logisticsRoutes);

function authHeader(role: string = 'ADMIN') {
  return `Bearer ${
    createTokenPair({
      id: 'user-1',
      organisationId: 'org-1',
      bankidId: 'user:one',
      role: role as any,
    }).accessToken
  }`;
}

const mockProjects = [
  {
    id: 'proj-1',
    propertyDesignation: 'GÄVLE BRYNÄS 1:1',
    status: 'ACTIVE',
    createdAt: new Date(),
    closedAt: null,
    complianceScore: 85,
    environmentalScore: 70,
    regulatoryRiskScore: 30,
    fundingRating: 'A',
  },
];

const mockBookings = [
  {
    id: 'booking-1',
    status: 'PLANNED',
    receiverName: 'Gävle Deponin',
    wasteCode: '17 05 03',
    tons: 50,
    distanceKm: 15,
    co2EstimateKg: 31.5,
    plannedPickupAt: new Date(),
    plannedDeliveryAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

describe('admin.pagination routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.countProjectsForOrganisation.mockResolvedValue(1);
    mocks.listProjectsPageForOrganisation.mockResolvedValue(mockProjects);
    mocks.countTransportBookings.mockResolvedValue(1);
    mocks.listTransportBookingsPage.mockResolvedValue(mockBookings);
  });

  describe('GET /api/admin/projects', () => {
    it('returnerar paginerad projektlista för ADMIN', async () => {
      const res = await request(app)
        .get('/api/admin/projects?page=1&limit=10')
        .set('Authorization', authHeader('ADMIN'));

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.projects)).toBe(true);
      expect(res.body.total).toBe(1);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(10);
      expect(typeof res.body.totalPages).toBe('number');
    });

    it('returnerar 403 för icke-ADMIN-användare', async () => {
      const res = await request(app).get('/api/admin/projects').set('Authorization', authHeader('USER'));

      expect(res.status).toBe(403);
      expect(res.body.ok).toBe(false);
    });

    it('returnerar 401 utan autentisering', async () => {
      const res = await request(app).get('/api/admin/projects');
      expect(res.status).toBe(401);
    });

    it('hanterar paginering korrekt (sida 2)', async () => {
      mocks.countProjectsForOrganisation.mockResolvedValue(25);
      mocks.listProjectsPageForOrganisation.mockResolvedValue(mockProjects);

      const res = await request(app)
        .get('/api/admin/projects?page=2&limit=10')
        .set('Authorization', authHeader('ADMIN'));

      expect(res.status).toBe(200);
      expect(res.body.page).toBe(2);
      expect(res.body.totalPages).toBe(3);
    });

    it('begränsar limit till max 100', async () => {
      const res = await request(app)
        .get('/api/admin/projects?page=1&limit=999')
        .set('Authorization', authHeader('ADMIN'));

      expect(res.status).toBe(200);
      expect(res.body.limit).toBe(100);
    });

    it('hanterar ogiltiga page/limit värden (defaultvärden)', async () => {
      const res = await request(app)
        .get('/api/admin/projects?page=abc&limit=xyz')
        .set('Authorization', authHeader('ADMIN'));

      expect(res.status).toBe(200);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(10);
    });
  });

  describe('GET /api/transport/bookings', () => {
    it('returnerar paginerad bokningslista', async () => {
      const res = await request(app)
        .get('/api/transport/bookings?page=1&limit=10')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.bookings)).toBe(true);
      expect(res.body.total).toBe(1);
    });

    it('returnerar 401 utan autentisering', async () => {
      const res = await request(app).get('/api/transport/bookings');
      expect(res.status).toBe(401);
    });

    it('returnerar hasMore korrekt', async () => {
      mocks.countTransportBookings.mockResolvedValue(20);

      const res = await request(app)
        .get('/api/transport/bookings?page=1&limit=10')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.hasMore).toBe(true);
    });
  });
});