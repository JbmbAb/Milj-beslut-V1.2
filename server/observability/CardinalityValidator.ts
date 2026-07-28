import type { Attributes } from '@opentelemetry/api';
import { CardinalityPolicy, type ForbiddenMetricLabel } from './CardinalityPolicy';

const forbiddenSet = new Set<string>(CardinalityPolicy.forbidden);

export function validateCardinality(metricName: string, attributes: Attributes): string[] {
  const keys = Object.keys(attributes);
  const forbidden = keys.filter((k) => forbiddenSet.has(k as ForbiddenMetricLabel));

  if (forbidden.length === 0) return [];

  return [`Metric ${metricName} använder förbjudna labels: ${forbidden.join(', ')}`];
}
