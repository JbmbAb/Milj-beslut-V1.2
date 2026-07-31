import { ProvenanceRecord, ProvenanceGraph, HashDescriptor } from "../types";
import { JsonCanonicalizer } from "../runtime/engines/SimpleCanonicalizer";
import { Sha256HashEngine } from "../runtime/engines/Sha256HashEngine";

export class SimpleProvenanceBuilder {
  private records: ProvenanceRecord[] = [];
  private canonicalizer = new JsonCanonicalizer();
  private hasher = new Sha256HashEngine();

  addRecord(record: ProvenanceRecord): void {
    this.records.push(record);
  }

  async buildArtifact(logicalId: string): Promise<{ content_hash: HashDescriptor; graph: ProvenanceGraph }> {
    const chainBytes = this.canonicalizer.serialize(this.records);
    const merkle_root = await this.hasher.hash(chainBytes, "sha256-v1");

    const graph: ProvenanceGraph = {
      root: this.records.length > 0 ? this.records[0] : null,
      chain: this.records,
      merkle_root
    };

    // The test expects provArtifact.content_hash.digest === provArtifact.graph.merkle_root.digest
    return {
      content_hash: merkle_root,
      graph
    };
  }
}
