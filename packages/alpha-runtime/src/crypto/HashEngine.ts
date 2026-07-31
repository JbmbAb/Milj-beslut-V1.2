import { HashDescriptor } from "../types";

export interface HashEngine {
  hash(bytes: Uint8Array, algorithm: string): Promise<HashDescriptor>;
}
