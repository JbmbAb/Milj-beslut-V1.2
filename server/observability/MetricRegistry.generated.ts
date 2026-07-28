// AUTO-GENERATED FILE — DO NOT EDIT
// Generated from metrics-contract.yaml via scripts/generate-metric-registry.ts

import { metrics, type Counter, type Histogram, type ObservableGauge } from '@opentelemetry/api';
import type { MetricType } from './MetricContract';

const meter = metrics.getMeter('mimer-platform.rag', 'mimer-observability.v2');

export interface MetricRegistryEntry {
  readonly instrument: Counter | Histogram | ObservableGauge;
  readonly type: MetricType;
  readonly requiredLabels: readonly string[];
  readonly allowedLabels: readonly string[];
}

export const mimer_request_total = meter.createCounter('mimer_request_total', { description: "Total number of pipeline requests" });
export const mimer_node_execution_duration = meter.createHistogram('mimer_node_execution_duration', { unit: "ms", description: "Per-node execution duration" });
export const mimer_llm_duration = meter.createHistogram('mimer_llm_duration', { unit: "ms" });
export const mimer_llm_input_tokens_total = meter.createCounter('mimer_llm_input_tokens_total', {});
export const mimer_llm_output_tokens_total = meter.createCounter('mimer_llm_output_tokens_total', {});
export const mimer_llm_cost_estimate = meter.createHistogram('mimer_llm_cost_estimate', { unit: "SEK" });
export const mimer_observability_contract_violation_total = meter.createCounter('mimer_observability_contract_violation_total', {});

export const MetricRegistry: Readonly<Record<string, MetricRegistryEntry>> = {
  mimer_request_total: {
    instrument: mimer_request_total,
    type: 'counter',
    requiredLabels: ["pipeline","pipeline_version","registry_version","observability_schema_version","municipality","case_type","geo_mode"],
    allowedLabels: [],
  },
  mimer_node_execution_duration: {
    instrument: mimer_node_execution_duration,
    type: 'histogram',
    requiredLabels: ["pipeline","pipeline_version","registry_version","observability_schema_version","node_id","capability_id","status"],
    allowedLabels: ["municipality","case_type"],
  },
  mimer_llm_duration: {
    instrument: mimer_llm_duration,
    type: 'histogram',
    requiredLabels: ["pipeline","pipeline_version","registry_version","observability_schema_version","node_id","capability_id","model_id","provider","status"],
    allowedLabels: ["municipality","case_type"],
  },
  mimer_llm_input_tokens_total: {
    instrument: mimer_llm_input_tokens_total,
    type: 'counter',
    requiredLabels: ["pipeline","pipeline_version","registry_version","observability_schema_version","node_id","capability_id","model_id","provider","status"],
    allowedLabels: [],
  },
  mimer_llm_output_tokens_total: {
    instrument: mimer_llm_output_tokens_total,
    type: 'counter',
    requiredLabels: ["pipeline","pipeline_version","registry_version","observability_schema_version","node_id","capability_id","model_id","provider","status"],
    allowedLabels: [],
  },
  mimer_llm_cost_estimate: {
    instrument: mimer_llm_cost_estimate,
    type: 'histogram',
    requiredLabels: ["pipeline","pipeline_version","registry_version","observability_schema_version","node_id","capability_id","model_id","provider","status","currency"],
    allowedLabels: [],
  },
  mimer_observability_contract_violation_total: {
    instrument: mimer_observability_contract_violation_total,
    type: 'counter',
    requiredLabels: ["metric_name","reason","observability_schema_version"],
    allowedLabels: [],
  },
} as const;

export const REGISTRY_METRIC_NAMES = Object.keys(MetricRegistry) as readonly string[];

