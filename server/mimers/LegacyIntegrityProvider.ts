import { canonicalize } from '../utils/canonicalize';
import { hashArtifactPayload } from '../utils/hashArtifact';
import type { IntegrityProvider } from './integrityProvider';

/**
 * Legacy provider: sorted-object tree + JSON.stringify sha256, with envelope strip
 * via hashArtifactPayload (Artifact Envelope Spec — not AES-GCM).
 */
export class LegacyIntegrityProvider implements IntegrityProvider {
  canonicalize(value: unknown): string {
    return JSON.stringify(canonicalize(value));
  }

  hash(value: unknown): string {
    return hashArtifactPayload(value);
  }

  hashSerialized(serialized: string): string {
    // Legacy path does not hash raw strings independently of object canonicalize.
    return hashArtifactPayload(JSON.parse(serialized) as unknown);
  }
}
