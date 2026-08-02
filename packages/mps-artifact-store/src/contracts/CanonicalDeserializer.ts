export interface CanonicalDeserializer {
  deserialize<T>(bytes: Uint8Array): Readonly<T>;
}