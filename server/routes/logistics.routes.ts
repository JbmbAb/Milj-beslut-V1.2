import express from 'express';
import { requireAuth } from '../security/auth';
import { rateLimitByUser } from '../security/rateLimit';
import { paginationSchema } from '../schemas/api.schemas';
import { toSafeErrorResponse } from '../security/secureErrors';
import {
  gpsTrackingService,
  limsService,
  marketIntelService,
  transportService,
} from '../modules/logistics/public';
import { routeParam } from '../utils/routeUtils';
import {
  countTransportBookings,
  listTransportBookingsPage,
} from '../modules/platform/public';

const router = express.Router();

// GPS Tracking
router.post(
  '/api/projects/:projectId/transport/:bookingId/gps/update',
  requireAuth,
  rateLimitByUser(120, 60_000),
  async (req, res) => {
    try {
      if (!req.authUser) {
        res.status(401).json({ ok: false, error: 'Unauthorized' });
        return;
      }
      const { lat, lng, altitude, speedKmh, heading, accuracy } = req.body as {
        lat?: number;
        lng?: number;
        altitude?: number;
        speedKmh?: number;
        heading?: number;
        accuracy?: number;
      };

      if (typeof lat !== 'number' || typeof lng !== 'number') {
        res.status(400).json({ ok: false, error: 'lat och lng (number) krävs' });
        return;
      }

      const position = await gpsTrackingService.addGpsPosition({
        bookingId: routeParam(req.params.bookingId),
        projectId: routeParam(req.params.projectId),
        lat,
        lng,
        altitude,
        speedKmh,
        heading,
        accuracy,
        actingUserId: req.authUser.id,
      });
      res.json({ ok: true, position });
    } catch (error: unknown) {
      res.status(400).json(toSafeErrorResponse(error));
    }
  },
);

router.get(
  '/api/projects/:projectId/transport/:bookingId/gps',
  requireAuth,
  rateLimitByUser(60, 60_000),
  async (req, res) => {
    try {
      const track = await gpsTrackingService.getGpsTrack(routeParam(req.params.bookingId));
      res.json({ ok: true, track });
    } catch (error: unknown) {
      res.status(400).json(toSafeErrorResponse(error));
    }
  },
);

router.get(
  '/api/projects/:projectId/transport/:bookingId/gps/latest',
  requireAuth,
  rateLimitByUser(120, 60_000),
  async (req, res) => {
    try {
      const position = await gpsTrackingService.getLatestPosition(routeParam(req.params.bookingId));
      if (!position) {
        res.status(404).json({ ok: false, error: 'Ingen position registrerad' });
        return;
      }
      res.json({ ok: true, position });
    } catch (error: unknown) {
      res.status(400).json(toSafeErrorResponse(error));
    }
  },
);

// Market Intelligence
router.get('/api/market-intel/prices', requireAuth, rateLimitByUser(60, 60_000), async (_req, res) => {
  try {
    const snapshot = await marketIntelService.getMarketSnapshot();
    res.json({ ok: true, snapshot });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.post('/api/market-intel/cache/invalidate', requireAuth, rateLimitByUser(5, 60_000), (req, res) => {
  if (!req.authUser || req.authUser.role !== 'ADMIN') {
    res.status(403).json({ ok: false, error: 'Admin required' });
    return;
  }
  marketIntelService.invalidateMarketCache();
  res.json({ ok: true });
});

// Transport & Bookings
router.get('/api/transport/bookings', requireAuth, rateLimitByUser(60, 60_000), async (req, res) => {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const total = await countTransportBookings();
    const skip = (page - 1) * limit;
    const bookings = await listTransportBookingsPage({ skip, take: limit });

    res.json({
      ok: true,
      bookings,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasMore: skip + limit < total,
    });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.post('/api/transport/bookings', requireAuth, async (req, res) => {
  try {
    const { quote, plannedPickupAt } = req.body;
    const booking = await transportService.createTransportBooking(quote, { plannedPickupAt });
    res.json({ ok: true, booking });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.get('/api/transport/bookings/:id', requireAuth, async (req, res) => {
  try {
    const booking = await transportService.getTransportBooking(routeParam(req.params.id));
    if (!booking) {
      res.status(404).json({ ok: false, error: 'Bokning saknas' });
      return;
    }
    res.json({ ok: true, booking });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.post('/api/transport/journals', requireAuth, async (req, res) => {
  try {
    const journal = await transportService.upsertDriverJournal({ journal: req.body });
    res.json({ ok: true, journal });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.post('/api/transport/journals/:id/sign', requireAuth, async (req, res) => {
  try {
    const journal = await transportService.signDriverJournal({
      journalId: routeParam(req.params.id),
      signerRole: req.body.role || 'DRIVER',
      signatureId: req.body.signatureId,
    });
    res.json({ ok: true, journal });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

// LIMS (Laboratory Information)
router.post('/api/lims/reports', requireAuth, async (req, res) => {
  try {
    const report = await limsService.createLimsReport(req.body);
    res.json({ ok: true, report });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.post('/api/lims/reports/:id/verify', requireAuth, async (req, res) => {
  try {
    const report = await limsService.verifyLimsReport({
      reportId: routeParam(req.params.id),
      reviewer: req.authUser?.id || 'Unknown',
      signatureId: req.body.signatureId,
      approved: req.body.approved,
    });
    res.json({ ok: true, report });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

export default router;
