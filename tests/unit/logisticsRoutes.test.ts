import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';

const mocks = vi.hoisted(() => ({
  addGpsPosition: vi.fn(),
  getGpsTrack: vi.fn(),
  getLatestGpsPosition: vi.fn(),
  getMarketSnapshot: vi.fn(),
  invalidateMarketCache: vi.fn(),
  createTransportBooking: vi.fn(),
  getTransportBooking: vi.fn(),
  upsertDriverJournal: vi.fn(),
  signDriverJournal: vi.fn(),
  createLimsReport: vi.fn(),
  verifyLimsReport: vi.fn(),
}));

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

vi.mock('../../legacy/experimental/gpsTrackingService', () => ({
  addGpsPosition: mocks.addGpsPosition,
  getGpsTrack: mocks.getGpsTrack,
  getLatestPosition: mocks.getLatestGpsPosition,
}));

vi.mock('../../legacy/experimental/marketIntelService', () => ({
  getMarketSnapshot: mocks.getMarketSnapshot,
  invalidateMarketCache: mocks.invalidateMarketCache,
}));

vi.mock('../../server/services/transportDispatchService', () => ({
  createTransportBooking: mocks.createTransportBooking,
  getTransportBooking: mocks.getTransportBooking,
  upsertDriverJournal: mocks.upsertDriverJournal,
  signDriverJournal: mocks.signDriverJournal,
}));

vi.mock('../../server/services/limsService', () => ({
  createLimsReport: mocks.createLimsReport,
  verifyLimsReport: mocks.verifyLimsReport,
}));

import logisticsRoutes from '../../server/routes/logistics.routes';

const app = express();
app.use(express.json());
app.use(logisticsRoutes);

function authHeader(role: 'ADMIN' | 'CONSULTANT' = 'ADMIN') {
  return `Bearer ${
    createTokenPair({
      id: role === 'ADMIN' ? 'admin-1' : 'user-1',
      organisationId: 'org-1',
      bankidId: role === 'ADMIN' ? 'admin:one' : 'consultant:one',
      role,
    }).accessToken
  }`;
}

