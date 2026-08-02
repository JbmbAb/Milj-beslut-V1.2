export interface CanonicalBinary {
  canonicalize(bytes: Uint8Array): Uint8Array; // big-endian
}

export class DefaultCanonicalBinary implements CanonicalBinary {
  canonicalize(bytes: Uint8Array): Uint8Array {
    // Uint8Array consists of 1-byte elements, so endianness of the array itself is implicitly big-endian in transport.
    // To ensure determinism and prevent mutation after canonicalization, we return a copy.
    return new Uint8Array(bytes);
  }
}
