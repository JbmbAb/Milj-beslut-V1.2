import { CANONICAL_RULES } from "./CanonicalRules.js";
import { CanonicalJson, DefaultCanonicalJson } from "./CanonicalJson.js";
import { CanonicalCbor, DefaultCanonicalCbor } from "./CanonicalCBOR.js";
import { CanonicalHasher, DefaultCanonicalHasher } from "./CanonicalHasher.js";
import { HashDescriptor, CanonicalFormat } from "./CanonicalTypes.js";

/**
 * Every supported logical artifact SHALL have exactly one canonical representation.
 * No logical artifact may have two valid canonical byte sequences.
 * 
 * CONTRACT:
 * Identiska logiska artefakter får olika byte mellan JSON och CBOR, men varje format 
 * måste vara deterministiskt inom sig. Hashar får därför endast jämföras inom samma 
 * canonicaliseringsformat, eller så måste formatet ingå i hashens identitet.
 */
export interface CanonicalPipeline {
  readonly rules: typeof CANONICAL_RULES;

  canonicalize(value: unknown, format: CanonicalFormat): Uint8Array;
  hashCanonical(value: unknown, format: CanonicalFormat): HashDescriptor;
}

export class DefaultCanonicalPipeline implements CanonicalPipeline {
  readonly rules = CANONICAL_RULES;
  private json: CanonicalJson;
  private cbor: CanonicalCbor;
  private hasher: CanonicalHasher;

  constructor(json?: CanonicalJson, cbor?: CanonicalCbor, hasher?: CanonicalHasher) {
    this.json = json || new DefaultCanonicalJson();
    this.cbor = cbor || new DefaultCanonicalCbor();
    this.hasher = hasher || new DefaultCanonicalHasher();
  }

  canonicalize(value: unknown, format: CanonicalFormat): Uint8Array {
    if (format === "JSON") {
      return this.json.toBytes(value);
    } else if (format === "CBOR") {
      return this.cbor.toBytes(value);
    }
    throw new Error(`Unsupported CanonicalFormat: ${format}`);
  }

  hashCanonical(value: unknown, format: CanonicalFormat): HashDescriptor {
    const bytes = this.canonicalize(value, format);
    return this.hasher.hash(bytes);
  }
  
  async initHasher() {
      if (typeof (this.hasher as any).init === "function") {
          await (this.hasher as any).init();
      }
  }
}
