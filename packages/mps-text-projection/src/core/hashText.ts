import { createHash } from "node:crypto";
import type { ContentHash } from "../types/TextProjection.js";

export function sha256Utf8Text(text: string): ContentHash {
  return {
    algorithm: "sha256",
    value: createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex"),
  };
}
