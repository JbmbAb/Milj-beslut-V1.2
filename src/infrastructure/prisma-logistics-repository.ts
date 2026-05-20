import { prisma } from '../../db.server';
import { ILogisticsRepository } from '../domain/logistics-repository.interface';
import { TransportBooking, StorageArea, GpsPosition, TransportStatus } from '../domain/logistics';

const PROJECT_REFERENCE_PREFIX = 'project:';

export class PrismaLogisticsRepository implements ILogisticsRepository {
  private toProjectReference(projectId: string): string {
    return `${PROJECT_REFERENCE_PREFIX}${projectId}`;
  }

  private fromProjectReference(externalReference: string | null | undefined): string {
    if (!externalReference?.startsWith(PROJECT_REFERENCE_PREFIX)) {
      return '';
    }
    return externalReference.slice(PROJECT_REFERENCE_PREFIX.length);
  }

  async saveBooking(booking: TransportBooking): Promise<TransportBooking> {
    const data = {
      wasteCode: booking.wasteCode,
      tons: booking.tons,
      status: booking.status,
      plannedDeliveryAt: booking.plannedDate,
      // Default values for required fields in schema that aren't in domain yet
      quoteId: 'legacy-migrated',
      provider: 'EXTERNAL',
      receiverId: booking.destinationAreaId || 'UNKNOWN',
      receiverName: 'Migrated Receiver',
      distanceKm: 0,
      co2EstimateKg: 0,
      plannedPickupAt: booking.plannedDate,
      // The new domain model is project-centric, while the legacy table is not.
      // We persist a stable adapter reference here until the schema is aligned.
      externalReference: this.toProjectReference(booking.projectId),
    };

    const upserted = await prisma.transportBooking.upsert({
      where: { id: booking.id },
      update: data,
      create: { ...data, id: booking.id },
    });

    return this.mapBookingToDomain(upserted);
  }

  async findBookingsByProject(projectId: string): Promise<TransportBooking[]> {
    const bookings = await prisma.transportBooking.findMany({
      where: { externalReference: this.toProjectReference(projectId) },
    });
    return bookings.map(this.mapBookingToDomain);
  }

  async saveStorageArea(area: StorageArea): Promise<StorageArea> {
    // Note: Schema doesn't have a specific StorageArea model yet,
    // it's partially handled in ProjectPlanState or could be a new table.
    // For now, we stub this or use ProjectPlanState if appropriate.
    return area;
  }

  async findStorageAreasByProject(_projectId: string): Promise<StorageArea[]> {
    return [];
  }

  // ─── GPS Tracking ──────────────────────────────────────────────────────────

  async addGpsPosition(pos: GpsPosition): Promise<GpsPosition> {
    const saved = await prisma.gpsPosition.create({
      data: {
        id: pos.id,
        bookingId: pos.bookingId,
        lat: pos.lat,
        lng: pos.lng,
        altitude: pos.altitude,
        speedKmh: pos.speedKmh,
        heading: pos.heading,
        accuracy: pos.accuracy,
        timestamp: pos.timestamp,
        hash: pos.hash,
        prevHash: pos.prevHash,
      },
    });

    return {
      ...saved,
      prevHash: saved.prevHash ?? null,
    };
  }

  async getGpsTrack(bookingId: string): Promise<GpsPosition[]> {
    const positions = await prisma.gpsPosition.findMany({
      where: { bookingId },
      orderBy: { timestamp: 'asc' },
    });

    return positions.map((p) => ({
      ...p,
      prevHash: p.prevHash ?? null,
    }));
  }

  async getLatestPosition(bookingId: string): Promise<GpsPosition | null> {
    const pos = await prisma.gpsPosition.findFirst({
      where: { bookingId },
      orderBy: { timestamp: 'desc' },
    });

    if (!pos) return null;

    return {
      ...pos,
      prevHash: pos.prevHash ?? null,
    };
  }

  async clearGpsTrack(bookingId: string): Promise<void> {
    await prisma.gpsPosition.deleteMany({
      where: { bookingId },
    });
  }

  private mapBookingToDomain(p: any): TransportBooking {
    return {
      id: p.id,
      projectId: this.fromProjectReference(p.externalReference),
      wasteCode: p.wasteCode,
      tons: p.tons,
      status: p.status as TransportStatus,
      destinationAreaId: p.receiverId,
      plannedDate: p.plannedDeliveryAt,
    };
  }
}
