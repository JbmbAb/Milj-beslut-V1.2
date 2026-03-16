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
import { appendDomainAudit } from '../security/auditTrail';
import { logger } from '../logger';

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

// ─── In-process store (circular buffer of 500 positions per booking) ─────────

const MAX_POS = 500;
const tracks = new Map<string, GpsPosition[]>();
const prevHashes = new Map<string, string>();

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

/**
 * Lägg till en ny GPS-position för en bokning.
 */
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
  const { bookingId, projectId, lat, lng } = params;

  if (lat < -90 || lat > 90) throw new Error('lat måste vara mellan -90 och 90');
  if (lng < -180 || lng > 180) throw new Error('lng måste vara mellan -180 och 180');

  const timestamp = new Date().toISOString();
  const prevHash = prevHashes.get(bookingId) ?? null;
  const payload = JSON.stringify({ bookingId, lat, lng, timestamp, prevHash });
  const hash = crypto.createHash('sha256').update(payload).digest('hex');

  const position: GpsPosition = {
    id: crypto.randomUUID(),
    bookingId,
    lat,
    lng,
    altitude: params.altitude,
    speedKmh: params.speedKmh,
    heading: params.heading,
    accuracy: params.accuracy,
    timestamp,
    hash,
    prevHash,
  };

  // Circular buffer
  if (!tracks.has(bookingId)) tracks.set(bookingId, []);
  const arr = tracks.get(bookingId)!;
  arr.push(position);
  if (arr.length > MAX_POS) arr.splice(0, arr.length - MAX_POS);
  prevHashes.set(bookingId, hash);

  // Log significant position updates to AuditTrail (every 10th position to avoid spam)
  if (arr.length % 10 === 0) {
    await appendDomainAudit({
      entityType: 'GPS_TRACK',
      entityId: bookingId,
      action: 'GPS_POSITION_BATCH',
      userId: params.actingUserId,
      payload: { projectId, lat, lng, positionCount: arr.length, hash },
    });
  }

  logger.debug('gps-tracking: position added', { bookingId, lat, lng });
  return position;
}

/**
 * Hämta hela GPS-spåret för en bokning.
 */
export function getGpsTrack(bookingId: string): GpsTrack {
  const positions = tracks.get(bookingId) ?? [];

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
export function getLatestPosition(bookingId: string): GpsPosition | null {
  const arr = tracks.get(bookingId);
  if (!arr || arr.length === 0) return null;
  return arr[arr.length - 1];
}

/**
 * Rensa GPS-spår för avslutade transporter (ADMIN).
 */
export function clearGpsTrack(bookingId: string): void {
  tracks.delete(bookingId);
  prevHashes.delete(bookingId);
}
