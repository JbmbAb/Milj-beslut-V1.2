import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  leaseOnePendingBootstrapRequest,
  markBootstrapRequestCompleted,
  markBootstrapRequestFailed,
  executeProjectContextBootstrap,
} = vi.hoisted(() => ({
  leaseOnePendingBootstrapRequest: vi.fn(),
  markBootstrapRequestCompleted: vi.fn(),
  markBootstrapRequestFailed: vi.fn(),
  executeProjectContextBootstrap: vi.fn(),
}));

vi.mock('../../server/modules/localization/projectContextBootstrapRequestQueue', () => ({
  leaseOnePendingBootstrapRequest,
  markBootstrapRequestCompleted,
  markBootstrapRequestFailed,
}));

vi.mock('../../server/modules/localization/luProjectContextBootstrap', () => ({
  executeProjectContextBootstrap,
}));

import { processProjectContextBootstrapRequestsOnce } from '../../server/services/luProjectContextBootstrapWorker';

describe('PROJECT-CONTEXT-BOOTSTRAP-WORKER-OPS-01: bootstrap worker processing', () => {
  beforeEach(() => {
    leaseOnePendingBootstrapRequest.mockReset();
    markBootstrapRequestCompleted.mockReset();
    markBootstrapRequestFailed.mockReset();
    executeProjectContextBootstrap.mockReset();
  });

  it('returns 0 when the queue is empty', async () => {
    leaseOnePendingBootstrapRequest.mockResolvedValue(null);
    await expect(processProjectContextBootstrapRequestsOnce()).resolves.toBe(0);
    expect(executeProjectContextBootstrap).not.toHaveBeenCalled();
  });

  it('leases one request and marks it COMPLETED on success', async () => {
    leaseOnePendingBootstrapRequest.mockResolvedValue({
      id: 'req-1',
      projectId: 'proj-1',
      propertyDesignation: 'ORSA STACKMORA 3:12',
      leaseToken: 'lease-token-A',
    });
    executeProjectContextBootstrap.mockResolvedValue({
      ok: true,
      contextBindingArtifactId: 'project-context-binding-abc',
      reused: false,
    });
    markBootstrapRequestCompleted.mockResolvedValue({ ok: true });

    await expect(processProjectContextBootstrapRequestsOnce()).resolves.toBe(1);
    expect(markBootstrapRequestCompleted).toHaveBeenCalledWith(
      'req-1',
      'lease-token-A',
      'project-context-binding-abc',
    );
  });

  it('serializes overlapping poll ticks so only one active run processes at a time', async () => {
    let releaseLease!: () => void;
    const leaseBlocked = new Promise<void>((resolve) => {
      releaseLease = resolve;
    });
    leaseOnePendingBootstrapRequest.mockImplementation(async () => {
      await leaseBlocked;
      return {
        id: 'req-1',
        projectId: 'proj-1',
        propertyDesignation: 'ORSA STACKMORA 3:12',
        leaseToken: 'lease-token-A',
      };
    });
    executeProjectContextBootstrap.mockResolvedValue({
      ok: true,
      contextBindingArtifactId: 'project-context-binding-abc',
      reused: false,
    });
    markBootstrapRequestCompleted.mockResolvedValue({ ok: true });

    const first = processProjectContextBootstrapRequestsOnce();
    const second = processProjectContextBootstrapRequestsOnce();
    await Promise.resolve();
    expect(leaseOnePendingBootstrapRequest).toHaveBeenCalledTimes(1);

    releaseLease();
    await expect(first).resolves.toBe(1);
    await expect(second).resolves.toBe(0);
  });
});
