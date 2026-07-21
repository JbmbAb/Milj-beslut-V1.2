import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UpdateGpsPositionUseCase } from '../../../src/application/update-gps-position.usecase';

describe('UpdateGpsPositionUseCase', () => {
  const mockLogisticsRepo = {
    addGpsPosition: vi.fn((p) => Promise.resolve(p)),
    getLatestPosition: vi.fn().mockResolvedValue(null),
    getGpsTrack: vi.fn(),
    clearGpsTrack: vi.fn(),
  };

  const mockAuditRepo = {
    save: vi.fn(),
    findByEntity: vi.fn(),
    findByUser: vi.fn(),
    findLatest: vi.fn(),
  };

  let useCase: UpdateGpsPositionUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    useCase = new UpdateGpsPositionUseCase(mockLogisticsRepo as any, mockAuditRepo as any);
  });

  it('should save a new GPS position with a hash', async () => {
    const input = {
      bookingId: 'b1',
      projectId: 'p1',
      lat: 59.3293,
      lng: 18.0686,
      userId: 'u1',
    };

    const result = await useCase.execute(input);

    expect(result.bookingId).toBe('b1');
    expect(result.hash).toBeDefined();
    expect(result.prevHash).toBeNull();
    expect(mockLogisticsRepo.addGpsPosition).toHaveBeenCalled();
  });

  it('should link to previous hash if available', async () => {
    mockLogisticsRepo.getLatestPosition.mockResolvedValueOnce({ hash: 'prev-hash-123' });

    const input = {
      bookingId: 'b1',
      projectId: 'p1',
      lat: 59.3294,
      lng: 18.0687,
      userId: 'u1',
    };

    const result = await useCase.execute(input);

    expect(result.prevHash).toBe('prev-hash-123');
    expect(result.hash).not.toBe('prev-hash-123');
  });
});
