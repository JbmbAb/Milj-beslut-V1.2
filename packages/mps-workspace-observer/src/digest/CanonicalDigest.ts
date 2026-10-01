/**
 * WORKSPACE-LIFECYCLE-CONTROLLER-V1 — domain-separated observation digests.
 *
 * This is a REUSE of the Phase 0-frozen canonicalization primitive, not a second canonicaliser.
 * Spec A11/B6 forbid writing another one, so this module contributes exactly two things the
 * primitive does not have: the frozen domain framing, and the structural payload restrictions
 * P1-P7 that make the primitive's lossy cases unreachable.
 *
 * Primitive:  @miljobeslut/mps-canonical 0.1.0 :: DefaultCanonicalJson.toBytes
 *             pinned by canonicalizer-contract-v1.json primitivePin.sourceSha256, which the
 *             repository files at canonical base 0d7b2bd566b0d5f7c9d27d645c941acd66cb1e85
 *             reproduce byte for byte (asserted by CanonicalDigest.pin.test.ts).
 *
 * Framing (canonicalizer-contract-v1.json `framing`):
 *   preimage = uint32be(len(schemaId)) || schemaId || uint32be(len(payload)) || payload
 *   digest   = lowercase hex SHA-256(preimage)
 *
 * Both components are length-prefixed, so a preimage under SNAPSHOT_V1 can never be a prefix of,
 * or equal to, one under a different domain.
 *
 * identityDigest is NOT a CAS content_hash. content_hash (BLAKE3, over a signed artifact envelope
 * that includes provenance and timestamps) answers "did the persisted artifact change";
 * identityDigest answers "did the observed world change". A9 deliberately keeps observedAt,
 * durations and versions out of this digest, so using content_hash as the V2 compare-and-swap
 * condition would differ on every re-observation of an untouched machine, and the condition would
 * end up loosened to compensate. Different algorithm, different framing, different question — the
 * two are never aliased (A13).
 */
import { createHash } from 'node:crypto';
import { DefaultCanonicalJson } from '@miljobeslut/mps-canonical';

/**
 * The acceptance whitelist from canonicalizer-contract-v1.json `domains`.
 *
 * CAPTURE_BUNDLE_V1 is Phase 0's; it is listed so the harness can RECOMPUTE a frozen corpus
 * captureDigest during load-time verification. V1 never mints one. SNAPSHOT_V1 is the domain
 * reserved for V1's identityDigest.
 */
export const DOMAINS = Object.freeze({
  CAPTURE_BUNDLE_V1: 'CAPTURE_BUNDLE_V1',
  SNAPSHOT_V1: 'SNAPSHOT_V1',
} as const);

export type CanonicalDomain = (typeof DOMAINS)[keyof typeof DOMAINS];

/** framing.schemaIdAcceptance: non-empty ASCII, ^[A-Z][A-Z0-9_]*$, at most 64 bytes. */
const SCHEMA_ID_RE = /^[A-Z][A-Z0-9_]*$/;

export interface PayloadViolation {
  readonly path: string;
  readonly rule: string;
  readonly detail: string;
}

/** P4: ASCII keys, never integer-like, so JSON.stringify property order equals sorted order. */
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;
/** P4: rejected because a re-implementation that rebuilds an object key by key can corrupt them. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * P3 without requiring the ES2024 `String.prototype.isWellFormed` lib: a well-formed string has no
 * lone surrogate. A high surrogate must be followed by a low one, and a low one must be preceded.
 */
