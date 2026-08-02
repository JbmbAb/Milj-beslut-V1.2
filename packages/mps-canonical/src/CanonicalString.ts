export interface CanonicalString {
  canonicalize(value: string): string; // Unicode NFC
}

export class DefaultCanonicalString implements CanonicalString {
  canonicalize(value: string): string {
    return value.normalize("NFC");
  }
}
