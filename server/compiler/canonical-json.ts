/** Deterministic JSON stringify (sorted object keys) for stable hashing. */
export function canonicalJSONStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalJSONStringify).join(',')}]`;
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();

  const parts = keys.map(
    (key) => `${JSON.stringify(key)}:${canonicalJSONStringify(obj[key])}`,
  );

  return `{${parts.join(',')}}`;
}
