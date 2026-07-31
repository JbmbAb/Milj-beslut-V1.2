import { ProvenanceRecord, ProvenanceGraph } from "../types";

export interface ProvenanceBuilder {
  addRecord(record: ProvenanceRecord): void;
  build(): Promise<ProvenanceGraph>;
}

export class DefaultProvenanceBuilder implements ProvenanceBuilder {
  private records: ProvenanceRecord[] = [];

  addRecord(record: ProvenanceRecord): void {
    this.records.push(record);
  }

  async build(): Promise<ProvenanceGraph> {
    const root = this.records.length > 0 ? this.records[0] : null;

    return {
      root,
      chain: [...this.records],
      merkle_root: {
        algorithm: "sha256-v1",
        digest: "mock_merkle_root_digest",
        bit_length: 256
      }
    };
  }
}
