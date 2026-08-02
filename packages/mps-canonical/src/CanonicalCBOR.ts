import { Encoder } from "cbor-x";
import { DefaultCanonicalJson } from "./CanonicalJson.js";

export interface CanonicalCbor {
  canonicalize(value: unknown): unknown;
  toBytes(value: unknown): Uint8Array; // sorted maps, stable encoding
}

export class DefaultCanonicalCbor implements CanonicalCbor {
  private jsonCanonicalizer = new DefaultCanonicalJson();
  private encoder = new Encoder({
    useRecords: false,
    mapsAsObjects: true
  });

  canonicalize(value: unknown): unknown {
    // Ateranvänder json-canonicalizer då den säkerställer sorterade nycklar (insertion order),
    // NFC-strängar, IEEE754 numbers och array_policy.
    return this.jsonCanonicalizer.canonicalize(value);
  }

  toBytes(value: unknown): Uint8Array {
    const canonicalized = this.canonicalize(value);
    return this.encoder.encode(canonicalized);
  }
}
