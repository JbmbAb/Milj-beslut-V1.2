import { CanonicalizationProfile } from "./CanonicalizationProfile";

export interface Canonicalizer {
  serialize(value: unknown, profile: CanonicalizationProfile): Uint8Array;
}

export class RFC8785Canonicalizer implements Canonicalizer {
  serialize(value: unknown): Uint8Array {
    // Basic placeholder for RFC8785 JSON canonicalization
    const canonical = JSON.stringify(value); 
    return new TextEncoder().encode(canonical);
  }
}
