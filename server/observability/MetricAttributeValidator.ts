import type { Attributes } from '@opentelemetry/api';
import { MetricRegistry } from './MetricRegistry.generated';

export function validateMetricAttributes(
  metricName: string,
  attributes: Attributes,
): string[] {
  const registry = MetricRegistry[metricName];
  if (!registry) {
    return [`Unknown metric: ${metricName}`];
  }

  const keys = Object.keys(attributes);

  const invalid = keys.filter(
    (k) => !registry.requiredLabels.includes(k) && !registry.allowedLabels.includes(k),
  );

  const missingRequired = registry.requiredLabels.filter((label) => !keys.includes(label));

  const violations: string[] = [];

  if (invalid.length) {
    violations.push(`Metric ${metricName} har otillåtna attribut: ${invalid.join(', ')}`);
  }

  if (missingRequired.length) {
    violations.push(
      `Metric ${metricName} saknar obligatoriska attribut: ${missingRequired.join(', ')}`,
    );
  }

  return violations;
}
