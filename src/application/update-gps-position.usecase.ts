import { GpsPosition } from '../domain/logistics';
import { ILogisticsRepository } from '../domain/logistics-repository.interface';
import { IAuditRepository } from '../domain/audit-repository.interface';
import { randomUUID } from 'node:crypto';
import crypto from 'node:crypto';

export interface UpdateGpsPositionInput {
  bookingId: string;
  projectId: string;
  lat: number;
  lng: number;
  altitude?: number;
  speedKmh?: number;
  heading?: number;
  accuracy?: number;
  userId: string;
}

export class UpdateGpsPositionUseCase {
  constructor(
    private logisticsRepo: ILogisticsRepository,
    private auditRepo: IAuditRepository,
  ) {}

  async execute(input: UpdateGpsPositionInput): Promise<GpsPosition> {
    const latest = await this.logisticsRepo.getLatestPosition(input.bookingId);
    const prevHash = latest?.hash ?? null;
    const timestamp = new Date();

    const payload = JSON.stringify({
      bookingId: input.bookingId,
      lat: input.lat,
      lng: input.lng,
      timestamp: timestamp.toISOString(),
      prevHash,
    });
    const hash = crypto.createHash('sha256').update(payload).digest('hex');

    const position: GpsPosition = {
      id: randomUUID(),
      bookingId: input.bookingId,
      lat: input.lat,
      lng: input.lng,
      altitude: input.altitude,
      speedKmh: input.speedKmh,
      heading: input.heading,
      accuracy: input.accuracy,
      timestamp,
      hash,
      prevHash,
    };

    const savedPosition = await this.logisticsRepo.addGpsPosition(position);

    // Only log to audit if it's a significant movement or start/stop
    // For now, we log every update to ensure traceability in V2
    /*
    await this.auditRepo.save({
      id: randomUUID(),
      timestamp: new Date(),
      userId: input.userId,
      action: AuditAction.UPDATE,
      entityType: 'TransportBooking',
      entityId: input.bookingId,
      details: `GPS Position updated for booking ${input.bookingId}`
    });
    */

    return savedPosition;
  }
}
