import crypto from "crypto";
import { SignatureProvider } from "./SignatureProvider";
import { SignatureDescriptor, KeyDescriptor } from "../types";

export class NodeSignatureProvider implements SignatureProvider {
  async sign(bytes: Uint8Array, key: KeyDescriptor): Promise<SignatureDescriptor> {
    const privateKey = key.metadata?.private_key as string;

    if (!privateKey) throw new Error("Signing key missing");

    const signature = crypto.sign(null, Buffer.from(bytes), privateKey);

    return {
      algorithm: key.algorithm,
      key_id: key.key_id,
      signature: signature.toString("base64"),
      encoding: "base64",
      created_at: new Date().toISOString()
    };
  }
}
