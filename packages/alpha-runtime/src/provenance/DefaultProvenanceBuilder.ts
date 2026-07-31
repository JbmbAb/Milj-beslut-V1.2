import { ProvenanceBuilder } from "./ProvenanceBuilder";
import { ProvenanceBuilderFactory } from "./ProvenanceBuilderFactory";
import { ProvenanceGraph, ProvenanceRecord } from "./ProvenanceTypes";
import { MerkleChain } from "./MerkleChain";

export class DefaultProvenanceBuilder implements ProvenanceBuilder {
  private records: ProvenanceRecord[] = [];

  constructor(private merkle: MerkleChain) {}

  addRecord(record: ProvenanceRecord) {
    this.records.push(record);
  }

  async build(): Promise<ProvenanceGraph> {
    if (this.records.length === 0) throw new Error("Empty provenance graph");

    const root = await this.merkle.build(this.records);

    return {
      root: this.records[0],
      chain: this.records,
      merkle_root: root
    };
  }
}

export class DefaultProvenanceBuilderFactory implements ProvenanceBuilderFactory {
  constructor(private merkle: MerkleChain) {}
  
  create(): ProvenanceBuilder {
    return new DefaultProvenanceBuilder(this.merkle);
  }
}
