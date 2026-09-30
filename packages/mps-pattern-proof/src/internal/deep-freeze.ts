/**
 * PATTERN-PROOF-ENGINE-01 V1 -- the ONE deep-freeze (R1 F18). Recursively freezes plain objects and
 * arrays in place and returns the same reference; an already-frozen node is not re-entered.
 */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as object)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}