describe('logistics.routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.addGpsPosition.mockResolvedValue({ id: 'gps-1' });
    mocks.getGpsTrack.mockResolvedValue({ bookingId: 'booking-1', positions: [] });
    mocks.getLatestGpsPosition.mockResolvedValue({ id: 'gps-latest' });
    mocks.getMarketSnapshot.mockResolvedValue({ updatedAt: '2026-01-01T10:00:00.000Z' });
    mocks.createTransportBooking.mockResolvedValue({ id: 'booking-1' });
    mocks.getTransportBooking.mockResolvedValue({ id: 'booking-1' });
    mocks.upsertDriverJournal.mockResolvedValue({ id: 'journal-1' });
    mocks.signDriverJournal.mockResolvedValue({ id: 'journal-1', status: 'VERIFIED' });
    mocks.createLimsReport.mockResolvedValue({ id: 'report-1' });
    mocks.verifyLimsReport.mockResolvedValue({ id: 'report-1', verifiedByHuman: true });
  });

  it('validates gps update coordinates before calling the service', async () => {
    const res = await request(app)
      .post('/api/projects/project-1/transport/booking-1/gps/update')
      .set('Authorization', authHeader())
      .send({});

    expect(res.status).toBe(400);
    expect(mocks.addGpsPosition).not.toHaveBeenCalled();
  });

  it('stores gps updates and returns track snapshots', async () => {
    const update = await request(app)
      .post('/api/projects/project-1/transport/booking-1/gps/update')
      .set('Authorization', authHeader())
      .send({
        lat: 59.33,
        lng: 18.07,
        speedKmh: 50,
      });

    expect(update.status).toBe(200);
    expect(mocks.addGpsPosition).toHaveBeenCalledWith({
      bookingId: 'booking-1',
      projectId: 'project-1',
      lat: 59.33,
      lng: 18.07,
      altitude: undefined,
      speedKmh: 50,
      heading: undefined,
      accuracy: undefined,
      actingUserId: 'admin-1',
    });

    const track = await request(app)
      .get('/api/projects/project-1/transport/booking-1/gps')
      .set('Authorization', authHeader());

    expect(track.status).toBe(200);
    expect(track.body?.track?.bookingId).toBe('booking-1');
  });

  it('returns 404 for missing latest gps positions', async () => {
    mocks.getLatestGpsPosition.mockResolvedValueOnce(null);

    const res = await request(app)
      .get('/api/projects/project-1/transport/booking-1/gps/latest')
      .set('Authorization', authHeader());

    expect(res.status).toBe(404);
  });

  it('serves market prices and protects cache invalidation for admins', async () => {
    const prices = await request(app).get('/api/market-intel/prices').set('Authorization', authHeader());
    expect(prices.status).toBe(200);
    expect(prices.body?.snapshot?.updatedAt).toBe('2026-01-01T10:00:00.000Z');

    const forbidden = await request(app)
      .post('/api/market-intel/cache/invalidate')
      .set('Authorization', authHeader('CONSULTANT'));
    expect(forbidden.status).toBe(403);

    const allowed = await request(app)
      .post('/api/market-intel/cache/invalidate')
      .set('Authorization', authHeader('ADMIN'));
    expect(allowed.status).toBe(200);
    expect(mocks.invalidateMarketCache).toHaveBeenCalled();
  });

  it('creates and loads transport bookings', async () => {
    const created = await request(app)
      .post('/api/transport/bookings')
      .set('Authorization', authHeader())
      .send({
        quote: { id: 'quote-1' },
        plannedPickupAt: '2026-01-01T10:00:00.000Z',
      });

    expect(created.status).toBe(200);
    expect(mocks.createTransportBooking).toHaveBeenCalledWith(
      { id: 'quote-1' },
      { plannedPickupAt: '2026-01-01T10:00:00.000Z' },
    );

    mocks.getTransportBooking.mockResolvedValueOnce(null);
    const missing = await request(app)
      .get('/api/transport/bookings/booking-1')
      .set('Authorization', authHeader());
    expect(missing.status).toBe(404);

    const found = await request(app)
      .get('/api/transport/bookings/booking-2')
      .set('Authorization', authHeader());
    expect(found.status).toBe(200);
    expect(mocks.getTransportBooking).toHaveBeenLastCalledWith('booking-2');
  });

  it('upserts and signs transport journals', async () => {
    const journal = await request(app)
      .post('/api/transport/journals')
      .set('Authorization', authHeader())
      .send({
        bookingId: 'booking-1',
      });
    expect(journal.status).toBe(200);
    expect(mocks.upsertDriverJournal).toHaveBeenCalledWith({
      journal: {
        bookingId: 'booking-1',
      },
    });

    const signed = await request(app)
      .post('/api/transport/journals/journal-1/sign')
      .set('Authorization', authHeader())
      .send({
        role: 'REVIEWER',
        signatureId: 'sig-review',
      });
    expect(signed.status).toBe(200);
    expect(mocks.signDriverJournal).toHaveBeenCalledWith({
      journalId: 'journal-1',
      signerRole: 'REVIEWER',
      signatureId: 'sig-review',
    });
  });

  it('creates and verifies lims reports', async () => {
    const create = await request(app).post('/api/lims/reports').set('Authorization', authHeader()).send({
      sampleId: 'sample-1',
    });
    expect(create.status).toBe(200);
    expect(mocks.createLimsReport).toHaveBeenCalledWith({
      sampleId: 'sample-1',
    });

    const verify = await request(app)
      .post('/api/lims/reports/report-1/verify')
      .set('Authorization', authHeader())
      .send({
        signatureId: 'sig-lims',
        approved: true,
      });
    expect(verify.status).toBe(200);
    expect(mocks.verifyLimsReport).toHaveBeenCalledWith({
      reportId: 'report-1',
      reviewer: 'admin-1',
      signatureId: 'sig-lims',
      approved: true,
    });
  });

  it('returns 401 when no auth token on gps update', async () => {
    const res = await request(app)
      .post('/api/projects/project-1/transport/booking-1/gps/update')
      .send({ lat: 59.0, lng: 18.0 });

    expect(res.status).toBe(401);
    expect(mocks.addGpsPosition).not.toHaveBeenCalled();
  });

  it('returns 400 when transport service throws on booking creation', async () => {
    mocks.createTransportBooking.mockRejectedValueOnce(new Error('Bokningsfel'));

    const res = await request(app)
      .post('/api/transport/bookings')
      .set('Authorization', authHeader())
      .send({ quote: { id: 'q-1' }, plannedPickupAt: '2026-01-01T10:00:00.000Z' });

    expect(res.status).toBe(400);
  });

  it('defaults signerRole to DRIVER when role is omitted', async () => {
    const res = await request(app)
      .post('/api/transport/journals/journal-1/sign')
      .set('Authorization', authHeader())
      .send({ signatureId: 'sig-no-role' });

    expect(res.status).toBe(200);
    expect(mocks.signDriverJournal).toHaveBeenCalledWith(expect.objectContaining({ signerRole: 'DRIVER' }));
  });

  it('returns 400 when lims createLimsReport throws', async () => {
    mocks.createLimsReport.mockRejectedValueOnce(new Error('LIMS DB error'));

    const res = await request(app)
      .post('/api/lims/reports')
      .set('Authorization', authHeader())
      .send({ sampleId: 'bad-sample' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when getGpsTrack throws', async () => {
    mocks.getGpsTrack.mockRejectedValueOnce(new Error('GPS DB error'));

    const res = await request(app)
      .get('/api/projects/project-1/transport/booking-1/gps')
      .set('Authorization', authHeader());

    expect(res.status).toBe(400);
  });
});
