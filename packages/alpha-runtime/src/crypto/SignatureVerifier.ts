export interface SignatureVerifier {
  verify(bytes: Uint8Array, signature: any): Promise<"valid" | "invalid" | "untrusted">;
}
