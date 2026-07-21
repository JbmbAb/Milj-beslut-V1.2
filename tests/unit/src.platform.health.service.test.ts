import { describe, expect, it, vi } from 'vitest';

const prismaMocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
}));

vi.mock('../../db.server', () => ({
  prisma: {
    $queryRaw: prismaMocks.queryRaw,
  },
}));

describe('src/platform/health.service', () => {
  it('returns UP when all components respond', async () => {
    const { HealthService } = await import('../../src/platform/health.service');
    prismaMocks.queryRaw.mockResolvedValue([1]);
    const projectRepo = {
      findById: vi.fn().mockResolvedValue(null),
    } as any;
    const aiService = {} as any;
    const service = new HealthService(projectRepo, aiService);

    const result = await service.check();

    expect(result.status).toBe('UP');
    expect(result.components.database.status).toBe('UP');
    expect(result.components.projectRepository.status).toBe('UP');
    expect(result.components.aiAdapter.status).toBe('UP');
  });

  it('returns DOWN when the database check fails and marks repo failures', async () => {
    const { HealthService } = await import('../../src/platform/health.service');
    prismaMocks.queryRaw.mockRejectedValue(new Error('db down'));
    const projectRepo = {
      findById: vi.fn().mockRejectedValue(new Error('repo down')),
    } as any;
    const service = new HealthService(projectRepo, {} as any);

    const result = await service.check();

    expect(result.status).toBe('DOWN');
    expect(result.components.database).toMatchObject({ status: 'DOWN', message: 'db down' });
    expect(result.components.projectRepository).toMatchObject({ status: 'DOWN', message: 'repo down' });
    expect(result.components.aiAdapter.status).toBe('UP');
  });
});
