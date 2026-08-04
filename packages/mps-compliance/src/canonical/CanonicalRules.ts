/**
 * Canonicalization rules descriptor.
 *
 * Makes canonical behavior explicit and versioned.
 */
export interface CanonicalRules {
  readonly version: string;
  readonly normalizeKeys: boolean;
  readonly encoding: "utf-8";
}
