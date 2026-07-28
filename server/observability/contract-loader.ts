import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import type { MetricContract } from './MetricContract';

export interface MetricsContractFile {
  readonly artifact_version: string;
  readonly schema_version: string;
  readonly metrics_contract_hash: string;
  readonly meter?: string;
  readonly metrics: readonly {
    name: string;
    type: string;
    description?: string;
    unit?: string;
    metric_hash?: string;
    required_labels?: string[];
    allowed_labels?: string[];
    buckets?: number[];
  }[];
}

function contractPath(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), 'metrics-contract.yaml');
}

export function loadMetricsContractFile(): MetricsContractFile {
  const content = fs.readFileSync(contractPath(), 'utf8');
  const parsed = parseYaml(content) as Partial<MetricsContractFile> | null;

  if (!parsed || !Array.isArray(parsed.metrics)) {
    throw new Error('metrics-contract.yaml saknar metrics-definition');
  }

  return {
    artifact_version: parsed.artifact_version ?? 'unknown',
    schema_version: parsed.schema_version ?? 'unknown',
    metrics_contract_hash: parsed.metrics_contract_hash ?? 'unknown',
    meter: parsed.meter,
    metrics: parsed.metrics,
  };
}

export function loadMetricContracts(): readonly MetricContract[] {
  const file = loadMetricsContractFile();

  return file.metrics.map(
    (metric): MetricContract => ({
      name: metric.name,
      type: metric.type as MetricContract['type'],
      description: metric.description,
      unit: metric.unit,
      buckets: metric.buckets,
      metricHash: metric.metric_hash,
      requiredLabels: metric.required_labels ?? [],
      allowedLabels: metric.allowed_labels ?? [],
    }),
  );
}
