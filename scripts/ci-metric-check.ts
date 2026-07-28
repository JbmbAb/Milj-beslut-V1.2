/**
 * CI gate: metrics-contract.yaml ↔ MetricRegistry.generated
 *
 *   npm run otel:check
 */
import { loadMetricsContractFile } from '../server/observability/contract-loader';
import { OBSERVABILITY_SCHEMA_VERSION } from '../server/observability/MetricContract';
import { REGISTRY_METRIC_NAMES } from '../server/observability/MetricRegistry.generated';
import { diffRegistryVsContract } from '../server/observability/startup-validation';

function main(): void {
  console.log('CI: Checking metric contract consistency...');

  const file = loadMetricsContractFile();
  const errors: string[] = [];

  if (file.schema_version !== OBSERVABILITY_SCHEMA_VERSION) {
    errors.push(
      `schema_version mismatch: contract=${file.schema_version} code=${OBSERVABILITY_SCHEMA_VERSION}`,
    );
  }

  if (!file.metrics.length) {
    errors.push('metrics-contract.yaml has no metrics');
  }

  const { missingInRegistry, extraInRegistry, labelMismatches } = diffRegistryVsContract();
  for (const name of missingInRegistry) {
    errors.push(`Missing in registry: ${name}`);
  }
  for (const name of extraInRegistry) {
    errors.push(`Extra in registry: ${name}`);
  }
  for (const msg of labelMismatches) {
    errors.push(msg);
  }

  if (errors.length) {
    console.error('Metric contract mismatch!');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        schema: OBSERVABILITY_SCHEMA_VERSION,
        metrics: REGISTRY_METRIC_NAMES.length,
        names: [...REGISTRY_METRIC_NAMES],
        metrics_contract_hash: file.metrics_contract_hash,
      },
      null,
      2,
    ),
  );
}

main();
