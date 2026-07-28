export const ForbiddenMetricLabels = [
  'request_id',
  'trace_id',
  'document_id',
  'property_id',
  'user_id',
] as const;

export type ForbiddenMetricLabel = (typeof ForbiddenMetricLabels)[number];

export const CardinalityPolicy = {
  forbidden: ForbiddenMetricLabels,
} as const;
