/**
 * Canonical byte representation.
 *
 * All hashing, signing, and verification SHALL operate
 * on CanonicalBytes, never on runtime objects.
 */
export interface CanonicalBytes {
  readonly bytes: Uint8Array;
  readonly encoding: "utf-8";
}
