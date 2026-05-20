import { describe, expect, it, vi } from 'vitest';
import { GeoController } from '../../src/api/geo.api';

const geoUseCaseMocks = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock('../../src/application/get-property-details.usecase', () => ({
  GetPropertyDetailsUseCase: class {
    execute = geoUseCaseMocks.execute;
  },
}));

describe('src/api/geo.api', () => {
  it('validates lookup input and delegates to the use case', async () => {
    const geoProvider = {} as any;
    const geoRepo = {
      findByProject: vi.fn().mockResolvedValue([{ id: 'a1' }]),
    } as any;
    const auditRepo = {} as any;
    const controller = new GeoController(geoProvider, geoRepo, auditRepo);

    geoUseCaseMocks.execute.mockResolvedValue({ designation: '1:23' });

    await expect(controller.getProperty({ designation: '1:23', projectId: 'p1' }, 'user-1')).resolves.toEqual(
      {
        designation: '1:23',
      },
    );
    await expect(controller.getProjectAssessments('project-1')).resolves.toEqual([{ id: 'a1' }]);
    expect(geoUseCaseMocks.execute).toHaveBeenCalledWith({
      designation: '1:23',
      projectId: 'p1',
      userId: 'user-1',
    });
  });

  it('rejects invalid property lookup payloads', async () => {
    const controller = new GeoController({} as any, { findByProject: vi.fn() } as any, {} as any);

    await expect(controller.getProperty({ designation: 'ab' }, 'user-1')).rejects.toThrow();
  });
});
