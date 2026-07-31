import { HashDescriptor } from "../types";
import { HashEngine } from "../crypto/HashEngine";
import { Canonicalizer } from "../canonical/RFC8785Canonicalizer";
import { CanonicalizationProfile } from "../canonical/CanonicalizationProfile";
import { ProvenanceRecord } from "./ProvenanceTypes";
import { MerkleChain } from "./MerkleChain";

export class DefaultMerkleChain implements MerkleChain {
  constructor(
    private hashEngine: HashEngine,
    private canonicalizer: Canonicalizer,
    private profile: CanonicalizationProfile
  ) {}

  async build(records: ProvenanceRecord[]): Promise<HashDescriptor> {
    if (records.length === 0) throw new Error("Cannot build empty merkle tree");

    let layer = await Promise.all(records.map(r => this.hashRecord(r)));

    while (layer.length > 1) {
      const next: HashDescriptor[] = [];

      for (let i = 0; i < layer.length; i += 2) {
        const left = layer[i];
        const right = layer[i + 1] ?? left;

        const bytes = new TextEncoder().encode(`${left.digest}:${right.digest}`);

        next.push(await this.hashEngine.hash(bytes, "sha256-v1"));
      }

      layer = next;
    }

    return layer[0];
  }

  private async hashRecord(record: ProvenanceRecord) {
    const bytes = this.canonicalizer.serialize(record, this.profile);
    return this.hashEngine.hash(bytes, "sha256-v1");
  }

  async verify(records: ProvenanceRecord[], expectedRoot: HashDescriptor) {
    const actual = await this.build(records);
    return actual.digest === expectedRoot.digest;
  }
}
