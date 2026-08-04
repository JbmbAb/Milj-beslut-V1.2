import { CanonicalBytes } from "./CanonicalBytes";

/**
 * Sole authority for producing CanonicalBytes.
 *
 * Artifacts SHALL NOT implement their own serialization.
 */
export interface CanonicalSerializer<T> {
  /**
   * Produces canonical byte representation for the given semantic value.
   */
  serialize(value: T): CanonicalBytes;
}
