import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaLogisticsRepository } from '../../../src/infrastructure/prisma-logistics-repository';
import { prisma } from '../../../db.server';
import { TransportStatus } from '../../../src/domain/logistics';

vi.mock('../../../db.server', () => ({
  prisma: {
    transportBooking: {
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
    gpsPosition: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

describe('PrismaLogisticsRepository', () => {
  let repo: PrismaLogisticsRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new PrismaLogisticsRepository();
  });

  it('should add a GPS position', async () => {
    const pos = {
      id: 'g1',
      bookingId: 'b1',
      lat: 59,
      lng: 18,
      timestamp: new Date(),
      hash: 'h1',
      prevHash: null,
    };

    (prisma.gpsPosition.create as any).mockResolvedValue(pos);

    const result = await repo.addGpsPosition(pos);

    expect(result.id).toBe('g1');
    expect(prisma.gpsPosition.create).toHaveBeenCalled();
  });

  it('should get latest position', async () => {
    (prisma.gpsPosition.findFirst as any).mockResolvedValue({ id: 'latest', hash: 'lh' });
    const result = await repo.getLatestPosition('b1');
    expect(result?.id).toBe('latest');
  });

  it('should save booking via upsert', async () => {
    const booking = {
      id: 'b1',
      projectId: 'p1',
      wasteCode: '170504',
      tons: 10,
      status: TransportStatus.PLANNED,
      plannedDate: new Date(),
    };

    (prisma.transportBooking.upsert as any).mockResolvedValue({
      ...booking,
      plannedDeliveryAt: booking.plannedDate,
      receiverId: 'R1',
    });

    await repo.saveBooking(booking);
    expect(prisma.transportBooking.upsert).toHaveBeenCalled();
  });
});
