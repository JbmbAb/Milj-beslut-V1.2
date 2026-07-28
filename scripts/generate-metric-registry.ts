/**
 * Generate MetricRegistry.generated.ts from metrics-contract.yaml.
 *
 *   npm run otel:generate
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMetricsContractFile } from '../server/observability/contract-loader';

function escapeTsString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function main(): void {
  const contract = loadMetricsContractFile();
  const here = path.dirname(fileURLToPath(import.meta.url));
  const outPath = path.join(here, '..', 'server', 'observability', 'MetricRegistry.generated.ts');

  const lines: string[] = [];

  lines.push('// AUTO-GENERATED FILE — DO NOT EDIT');
  lines.push('// Generated from metrics-contract.yaml via scripts/generate-metric-registry.ts');
  lines.push('');
  lines.push(`import { metrics, type Counter, type Histogram, type ObservableGauge } from '@opentelemetry/api';`);
  lines.push(`import type { MetricType } from './MetricContract';`);
  lines.push('');
  lines.push(
    `const meter = metrics.getMeter('mimer-platform.rag', '${escapeTsString(contract.schema_version)}');`,
  );
  lines.push('');
  lines.push('export interface MetricRegistryEntry {');
  lines.push('  readonly instrument: Counter | Histogram | ObservableGauge;');
  lines.push('  readonly type: MetricType;');
  lines.push('  readonly requiredLabels: readonly string[];');
  lines.push('  readonly allowedLabels: readonly string[];');
  lines.push('}');
  lines.push('');

  for (const m of contract.metrics) {
    const options: string[] = [];
    if (m.unit) options.push(`unit: "${escapeTsString(m.unit)}"`);
    if (m.description) options.push(`description: "${escapeTsString(m.description)}"`);
    const opts = options.length ? `{ ${options.join(', ')} }` : '{}';

    const factory =
      m.type === 'counter'
        ? 'createCounter'
        : m.type === 'histogram'
          ? 'createHistogram'
          : 'createObservableGauge';

    lines.push(`export const ${m.name} = meter.${factory}('${m.name}', ${opts});`);
  }

  lines.push('');
  lines.push('export const MetricRegistry: Readonly<Record<string, MetricRegistryEntry>> = {');

  for (const m of contract.metrics) {
    lines.push(`  ${m.name}: {`);
    lines.push(`    instrument: ${m.name},`);
    lines.push(`    type: '${m.type}',`);
    lines.push(`    requiredLabels: ${JSON.stringify(m.required_labels ?? [])},`);
    lines.push(`    allowedLabels: ${JSON.stringify(m.allowed_labels ?? [])},`);
    lines.push('  },');
  }

  lines.push('} as const;');
  lines.push('');
  lines.push('export const REGISTRY_METRIC_NAMES = Object.keys(MetricRegistry) as readonly string[];');
  lines.push('');

  fs.writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8');
  console.log(`MetricRegistry.generated.ts updated (${contract.metrics.length} metrics)`);
}

main();
