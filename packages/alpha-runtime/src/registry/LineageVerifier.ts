import { ProvenanceGraph } from "../types";

export interface LineageVerificationResult {
  valid: boolean;
  errors: string[];
}

export interface LineageVerifier {
  verify(graph: ProvenanceGraph): Promise<LineageVerificationResult>;
}

export class DefaultLineageVerifier implements LineageVerifier {
  async verify(graph: ProvenanceGraph): Promise<LineageVerificationResult> {
    const errors: string[] = [];

    if (!graph || graph.chain.length === 0) {
      errors.push("empty_provenance_chain");
      return { valid: false, errors };
    }

    if (graph.root !== graph.chain[0]) {
      errors.push("root_mismatch");
    }

    const allowedTransitions: Record<string, string[]> = {
      created: ["mutated", "promoted", "deprecated", "restored"],
      mutated: ["mutated", "promoted", "deprecated", "restored"],
      promoted: ["deprecated", "restored"],
      deprecated: [],
      restored: ["mutated", "promoted", "deprecated"]
    };

    for (let i = 1; i < graph.chain.length; i++) {
      const child = graph.chain[i];
      const parent = graph.chain[i - 1];

      if (!child.parent) {
        errors.push(`missing_parent_ref_at_index_${i}`);
        continue;
      }

      if (child.parent.content_hash.digest !== parent.artifact_hash.digest) {
        errors.push(`parent_hash_mismatch_at_index_${i}`);
      }

      if (child.created_at < parent.created_at) {
        errors.push(`non_monotonic_time_at_index_${i}`);
      }

      const prevOp = parent.operation;
      const nextOp = child.operation;
      if (!allowedTransitions[prevOp].includes(nextOp)) {
        errors.push(`invalid_operation_transition_${prevOp}_to_${nextOp}_at_index_${i}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }
}
