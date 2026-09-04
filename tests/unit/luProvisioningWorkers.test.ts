import { describe, expect, it, vi, beforeEach } from 'vitest';

const {
  startLuProjectContextBootstrapWorker,
  startLocalizationIdentityProvisioningWorker,
  startViewerCapabilityProvisioningWorker,
  startGeometrySupersessionProvisioningWorker,
} = vi.hoisted(() => ({
  startLuProjectContextBootstrapWorker: vi.fn(() => setInterval(() => undefined, 60_000)),
  startLocalizationIdentityProvisioningWorker: vi.fn(() => setInterval(() => undefined, 60_000)),
  startViewerCapabilityProvisioningWorker: vi.fn(() => setInterval(() => undefined, 60_000)),
  startGeometrySupersessionProvisioningWorker: vi.fn(() => setInterval(() => undefined, 60_000)),
}));

vi.mock('../../server/services/luProjectContextBootstrapWorker', () => ({
  startLuProjectContextBootstrapWorker,
}));
vi.mock('../../server/services/luExecutionIdentityV3ProvisioningWorker', () => ({
  startLocalizationIdentityProvisioningWorker,
}));
vi.mock('../../server/services/luViewerCapabilityProvisioningWorker', () => ({
  startViewerCapabilityProvisioningWorker,
}));
vi.mock('../../server/services/luGeometrySupersessionProvisioningWorker', () => ({
  startGeometrySupersessionProvisioningWorker,
}));

import {
  describeLuProvisioningWorkerAvailability,
  startLuProvisioningWorkers,
} from '../../server/workers/luProvisioningWorkers';

describe('PROJECT-CONTEXT-BOOTSTRAP-WORKER-OPS-01: luProvisioningWorkers', () => {
  beforeEach(() => {
    startLuProjectContextBootstrapWorker.mockClear();
    startLocalizationIdentityProvisioningWorker.mockClear();
    startViewerCapabilityProvisioningWorker.mockClear();
    startGeometrySupersessionProvisioningWorker.mockClear();
  });

  it('starts all LU workers when their issuer private keys are configured', () => {
    const handle = startLuProvisioningWorkers({
      strict: false,
      env: {
        PROJECT_CONTEXT_BINDING_ISSUER_PRIVATE_KEY_PEM: 'project-private',
        LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM: 'identity-private',
        VIEWER_CAPABILITY_ISSUER_PRIVATE_KEY_PEM: 'viewer-private',
        LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PRIVATE_KEY_PEM: 'geometry-private',
      },
    });

    expect(handle.started).toEqual([
      'project-context-bootstrap',
      'execution-identity-v3',
      'viewer-capability',
      'geometry-supersession',
    ]);
    expect(startLuProjectContextBootstrapWorker).toHaveBeenCalledTimes(1);
    expect(startLocalizationIdentityProvisioningWorker).toHaveBeenCalledTimes(1);
    expect(startViewerCapabilityProvisioningWorker).toHaveBeenCalledTimes(1);
    expect(startGeometrySupersessionProvisioningWorker).toHaveBeenCalledTimes(1);
    handle.stop();
  });

  it('skips optional LU workers when their private keys are absent', () => {
    const handle = startLuProvisioningWorkers({
      strict: false,
      env: {
        PROJECT_CONTEXT_BINDING_ISSUER_PRIVATE_KEY_PEM: 'project-private',
      },
    });

    expect(handle.started).toEqual(['project-context-bootstrap']);
    expect(handle.skipped.map((entry) => entry.id)).toEqual([
      'execution-identity-v3',
      'viewer-capability',
      'geometry-supersession',
    ]);
    handle.stop();
  });

  it('describes worker availability for operator diagnostics', () => {
    const availability = describeLuProvisioningWorkerAvailability({
      PROJECT_CONTEXT_BINDING_ISSUER_PRIVATE_KEY_PEM: 'project-private',
    });
    expect(availability.find((entry) => entry.id === 'project-context-bootstrap')).toMatchObject({
      configured: true,
      required: true,
    });
    expect(availability.find((entry) => entry.id === 'viewer-capability')).toMatchObject({
      configured: false,
      required: false,
    });
  });
});
