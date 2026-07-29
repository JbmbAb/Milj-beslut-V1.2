import { assertValidUnicodeString } from './unicode';

/**
 * Strict RFC8785-compatible canonical JSON serialization (C-01).
 * Fail-fast on unsafe types and circular references.
 */
export function canonicalizeStrict(val: unknown, seen: Set<unknown> = new Set()): string {
  if (val === null) return 'null';
  if (typeof val === 'boolean') return val ? 'true' : 'false';

  if (typeof val === 'number') {
    if (!Number.isFinite(val)) {
      throw new TypeError(
        `Computational Error: Invalid number value '${val}' detected. NaN and Infinities are forbidden.`,
      );
    }
    if (val === 0 && 1 / val === -Infinity) {
      return '0';
    }
    return JSON.stringify(val);
  }

  if (typeof val === 'string') {
    assertValidUnicodeString(val);
    return JSON.stringify(val);
  }

  if (val instanceof RegExp) {
    throw new TypeError("Semantic Error: Unsupported built-in type 'RegExp'.");
  }
  if (val instanceof Map) {
    throw new TypeError("Semantic Error: Unsupported built-in type 'Map'.");
  }
  if (val instanceof Set) {
    throw new TypeError("Semantic Error: Unsupported built-in type 'Set'.");
  }
  if (val instanceof URL) {
    throw new TypeError("Semantic Error: Unsupported built-in type 'URL'.");
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(val)) {
    throw new TypeError("Semantic Error: Unsupported built-in type 'Buffer'.");
  }
  if (val instanceof Uint8Array || val instanceof ArrayBuffer) {
    throw new TypeError("Semantic Error: Unsupported built-in type 'TypedArray/ArrayBuffer'.");
  }
  if (typeof val === 'undefined') {
    throw new TypeError("Programmer Error: 'undefined' values are strictly forbidden.");
  }
  if (typeof val === 'symbol') {
    throw new TypeError("Programmer Error: 'symbol' types cannot be deterministically serialized.");
  }
  if (typeof val === 'function') {
    throw new TypeError('Programmer Error: Serialization of functions is strictly forbidden.');
  }
  if (typeof val === 'bigint') {
    throw new TypeError("Programmer Error: 'bigint' is forbidden.");
  }
  if (val instanceof Date) {
    throw new TypeError("Semantic Error: Implicit 'Date' serialization is forbidden.");
  }

  if (typeof val === 'object') {
    if (seen.has(val)) {
      throw new TypeError('Circular Reference Error: A circular reference was detected.');
    }
    seen.add(val);
  }

  if (Array.isArray(val)) {
    const items = val.map((item) => canonicalizeStrict(item, seen));
    seen.delete(val);
    return `[${items.join(',')}]`;
  }

  if (typeof val === 'object' && val !== null) {
    const proto = Object.getPrototypeOf(val);
    if (proto !== null && proto !== Object.prototype) {
      throw new TypeError('Programmer Error: Complex class instances cannot be serialized.');
    }

    const keys = Object.keys(val).sort();
    const pairs = keys.map((key) => {
      assertValidUnicodeString(key);
      const strKey = JSON.stringify(key);
      const strVal = canonicalizeStrict((val as Record<string, unknown>)[key], seen);
      return `${strKey}:${strVal}`;
    });
    seen.delete(val);
    return `{${pairs.join(',')}}`;
  }

  throw new TypeError(`Programmer Error: Unsupported type encountered: ${typeof val}`);
}
