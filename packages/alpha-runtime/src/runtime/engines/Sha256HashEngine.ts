import * as crypto from "crypto";
import { HashDescriptor } from "../../types";

export class Sha256HashEngine {
  async hash(bytes: Uint8Array, algorithm: string): Promise<HashDescriptor> {
    if (algorithm !== "sha256-v1") throw new Error("unsupported_algorithm");
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");
    return {
      algorithm,
      digest,
      encoding: "hex",
      bit_length: 256
    };
  }
}
