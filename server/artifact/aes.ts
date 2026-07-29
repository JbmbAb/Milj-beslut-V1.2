/**
 * Artifact Envelope Specification (AES-1.0)
 *
 * Envelope fields MUST NOT participate in payload hashing or signatures.
 */

export const AES_VERSION = 'AES-1.0' as const;

/** Fields excluded from payload hash and signature bytes. */
export const AES_ENVELOPE_FIELDS = [
  'artifactHash',
  'artifactId',
  'signature',
  'signingKeyId',
] as const;

export type AesEnvelopeField = (typeof AES_ENVELOPE_FIELDS)[number];

export type AesEnvelope = {
  readonly artifactHash: string;
  readonly artifactId: string;
  readonly signature?: string;
  readonly signingKeyId?: string;
};

const ENVELOPE_SET = new Set<string>(AES_ENVELOPE_FIELDS);

/**
 * Remove AES envelope fields from a payload (shallow key filter, recursive values unchanged).
 * Does not mutate the input.
 */
export function stripEnvelope<T extends Record<string, unknown>>(payload: T): Omit<T, AesEnvelopeField> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (ENVELOPE_SET.has(key)) continue;
    out[key] = value;
  }
  return out as Omit<T, AesEnvelopeField>;
}

export function isEnvelopeField(key: string): key is AesEnvelopeField {
  return ENVELOPE_SET.has(key);
}
