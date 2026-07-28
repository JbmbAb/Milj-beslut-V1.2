import { logger } from '../logger';
import { loadMetricContracts, loadMetricsContractFile } from './contract-loader';
import { MetricRegistry, REGISTRY_METRIC_NAMES } from './MetricRegistry.generated';
import { OBSERVABILITY_SCHEMA_VERSION } from './MetricContract';

function labelsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

export function diffRegistryVsContract(): {
  missingInRegistry: string[];
  extraInRegistry: string[];
  labelMismatches: string[];
} {
  const contracts = loadMetricContracts();
  const contractNames = new Set(contracts.map((c) => c.name));
  const registryNames = new Set(REGISTRY_METRIC_NAMES);

  const missingInRegistry = [...contractNames].filter((n) => !registryNames.has(n)).sort();
  const extraInRegistry = [...registryNames].filter((n) => !contractNames.has(n)).sort();

  const labelMismatches: string[] = [];
  for (const c of contracts) {
    const entry = MetricRegistry[c.name];
    if (!entry) continue;
    if (!labelsEqual(entry.requiredLabels, c.requiredLabels)) {
      labelMismatches.push(`${c.name}: required_labels drift`);
    }
    if (!labelsEqual(entry.allowedLabels, c.allowedLabels)) {
      labelMismatches.push(`${c.name}: allowed_labels drift`);
    }
  }

  return { missingInRegistry, extraInRegistry, labelMismatches };
}

/**
 * Startup contract validation.
 * Production: process.exit(1) on mismatch.
 * Development: warn and continue.
 */
export function validateObservabilityStartup(): void {
  logger.info('Observability startup validation...');

  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    logger.warn('OTel exporter saknas (OTEL_EXPORTER_OTLP_ENDPOINT)');
  }

  if (!process.env.PIPELINE_VERSION) {
    logger.warn('Pipeline-version saknas (PIPELINE_VERSION)');
  }

  try {
    const file = loadMetricsContractFile();
    if (file.schema_version !== OBSERVABILITY_SCHEMA_VERSION) {
      logger.warn('Metrics contract schema_version mismatch', {
        contract: file.schema_version,
        code: OBSERVABILITY_SCHEMA_VERSION,
      });
    }

    const { missingInRegistry, extraInRegistry, labelMismatches } = diffRegistryVsContract();
    const hasDrift =
      missingInRegistry.length > 0 ||
      extraInRegistry.length > 0 ||
      labelMismatches.length > 0;

    if (hasDrift) {
      logger.error('Observability contract mismatch', {
        missingInRegistry,
        extraInRegistry,
        labelMismatches,
      });

      if (process.env.NODE_ENV === 'production') {
        logger.error('Production startup blocked due to metrics contract drift');
        process.exit(1);
      }

      logger.warn('Development mode: continuing despite mismatch');
      return;
    }

    logger.info('Observability contract OK', {
      metrics: REGISTRY_METRIC_NAMES.length,
      schema: OBSERVABILITY_SCHEMA_VERSION,
      metrics_contract_hash: file.metrics_contract_hash,
    });
  } catch (err) {
    logger.error('Observability startup validation failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }
}
