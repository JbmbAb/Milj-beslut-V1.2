import { CanonicalGraphProjection, AuditNode } from "./CanonicalGraphProjection";

/**
 * ProofCompletenessValidator
 * 
 * Enforces PROOF-22-I2-A and PROOF-22-I2-B: Every artifact exposed in the Human Governance Interface 
 * MUST have a verified, two-way proof closure:
 * 1. Forward validity (PROOF-22-I2-A): Target artifacts MUST resolve to release root.
 * 2. Backward explanation (PROOF-22-I2-B): Release root MUST explain all referenced governance dependencies.
 */
export class ProofCompletenessValidator {
  
  /**
   * Validates a CanonicalGraphProjection to ensure there are no orphaned branches
   * in either direction (forward or backward).
   */
  public validate(graph: CanonicalGraphProjection, expectedRootHash: string): void {
      const edges = graph.edges;
      const nodes = graph.nodes;

      const adjListForward = new Map<string, string[]>();
      const adjListBackward = new Map<string, string[]>();
      
      nodes.forEach(n => {
          adjListForward.set(n.artifact_ref.artifact_id, []);
          adjListBackward.set(n.artifact_ref.artifact_id, []);
      });

      // Construct adjacency lists for both directions
      edges.forEach(e => {
          // Source -> Target (Forward flow, e.g. evidence -> execution outcome)
          adjListForward.get(e.source_ref.artifact_id)?.push(e.target_ref.artifact_id);
          // Target -> Source (Backward flow, e.g. outcome -> evidence)
          adjListBackward.get(e.target_ref.artifact_id)?.push(e.source_ref.artifact_id);
      });

      for (const node of nodes) {
          // Verify Forward Validity
          if (!this.canReachRoot(node.artifact_ref.artifact_id, adjListForward, nodes, expectedRootHash)) {
              throw new Error(`REJECT_INCOMPLETE_PROOF: Artifact ${node.artifact_ref.artifact_id} has no continuous forward path to the canonical root ${expectedRootHash}.`);
          }

          // Verify Backward Explanation (if the node itself is not the root)
          if (node.artifact_ref.artifact_id !== expectedRootHash) {
              if (!this.canReachRoot(node.artifact_ref.artifact_id, adjListBackward, nodes, expectedRootHash)) {
                  throw new Error(`REJECT_INCOMPLETE_PROOF: Artifact ${node.artifact_ref.artifact_id} has no continuous backward path to the canonical root ${expectedRootHash}.`);
              }
          }
      }
  }

  private canReachRoot(startId: string, adjList: Map<string, string[]>, nodes: readonly AuditNode[], expectedRootHash: string): boolean {
      const visited = new Set<string>();
      const queue = [startId];

      while (queue.length > 0) {
          const currentId = queue.shift()!;
          if (visited.has(currentId)) continue;
          visited.add(currentId);

          if (currentId === expectedRootHash) {
              return true; // Reached the specific required root
          }

          const neighbors = adjList.get(currentId) || [];
          queue.push(...neighbors);
      }

      return false; // Traversed everything from this node and found no root
  }
}
