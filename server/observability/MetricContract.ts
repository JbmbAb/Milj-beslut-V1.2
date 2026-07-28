export type MetricType = 'counter' | 'histogram' | 'gauge' | 'observable_gauge';

export interface MetricContract {
  readonly name: string;
  readonly type: MetricType;
  readonly description?: string;
  readonly unit?: string;
  readonly buckets?: readonly number[];
  readonly metricHash?: string;
  readonly requiredLabels: readonly string[];
  readonly allowedLabels: readonly string[];
}

export const OBSERVABILITY_SCHEMA_VERSION = 'mimer-observability.v2';
