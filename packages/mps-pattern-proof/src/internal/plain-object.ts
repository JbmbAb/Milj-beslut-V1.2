/**
 * PATTERN-PROOF-ENGINE-01 V1 -- the ONE plain-object predicate (R1 F18: one definition, not five).
 *
 * A plain object is a non-null, non-array object whose prototype is `Object.prototype` or `null`:
 * class instances, Maps, Dates and arrays are not admitted as records anywhere in this package.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}
