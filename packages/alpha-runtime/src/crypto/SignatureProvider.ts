import { SignatureDescriptor, KeyDescriptor } from "../types";

export interface SignatureProvider {
  sign(bytes: Uint8Array, key: KeyDescriptor): Promise<SignatureDescriptor>;
}
