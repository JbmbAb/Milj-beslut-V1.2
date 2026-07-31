import { ProvenanceGraph } from "./ProvenanceTypes";
import { MerkleChain } from "./MerkleChain";

export interface ProvenanceVerificationResult {
  valid: boolean;
  errors: string[];
}

export class ProvenanceVerifier {
  constructor(private merkle: MerkleChain) {}

  async verify(graph: ProvenanceGraph): Promise<ProvenanceVerificationResult> {
    const errors: string[] = [];

    const merkleValid = await this.merkle.verify(graph.chain, graph.merkle_root);
    if (!merkleValid) errors.push("broken_merkle_chain");

    for (let i = 1; i < graph.chain.length; i++) {
      const current = graph.chain[i];
      const previous = graph.chain[i - 1];

      if (
        current.parent &&
        current.parent.content_hash.digest !== previous.artifact_hash.digest
      ) {
        errors.push("broken_parent_link");
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}
