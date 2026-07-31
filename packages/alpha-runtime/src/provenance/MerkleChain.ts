import { HashDescriptor } from "../types";
import { ProvenanceRecord } from "./ProvenanceTypes";

export interface MerkleChain {
  build(records: ProvenanceRecord[]): Promise<HashDescriptor>;
  verify(records: ProvenanceRecord[], expectedRoot: HashDescriptor): Promise<boolean>;
}
