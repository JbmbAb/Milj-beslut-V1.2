import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GetPropertyDetailsUseCase } from '../../../src/application/get-property-details.usecase';
import { AuditAction } from '../../../src/domain/audit';

describe('GetPropertyDetailsUseCase', () => {
  const mockGeoProvider = {
    fetchPropertyInfo: vi.fn(),
    searchMunicipality: vi.fn(),
    assessRisk: vi.fn(),
  };

  const mockAuditRepo = {
    save: vi.fn(),
    findByEntity: vi.fn(),
    findByUser: vi.fn(),
    findLatest: vi.fn(),
  };

  let useCase: GetPropertyDetailsUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    useCase = new GetPropertyDetailsUseCase(mockGeoProvider as any, mockAuditRepo as any);
  });

  it('should return null if property not found', async () => {
    mockGeoProvider.fetchPropertyInfo.mockResolvedValueOnce(null);

    const result = await useCase.execute({ designation: 'MISSING 1:1', userId: 'user-1' });

    expect(result).toBeNull();
    expect(mockAuditRepo.save).not.toHaveBeenCalled();
  });

  it('should return property and log access to audit trail', async () => {
    mockGeoProvider.fetchPropertyInfo.mockResolvedValueOnce({
      id: 'prop-1',
      designation: 'TEST 1:1',
      municipality: 'TEST CITY',
    });

    const result = await useCase.execute({
      designation: 'TEST 1:1',
      userId: 'user-1',
      projectId: 'proj-1',
    });

    expect(result?.designation).toBe('TEST 1:1');
    expect(mockAuditRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.ACCESS,
        entityType: 'Property',
        entityId: 'TEST 1:1',
        userId: 'user-1',
      }),
    );
  });
});
