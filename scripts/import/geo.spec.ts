import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../server/createApp';
import type { Express } from 'express';
import { prisma } from '../../server/db/prisma';

// Mock the prisma client to control database responses during tests
vi.mock('../../server/db/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

describe('GEO API Endpoints', () => {
  let app: Express;
  let request: ReturnType<typeof supertest>;

  beforeAll(() => {
    app = createApp();
    request = supertest(app);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/geo/property-lookup', () => {
    it('should return property data from local PostGIS when found', async () => {
      // Arrange: Mock the database response for the local lookup
      const mockDbResult = [
        {
          etikett: '1:1',
          kommunnamn: 'NACKA',
          trakt: 'BOO',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [1, 1],
                [1, 2],
                [2, 2],
                [2, 1],
                [1, 1],
              ],
            ],
          },
        },
      ];
      (prisma.$queryRaw as any).mockResolvedValue(mockDbResult);

      const payload = {
        propertyDesignation: 'NACKA BOO 1:1',
        projectId: 'proj-geo-test',
        purpose: 'Test lookup',
      };

      // Act: Call the endpoint
      const response = await request
        .post('/api/geo/property-lookup')
        .set('Authorization', 'Bearer test-admin-token') // Use mock auth
        .send(payload);

      // Assert: Check the response
      expect(response.status).toBe(200);
      expect(response.body.designation).toBe('NACKA BOO 1:1');
      expect(response.body.source).toBe('local_db_hybrid');
      expect(response.body.geometry).toEqual(mockDbResult[0].geometry);
    });
  });
});
