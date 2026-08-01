export interface HashEngine {
  hash(bytes: Uint8Array): string;
}
