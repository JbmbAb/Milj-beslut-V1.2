import { CanonicalPipeline, DefaultCanonicalPipeline } from "./CanonicalPipeline.js";
import { CanonicalFormat } from "./CanonicalTypes.js";
import { decode } from "cbor-x";

/**
 * CanonicalSerializer SHALL be pure.
 * serializeCanonical(x) MUST produce identical bytes for identical logical values.
 * 
 * The implementation SHALL NOT depend on:
 * • wall clock
 * • locale
 * • timezone
 * • floating point locale
 * • operating system
 * • environment variables
 * • randomness
 */
export interface CanonicalSerializer {
  serializeCanonical(value: unknown, format: CanonicalFormat): Uint8Array;
  deserializeCanonical<T>(bytes: Uint8Array, format: CanonicalFormat): T;
}

export class DefaultCanonicalSerializer implements CanonicalSerializer {
  private pipeline: CanonicalPipeline;

  constructor(pipeline?: CanonicalPipeline) {
    this.pipeline = pipeline || new DefaultCanonicalPipeline();
  }

  serializeCanonical(value: unknown, format: CanonicalFormat): Uint8Array {
    return this.pipeline.canonicalize(value, format);
  }

  deserializeCanonical<T>(bytes: Uint8Array, format: CanonicalFormat): T {
    if (format === "CBOR") {
      return decode(bytes) as T;
    } else if (format === "JSON") {
      const str = new TextDecoder().decode(bytes);
      return JSON.parse(str) as T;
    }
    throw new Error(`Unsupported CanonicalFormat: ${format}`);
  }
}
