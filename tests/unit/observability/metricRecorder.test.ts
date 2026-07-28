import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createExecutionIdentity } from '../../../server/observability/ExecutionIdentity';
import { createObservationContext } from '../../../server/observability/ObservationContext';
import { MetricRecorder } from '../../../server/observability/MetricRecorder';
import { MetricAttributes } from '../../../server/observability/MetricAttributes';
import {
  mimer_request_total,
  REGISTRY_METRIC_NAMES,
} from '../../../server/observability/MetricRegistry.generated';
import { OBSERVABILITY_SCHEMA_VERSION } from '../../../server/observability/MetricContract';
import { loadMetricsContractFile, loadMetricContracts } from '../../../server/observability/contract-loader';
import { diffRegistryVsContract } from '../../../server/observability/startup-validation';
import { ExporterAdapter } from '../../../server/observability/ExporterAdapter';

function baseIdentity() {
  return createExecutionIdentity(
    'rag-demo',
    '1.0.0',
    'pipehash',
    'manifesthash',
    'exechash',
    'registry-1',
    'contract-hash',
    OBSERVABILITY_SCHEMA_VERSION,
  );
}

describe('MetricRecorder v2', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('recordRequest adds mimer_request_total with request labels', () => {
    const addSpy = vi.spyOn(mimer_request_total, 'add');
    const ctx = createObservationContext(baseIdentity(), {
      municipality: 'Mariestad',
      caseType: 'avlopp',
      geoMode: 'postgis',
    });

    MetricRecorder.recordRequest(ctx);

    expect(addSpy).toHaveBeenCalledWith(1, MetricAttributes.request(ctx));
  });

  it('safeRecord records violation and skips primary metric on forbidden label', () => {
    const addSpy = vi.spyOn(mimer_request_total, 'add');
    // Noop OTel may share Counter instances; assert no successful request attrs were emitted.
    MetricRecorder.safeRecord('mimer_request_total', mimer_request_total, 1, {
      ...MetricAttributes.request(
        createObservationContext(baseIdentity(), {
          municipality: 'X',
          caseType: 'Y',
          geoMode: 'Z',
        }),
      ),
      request_id: 'should-be-forbidden',
    });

    const successfulPrimary = addSpy.mock.calls.some(([, attrs]) => {
      const a = attrs as Record<string, unknown> | undefined;
      return Boolean(a && 'municipality' in a && !('metric_name' in a));
    });
    expect(successfulPrimary).toBe(false);

    const violation = addSpy.mock.calls.some(([, attrs]) => {
      const a = attrs as Record<string, unknown> | undefined;
      return a?.metric_name === 'mimer_request_total';
    });
    expect(violation).toBe(true);
  });

  it('safeRecord records violation when required label missing', () => {
    const addSpy = vi.spyOn(mimer_request_total, 'add');

    MetricRecorder.safeRecord('mimer_request_total', mimer_request_total, 1, {
      pipeline: 'p',
      pipeline_version: '1',
      registry_version: 'r',
      observability_schema_version: OBSERVABILITY_SCHEMA_VERSION,
      // missing municipality / case_type / geo_mode
    });

    const successfulPrimary = addSpy.mock.calls.some(([, attrs]) => {
      const a = attrs as Record<string, unknown> | undefined;
      return Boolean(a && 'municipality' in a && !('metric_name' in a));
    });
    expect(successfulPrimary).toBe(false);

    const violation = addSpy.mock.calls.some(([, attrs]) => {
      const a = attrs as Record<string, unknown> | undefined;
      return (
        a?.metric_name === 'mimer_request_total' &&
        typeof a.reason === 'string' &&
        a.reason.includes('saknar obligatoriska')
      );
    });
    expect(violation).toBe(true);
  });
});

describe('metrics contract v2', () => {
  it('matches MetricRegistry names and labels', () => {
    const file = loadMetricsContractFile();
    expect(file.schema_version).toBe(OBSERVABILITY_SCHEMA_VERSION);
    expect(loadMetricContracts().map((c) => c.name).sort()).toEqual(
      [...REGISTRY_METRIC_NAMES].sort(),
    );
    const drift = diffRegistryVsContract();
    expect(drift.missingInRegistry).toEqual([]);
    expect(drift.extraInRegistry).toEqual([]);
    expect(drift.labelMismatches).toEqual([]);
  });
});

describe('ExporterAdapter', () => {
  it('start is idempotent', () => {
    const adapter = new ExporterAdapter();
    adapter.start();
    adapter.start();
    expect(adapter.isStarted()).toBe(true);
  });
});
