import { describe, expect, it } from 'vitest';
import {
  diagnoseStaleBootstrapRequest,
  webProcessHasProjectContextSigningKey,
} from '../../server/modules/localization/projectContextBootstrapDiagnostics';

describe('PROJECT-CONTEXT-BOOTSTRAP-WORKER-OPS-01: bootstrap diagnostics', () => {
  it('does not diagnose fresh PENDING requests', () => {
    const createdAt = new Date('2026-01-01T00:00:00Z');
    const now = new Date('2026-01-01T00:00:30Z');
    expect(
      diagnoseStaleBootstrapRequest({
        status: 'PENDING',
        createdAt,
        now,
        env: {},
      }),
    ).toBeNull();
  });

  it('diagnoses stale PENDING as worker likely unavailable when issuer key exists in env', () => {
    const createdAt = new Date('2026-01-01T00:00:00Z');
    const now = new Date('2026-01-01T00:02:00Z');
    const diagnostics = diagnoseStaleBootstrapRequest({
      status: 'PENDING',
      createdAt,
      now,
      env: { PROJECT_CONTEXT_BINDING_ISSUER_PRIVATE_KEY_PEM: 'private-key' },
    });
    expect(diagnostics).toMatchObject({
      code: 'WORKER_LIKELY_UNAVAILABLE',
      workerStartCommand: 'npm run worker:all',
      projectContextWorkerConfigured: true,
    });
  });

  it('diagnoses stale PENDING as worker not configured when issuer key is absent', () => {
    const createdAt = new Date('2026-01-01T00:00:00Z');
    const now = new Date('2026-01-01T00:02:00Z');
    const diagnostics = diagnoseStaleBootstrapRequest({
      status: 'LEASED',
      createdAt,
      now,
      env: {},
    });
    expect(diagnostics).toMatchObject({
      code: 'WORKER_NOT_CONFIGURED',
      workerStartCommand: 'npm run worker:all',
      projectContextWorkerConfigured: false,
    });
  });

  it('webProcessHasProjectContextSigningKey reflects env presence for operator visibility', () => {
    expect(webProcessHasProjectContextSigningKey({})).toBe(false);
    expect(
      webProcessHasProjectContextSigningKey({
        PROJECT_CONTEXT_BINDING_ISSUER_PRIVATE_KEY_PEM: 'private-key',
      }),
    ).toBe(true);
  });
});
