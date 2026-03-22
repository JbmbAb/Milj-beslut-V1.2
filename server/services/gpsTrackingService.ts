/**
 * gpsTrackingService.ts
 *
 * GPS-spårning av transporter i realtid.
 *
 * Lagrar GPS-positioner per bokning i en in-process circular buffer.
 * Varje position hashas och kedjehashlas för tamper-evident spårning
 * (samma pattern som AuditTrail).
 *
 * I produktion ersätts bufferten med en time-series databas (InfluxDB/TimescaleDB).
 *
 * Endpoints (via secureApi.express.ts):
 *   POST /api/projects/:projectId/transport/:bookingId/gps/update
 *   GET  /api/projects/:projectId/transport/:bookingId/gps
 *   GET  /api/projects/:projectId/transport/:bookingId/gps/latest
 */

import crypto from 'node:crypto';
import { logger } from '../logger';
import * as gpsRepo from '../repositories/gpsRepository';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GpsPosition {
  id: string;
  bookingId: string;
  lat: number;
  lng: number;
  altitude?: number;
  speedKmh?: number;
  heading?: number;
  accuracy?: number;
  timestamp: string;
  hash: string;
  prevHash: string | null;
}

export interface GpsTrack {
  bookingId: string;
  positions: GpsPosition[];
  totalDistance?: number; // km, estimated
}

// ─── In-process store replaced by Database ───────────────────────────────────
// ─── Helpers ──────────────────────────────────────────────────────────────────

function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Service ──────────────────────────────────────────────────────────────────

export async function addGpsPosition(params: {
  bookingId: string;
  projectId: string;
  lat: number;
  lng: number;
  altitude?: number;
  speedKmh?: number;
  heading?: number;
  accuracy?: number;
  actingUserId: string;
}): Promise<GpsPosition> {
  const { bookingId, lat, lng } = params;

  if (lat < -90 || lat > 90) throw new Error('lat måste vara mellan -90 och 90');
  if (lng < -180 || lng > 180) throw new Error('lng måste vara mellan -180 och 180');

  const latest = await gpsRepo.getLatestPosition(bookingId);
  const prevHash = latest?.hash ?? null;
  const timestamp = new Date().toISOString();
  
  const payload = JSON.stringify({ bookingId, lat, lng, timestamp, prevHash });
  const hash = crypto.createHash('sha256').update(payload).digest('hex');

  const row = await gpsRepo.addGpsPosition({
    bookingId,
    lat,
    lng,
    altitude: params.altitude,
    speedKmh: params.speedKmh,
    heading: params.heading,
    accuracy: params.accuracy,
    hash,
    prevHash,
  });

  const position: GpsPosition = {
    ...row,
    timestamp: row.timestamp.toISOString(),
  };

  // Log significant position updates to AuditTrail (e.g. periodically)
  // We can't easily check array length without a count query, but for now we'll log hash
  logger.debug('gps-tracking: position added', { bookingId, lat, lng, hash });
  
  return position;
}

export async function getGpsTrack(bookingId: string): Promise<GpsTrack> {
  const rows = await gpsRepo.getGpsTrack(bookingId);
  const positions: GpsPosition[] = rows.map(r => ({ ...r, timestamp: r.timestamp.toISOString() }));

  let totalDistance = 0;
  for (let i = 1; i < positions.length; i++) {
    const prev = positions[i - 1];
    const curr = positions[i];
    totalDistance += haversineKm(prev.lat, prev.lng, curr.lat, curr.lng);
  }

  return {
    bookingId,
    positions,
    totalDistance: Math.round(totalDistance * 10) / 10,
  };
}

/**
 * Hämta senaste positionen för en bokning.
 */
export async function getLatestPosition(bookingId: string): Promise<GpsPosition | null> {
  const row = await gpsRepo.getLatestPosition(bookingId);
  if (!row) return null;
  return { ...row, timestamp: row.timestamp.toISOString() };
}

/**
 * Rensa GPS-spår för avslutade transporter (ADMIN).
 */
export async function clearGpsTrack(bookingId: string): Promise<void> {
  await gpsRepo.clearGpsTrack(bookingId);
}
