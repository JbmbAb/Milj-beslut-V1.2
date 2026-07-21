import { z } from 'zod';
import { ILogisticsRepository } from '../domain/logistics-repository.interface';
import { IAuditRepository } from '../domain/audit-repository.interface';
import { IMarketIntelProvider } from '../domain/market-intel';
import { UpdateGpsPositionUseCase } from '../application/update-gps-position.usecase';

export const GpsUpdateSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  altitude: z.number().optional(),
  speedKmh: z.number().optional(),
  heading: z.number().optional(),
  accuracy: z.number().optional(),
});

export class LogisticsController {
  private updateGpsUseCase: UpdateGpsPositionUseCase;

  constructor(
    private logisticsRepo: ILogisticsRepository,
    private auditRepo: IAuditRepository,
    private marketIntelProvider: IMarketIntelProvider,
  ) {
    this.updateGpsUseCase = new UpdateGpsPositionUseCase(logisticsRepo, auditRepo);
  }

  async updateGps(bookingId: string, projectId: string, data: unknown, userId: string) {
    const validated = GpsUpdateSchema.parse(data);
    return await this.updateGpsUseCase.execute({
      bookingId,
      projectId,
      lat: validated.lat,
      lng: validated.lng,
      altitude: validated.altitude,
      speedKmh: validated.speedKmh,
      heading: validated.heading,
      accuracy: validated.accuracy,
      userId,
    });
  }

  async getGpsTrack(bookingId: string) {
    return await this.logisticsRepo.getGpsTrack(bookingId);
  }

  async getLatestGps(bookingId: string) {
    return await this.logisticsRepo.getLatestPosition(bookingId);
  }

  async getMarketPrices() {
    return await this.marketIntelProvider.getSnapshot();
  }
}
