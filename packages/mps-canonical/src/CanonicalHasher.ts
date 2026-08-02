import { createBLAKE3 } from "hash-wasm";
import { HashDescriptor } from "./CanonicalTypes.js";

export interface CanonicalHasher {
  hash(bytes: Uint8Array): HashDescriptor;
}

export class DefaultCanonicalHasher implements CanonicalHasher {
  private blake3Instance: any = null;

  async init() {
    if (!this.blake3Instance) {
      this.blake3Instance = await createBLAKE3();
    }
  }

  hash(bytes: Uint8Array): HashDescriptor {
    if (!this.blake3Instance) {
      throw new Error("Hasher not initialized. Call init() first.");
    }
    this.blake3Instance.init();
    this.blake3Instance.update(bytes);
    const digestStr = this.blake3Instance.digest("hex");
    
    return {
      algorithm: "blake3",
      digest: digestStr,
      encoding: "hex",
      version: "1.0",
      length: bytes.length
    };
  }
}
