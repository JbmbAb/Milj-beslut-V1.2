import crypto from 'node:crypto';
import { canonicalize } from './canonicalize';
import { stripEnvelope } from '../artifact/aes';

export { stripEnvelope } from '../artifact/aes';

/**
 * AES-1.0 payload hash:
 *   sha256(canonicalize(stripEnvelope(payload)))
 *
 * Envelope fields (artifactHash, artifactId, signature, signingKeyId) are excluded.
 */
export function hashArtifactPayload(payload: unknown): string {
  const stripped =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? stripEnvelope(payload as Record<string, unknown>)
      : payload;
  const json = JSON.stringify(canonicalize(stripped));
  return `sha256:${crypto.createHash('sha256').update(json).digest('hex')}`;
}

/**
 * Canonical artifact hash helper. Prefer this name at call sites that create AES artifacts.
 * Equivalent to {@link hashArtifactPayload}.
 */
export function hashArtifact(value: unknown): string {
  return hashArtifactPayload(value);
}
