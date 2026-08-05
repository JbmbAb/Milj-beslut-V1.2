import { createHmac, timingSafeEqual } from "node:crypto";
import type { SigningKeyProvider } from "./SecurityContracts.js";

/**
 * Deterministic HMAC-SHA256 signer for execution-path attestations.
 * Production may inject a KMS-backed SigningKeyProvider later.
 */
export function createHmacSigningKeyProvider(
  secret: string,
  key_id = "hmac-execution-v1",
): SigningKeyProvider {
  if (!secret || secret.length < 8) {
    throw new Error("SigningKeyProvider: secret must be at least 8 characters");
  }
  return {
    key_id,
    sign(payload: string): string {
      return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
    },
    verify(payload: string, signature: string): boolean {
      const expected = createHmac("sha256", secret)
        .update(payload, "utf8")
        .digest("hex");
      try {
        return timingSafeEqual(
          Buffer.from(expected, "utf8"),
          Buffer.from(signature, "utf8"),
        );
      } catch {
        return false;
      }
    },
  };
}
