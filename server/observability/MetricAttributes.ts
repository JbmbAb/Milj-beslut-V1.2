import type { Attributes } from '@opentelemetry/api';
import type { ObservationContext } from './ObservationContext';

export const MetricAttributes = {
  base: (ctx: ObservationContext): Attributes => ({
    pipeline: ctx.pipelineId,
    pipeline_version: ctx.pipelineVersion,
    registry_version: ctx.registryVersion,
    observability_schema_version: ctx.observabilitySchemaVersion,
  }),

  request: (ctx: ObservationContext): Attributes => ({
    ...MetricAttributes.base(ctx),
    municipality: ctx.municipality,
    case_type: ctx.caseType,
    geo_mode: ctx.geoMode,
  }),

  node: (ctx: ObservationContext, status: string): Attributes => ({
    ...MetricAttributes.base(ctx),
    node_id: ctx.nodeId ?? 'unknown',
    capability_id: ctx.capabilityId ?? 'unknown',
    status,
  }),

  llm: (ctx: ObservationContext, status: string): Attributes => ({
    ...MetricAttributes.base(ctx),
    node_id: ctx.nodeId ?? 'unknown',
    capability_id: ctx.capabilityId ?? 'unknown',
    model_id: ctx.modelId ?? 'unknown',
    provider: ctx.provider ?? 'unknown',
    status,
  }),
};