function isWellFormedString(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i += 1;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/**
 * Structural restrictions P1-P6 from canonicalizer-contract-v1.json payloadRestrictions.
 *
 * These are contract, not implementation detail: each one removes a case where the primitive is
 * lossy, or where two conforming re-implementations could disagree on the produced bytes.
 *
 * P7 (NFC stability) is deliberately NOT enforced here but reported separately by
 * {@link nonNfcPaths}, because the frozen rule is to STOP for adjudication rather than to
 * silently normalise — the caller decides, exactly as Phase 0 did.
 */
export function validatePayload(
  value: unknown,
  path = '$',
  out: PayloadViolation[] = [],
  seen: Set<object> = new Set(),
): PayloadViolation[] {
  if (value === undefined) {
    out.push({
      path,
      rule: 'NO_UNDEFINED',
      detail:
        'undefined is not a payload value (absent object fields are expressed by omission) (P1)',
    });
    return out;
  }
  if (value === null || typeof value === 'boolean') return out;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      out.push({
        path,
        rule: 'FINITE_NUMBER',
        detail: `non-finite number ${String(value)} would collapse to null (P2)`,
      });
    } else if (!Number.isSafeInteger(value)) {
      out.push({
        path,
        rule: 'SAFE_INTEGER',
        detail: `numbers must be integers with |n| <= 2^53-1; got ${value} (P2)`,
      });
    }
    return out;
  }
  if (typeof value === 'bigint') {
    out.push({
      path,
      rule: 'NO_BIGINT',
      detail: 'bigint is not JSON-serializable by the primitive (P5)',
    });
    return out;
  }
  if (typeof value === 'string') {
    if (!isWellFormedString(value)) {
      out.push({ path, rule: 'WELL_FORMED_STRING', detail: 'lone surrogate in string (P3)' });
    }
    return out;
  }
  if (typeof value === 'function' || typeof value === 'symbol') {
    out.push({
      path,
      rule: 'UNSUPPORTED_TYPE',
      detail: `${typeof value} is not a payload value (P5)`,
    });
    return out;
  }
  if (
    value instanceof Date ||
    value instanceof Uint8Array ||
    value instanceof Map ||
    value instanceof Set
  ) {
    out.push({
      path,
      rule: 'NO_DATE_BINARY_MAP_SET',
      detail:
        'Date/Uint8Array are transformed and Map/Set collapse to {} in the primitive; encode as string/array/plain object (P5)',
    });
    return out;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      out.push({ path, rule: 'NO_CYCLES', detail: 'cyclic or self-referential payload (P6)' });
      return out;
    }
    seen.add(value);
    value.forEach((v, i) => validatePayload(v, `${path}[${i}]`, out, seen));
    seen.delete(value);
    return out;
  }
  if (typeof value === 'object') {
    if (seen.has(value)) {
      out.push({ path, rule: 'NO_CYCLES', detail: 'cyclic or self-referential payload (P6)' });
      return out;
    }
    seen.add(value);
    const proto = Object.getPrototypeOf(value) as unknown;
    if (proto !== Object.prototype && proto !== null) {
      out.push({
        path,
        rule: 'PLAIN_OBJECT',
        detail: 'only plain objects (prototype Object.prototype or null) are allowed (P5)',
      });
    }
    for (const k of Object.keys(value as object)) {
      if (FORBIDDEN_KEYS.has(k)) {
        out.push({
          path: `${path}.${k}`,
          rule: 'FORBIDDEN_KEY',
          detail:
            'the keys __proto__, constructor and prototype are rejected: a re-implementation that rebuilds an object key by key can lose or corrupt them (P4)',
        });
      } else if (!KEY_RE.test(k)) {
        out.push({
          path: `${path}.${k}`,
          rule: 'ASCII_KEY',
          detail:
            'object keys must match ^[A-Za-z_][A-Za-z0-9_.:-]*$ (ASCII, never integer-like) so that JSON.stringify property order equals sorted code-unit order (P4)',
        });
      }
      validatePayload((value as Record<string, unknown>)[k], `${path}.${k}`, out, seen);
    }
    seen.delete(value);
    return out;
  }
  out.push({ path, rule: 'UNSUPPORTED_TYPE', detail: typeof value });
  return out;
}

const canon = new DefaultCanonicalJson();

/** Canonical payload bytes: exactly the pinned primitive, after the structural restrictions. */
export function canonicalBytes(value: unknown, opts: { validate?: boolean } = {}): Uint8Array {
  if (opts.validate !== false) {
    const violations = validatePayload(value);
    if (violations.length > 0) {
      throw new Error(
        `payload violates canonicalizer contract: ${JSON.stringify(violations.slice(0, 5))}`,
      );
    }
  }
  return canon.toBytes(value);
}

function assertDomain(schemaId: string): void {
  const bytes = Buffer.from(schemaId, 'utf8');
  if (bytes.length === 0 || bytes.length > 64 || !SCHEMA_ID_RE.test(schemaId)) {
    throw new Error(
      `schemaId ${JSON.stringify(schemaId)} is not acceptable: must match ^[A-Z][A-Z0-9_]*$ and be at most 64 bytes`,
    );
  }
}

/** preimage = uint32be(len(schemaId)) || schemaId || uint32be(len(payload)) || payload */
export function framePreimage(schemaId: string, payload: Uint8Array): Buffer {
  assertDomain(schemaId);
  const sid = Buffer.from(schemaId, 'utf8');
  const sidLen = Buffer.alloc(4);
  sidLen.writeUInt32BE(sid.length, 0);
  const payloadLen = Buffer.alloc(4);
  payloadLen.writeUInt32BE(payload.length, 0);
  return Buffer.concat([sidLen, sid, payloadLen, Buffer.from(payload)]);
}

export function framedDigestOfBytes(schemaId: string, payload: Uint8Array): string {
  return createHash('sha256').update(framePreimage(schemaId, payload)).digest('hex');
}

export function framedDigest(
  schemaId: string,
  value: unknown,
): { readonly bytes: Uint8Array; readonly digest: string } {
  const bytes = canonicalBytes(value);
  return { bytes, digest: framedDigestOfBytes(schemaId, bytes) };
}

/** Plain SHA-256 over file bytes: contract, manifest and expectations digests are unframed. */
export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * P7 reporting: string leaves the primitive would rewrite by NFC normalisation.
 *
 * A non-empty result on any replay-key field (argv, cwd, path) must stop the run for adjudication
 * rather than be normalised, because normalising it would turn every replay of that case into a
 * corpus miss.
 */
export function nonNfcPaths(value: unknown, path = '$', out: string[] = []): string[] {
  if (typeof value === 'string') {
    if (value.normalize('NFC') !== value) out.push(path);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => nonNfcPaths(v, `${path}[${i}]`, out));
    return out;
  }
  if (value !== null && typeof value === 'object') {
    for (const k of Object.keys(value as object)) {
      nonNfcPaths((value as Record<string, unknown>)[k], `${path}.${k}`, out);
    }
  }
  return out;
}
