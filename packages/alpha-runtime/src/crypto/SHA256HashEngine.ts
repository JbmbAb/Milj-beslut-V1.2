import crypto from "crypto";
import { HashEngine } from "./HashEngine";
import { HashDescriptor } from "../types";

export class SHA256HashEngine implements HashEngine {
  async hash(bytes: Uint8Array): Promise<HashDescriptor> {
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");

    return {
      algorithm: "sha256-v1",
      encoding: "hex",
      digest,
      bit_length: 256
    } as HashDescriptor;
  }
}
