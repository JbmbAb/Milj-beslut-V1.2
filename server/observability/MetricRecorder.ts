import type { Attributes, Counter, Histogram } from '@opentelemetry/api';
import { MetricAttributes } from './MetricAttributes';
import { validateMetricAttributes } from './MetricAttributeValidator';
import { validateCardinality } from './CardinalityValidator';
import type { ObservationContext } from './ObservationContext';
import { OBSERVABILITY_SCHEMA_VERSION } from './MetricContract';

import {
  mimer_request_total,
  mimer_node_execution_duration,
  mimer_llm_duration,
  mimer_llm_input_tokens_total,
  mimer_llm_output_tokens_total,
  mimer_llm_cost_estimate,
  mimer_observability_contract_violation_total,
} from './MetricRegistry.generated';

type Instrument = Counter | Histogram;

function schemaVersionFrom(attrs: Attributes): string {
  const v = attrs.observability_schema_version;
  return typeof v === 'string' && v.length > 0 ? v : OBSERVABILITY_SCHEMA_VERSION;
}

export const MetricRecorder = {
  safeRecord(
    metricName: string,
    instrument: Instrument,
    value: number,
    attrs: Attributes,
  ): void {
    const schemaViolations = validateMetricAttributes(metricName, attrs);
    const cardinalityViolations = validateCardinality(metricName, attrs);
    const violations = [...schemaViolations, ...cardinalityViolations];

    if (violations.length > 0) {
      for (const reason of violations) {
        mimer_observability_contract_violation_total.add(1, {
          metric_name: metricName,
          reason,
          observability_schema_version: schemaVersionFrom(attrs),
        });
      }
      return;
    }

    if ('add' in instrument && typeof instrument.add === 'function') {
      instrument.add(value, attrs);
    } else if ('record' in instrument && typeof instrument.record === 'function') {
      instrument.record(value, attrs);
    }
  },

  recordRequest(ctx: ObservationContext): void {
    const attrs = MetricAttributes.request(ctx);
    MetricRecorder.safeRecord('mimer_request_total', mimer_request_total, 1, attrs);
  },

  recordNodeExecution(ctx: ObservationContext, durationMs: number, status: string): void {
    const attrs = MetricAttributes.node(ctx, status);
    MetricRecorder.safeRecord(
      'mimer_node_execution_duration',
      mimer_node_execution_duration,
      durationMs,
      attrs,
    );
  },

  recordLlmCall(
    ctx: ObservationContext,
    durationMs: number,
    inputTokens: number,
    outputTokens: number,
    cost: number,
    status: string,
  ): void {
    const attrs = MetricAttributes.llm(ctx, status);

    MetricRecorder.safeRecord('mimer_llm_duration', mimer_llm_duration, durationMs, attrs);
    MetricRecorder.safeRecord(
      'mimer_llm_input_tokens_total',
      mimer_llm_input_tokens_total,
      inputTokens,
      attrs,
    );
    MetricRecorder.safeRecord(
      'mimer_llm_output_tokens_total',
      mimer_llm_output_tokens_total,
      outputTokens,
      attrs,
    );
    MetricRecorder.safeRecord('mimer_llm_cost_estimate', mimer_llm_cost_estimate, cost, {
      ...attrs,
      currency: 'SEK',
    });
  },
};
