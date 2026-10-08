/**
 * Small, strict value helpers shared by the schema checks. Pure.
 */
import { canonicalize } from 'json-canonicalize';

export type Rec = Record<string, unknown>;

export const HEX40 = /^[0-9a-f]{40}$/;
export const HEX64 = /^[0-9a-f]{64}$/;
/** Identifier charset of contract 3.4 rule 3 (ASCII only, so JCS' lack of Unicode normalisation cannot hide a homoglyph). */
export const IDENTIFIER = /^[A-Za-z0-9._:/@+=-]{1,256}$/;

export const isRecord = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

export const hasOwn = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

export const isHex40 = (v: unknown): v is string => typeof v === 'string' && HEX40.test(v);
export const isHex64 = (v: unknown): v is string => typeof v === 'string' && HEX64.test(v);
export const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
export const isNonNegativeInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export const isSafeInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);

/** Own enumerable string keys equal required plus any subset of optional. */
export function hasExactKeys(o: Rec, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Object.keys(o);
  for (const k of required) if (!hasOwn(o, k)) return false;
  const allowed = new Set<string>([...required, ...optional]);
  return keys.every((k) => allowed.has(k));
}

/** Bytewise (UTF-8) order, the order the contract uses for every set-like array. */
export function compareBytewise(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/** Strictly ascending (so also duplicate-free) under the given string key. Rejected, never silently sorted. */
export function strictlyAscending<T>(xs: readonly T[], key: (x: T) => string): boolean {
  for (let i = 1; i < xs.length; i += 1) {
    if (compareBytewise(key(xs[i - 1]!), key(xs[i]!)) >= 0) return false;
  }
  return true;
}

export const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** Structural equality of two JSON values, independent of object key order (compares their RFC 8785 forms). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  try {
    return canonicalize(a) === canonicalize(b);
  } catch {
    return false;
  }
}

/** Every string value (not key) of a JSON value, depth-first. */
export function collectStrings(value: unknown, into: string[] = []): string[] {
  if (typeof value === 'string') into.push(value);
  else if (Array.isArray(value)) for (const x of value) collectStrings(x, into);
  else if (isRecord(value)) for (const k of Object.keys(value)) collectStrings(value[k], into);
  return into;
}
