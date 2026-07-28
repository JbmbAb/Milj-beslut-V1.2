import { describe, it, expect, vi } from 'vitest';
import {
  PipelineCompiler,
  CapabilityResolutionPass,
  PolicyResolutionPass,
} from '../../../server/compiler';
import { PipelineEngine } from '../../../server/execution';
import { OBSERVABILITY_SCHEMA_VERSION } from '../../../server/observability/MetricContract';
import { mimer_request_total } from '../../../server/observability/MetricRegistry.generated';

describe('PipelineEngine', () => {
  it('executes stub nodes and records request metric', async () => {
    const compiler = new PipelineCompiler(
      new CapabilityResolutionPass([
        {
          id: 'impl-retrieve',
          capabilityId: 'retrieve',
          version: '1',
          runtimeProfile: 'cpu',
        },
      ]),
      new PolicyResolutionPass([{ id: 'pol', name: 'retrieve', config: {} }]),
    );

    const { pipeline } = await compiler.compile({
      id: 'mini',
      version: '1.0.0',
      nodes: [{ id: 'n1', capability: 'retrieve' }],
    });

    const addSpy = vi.spyOn(mimer_request_total, 'add');
    const engine = new PipelineEngine('reg-1', 'contract-hash', OBSERVABILITY_SCHEMA_VERSION);
    await engine.execute(pipeline, {
      municipality: 'Mariestad',
      caseType: 'avlopp',
      geoMode: 'postgis',
    });

    expect(addSpy).toHaveBeenCalled();
  });
});
