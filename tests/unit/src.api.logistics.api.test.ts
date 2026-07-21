import { describe, expect, it, vi } from 'vitest';
import { LogisticsController } from '../../src/api/logistics.api';

const logisticsUseCaseMocks = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock('../../src/application/update-gps-position.usecase', () => ({
  UpdateGpsPositionUseCase: class {
    execute = logisticsUseCaseMocks.execute;
  },
}));

describe('src/api/logistics.api', () => {
  it('validates GPS payloads and delegates repo/provider reads', async () => {
    const logisticsRepo = {
      getGpsTrack: vi.fn().mockResolvedValue([{ lat: 1, lng: 2 }]),
      getLatestPosition: vi.fn().mockResolvedValue({ lat: 3, lng: 4 }),
    } as any;
    const auditRepo = {} as any;
    const marketIntelProvider = {
      getSnapshot: vi.fn().mockResolvedValue({ priceIndex: 123 }),
    } as any;
    const controller = new LogisticsController(logisticsRepo, auditRepo, marketIntelProvider);

    logisticsUseCaseMocks.execute.mockResolvedValue({ saved: true });

    await expect(
      controller.updateGps('booking-1', 'project-1', { lat: 59.3, lng: 18.1, speedKmh: 50 }, 'user-1'),
    ).resolves.toEqual({ saved: true });
    await expect(controller.getGpsTrack('booking-1')).resolves.toEqual([{ lat: 1, lng: 2 }]);
    await expect(controller.getLatestGps('booking-1')).resolves.toEqual({ lat: 3, lng: 4 });
    await expect(controller.getMarketPrices()).resolves.toEqual({ priceIndex: 123 });

    expect(logisticsUseCaseMocks.execute).toHaveBeenCalledWith({
      bookingId: 'booking-1',
      projectId: 'project-1',
      lat: 59.3,
      lng: 18.1,
      altitude: undefined,
      speedKmh: 50,
      heading: undefined,
      accuracy: undefined,
      userId: 'user-1',
    });
  });

  it('rejects invalid GPS coordinates', async () => {
    const controller = new LogisticsController(
      { getGpsTrack: vi.fn(), getLatestPosition: vi.fn() } as any,
      {} as any,
      { getSnapshot: vi.fn() } as any,
    );

    await expect(
      controller.updateGps('booking-1', 'project-1', { lat: 123, lng: 18.1 }, 'user-1'),
    ).rejects.toThrow();
  });
});
