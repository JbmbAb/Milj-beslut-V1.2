/**
 * W-CATCH2 #4: the bootstrap worker stores only the outcome's stable failureCode and neutral
 * failureDetail; the raw fault text (the outcome's internal `diagnostic`) goes to the server log next to
 * the code, so an operator still sees what happened -- and it is never stored on the request.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  outcome: null as unknown,
  failed: [] as Array<[string, string, string]>,
  warnings: [] as string[],
}));

vi.mock('../../server/db/prisma', async () => (await import('../helpers/hermeticPrismaGuard')).hermeticPrismaModule());
vi.mock('../../server/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn((message: string) => h.warnings.push(message)),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock('../../server/modules/localization/projectContextBootstrapRequestQueue', () => ({
  leaseOnePendingBootstrapRequest: vi.fn(async () => ({ id: 'req-1', projectId: 'proj-1', propertyDesignation: 'GÄVLE 1:1' })),
  markBootstrapRequestCompleted: vi.fn(async () => undefined),
  markBootstrapRequestFailed: vi.fn(async (id: string, code: string, detail: string) => {
    h.failed.push([id, code, detail]);
  }),
}));
vi.mock('../../server/modules/localization/luProjectContextBootstrap', () => ({
  executeProjectContextBootstrap: vi.fn(async () => h.outcome),
}));

import { processProjectContextBootstrapRequestsOnce } from '../../server/services/luProjectContextBootstrapWorker';

beforeEach(() => {
  h.failed.length = 0;
  h.warnings.length = 0;
});

describe('W-CATCH2 #4: the worker stores code + neutral text, and logs the diagnostic', () => {
  it('a classified failure: the stored detail is the neutral text; the raw diagnostic is only in the log', async () => {
    h.outcome = {
      ok: false,
      failureCode: 'BOOTSTRAP_EXECUTION_ERROR',
      failureDetail: 'Projektkontexten kunde inte etableras: ett tekniskt fel uppstod. Ett nytt försök kan lyckas.',
      retryable: true,
      diagnostic: "Error: EIO: i/o error, scandir 'D:\\mimer-demo\\cas\\objects'",
    };
    expect(await processProjectContextBootstrapRequestsOnce()).toBe(1);
    expect(h.failed).toEqual([['req-1', 'BOOTSTRAP_EXECUTION_ERROR', 'Projektkontexten kunde inte etableras: ett tekniskt fel uppstod. Ett nytt försök kan lyckas.']]);
    expect(h.warnings).toHaveLength(1);
    expect(h.warnings[0]).toContain('BOOTSTRAP_EXECUTION_ERROR');
    expect(h.warnings[0]).toContain("diagnostic: Error: EIO: i/o error, scandir 'D:\\mimer-demo\\cas\\objects'");
  });

  it('an outcome without a diagnostic is logged as before', async () => {
    h.outcome = { ok: false, failureCode: 'PROJECT_NOT_FOUND', failureDetail: 'no Project with id proj-1' };
    await processProjectContextBootstrapRequestsOnce();
    expect(h.failed).toEqual([['req-1', 'PROJECT_NOT_FOUND', 'no Project with id proj-1']]);
    expect(h.warnings).toEqual(['lu-bootstrap-worker: request req-1 FAILED (PROJECT_NOT_FOUND): no Project with id proj-1']);
  });
});
