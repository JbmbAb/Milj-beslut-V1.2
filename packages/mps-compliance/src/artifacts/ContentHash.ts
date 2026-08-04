/**
 * Opaque content hash.
 *
 * MUST be computed over CanonicalBytes only.
 */
export interface ContentHash {
  readonly algorithm: "sha256";
  readonly value: string;
}
