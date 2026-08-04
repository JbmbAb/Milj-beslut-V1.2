import { CanonicalGraphProjection, AuditNode } from "./CanonicalGraphProjection";

/**
 * AuditSearchEngine
 * 
 * Provides search capabilities directly on the CanonicalGraphProjection
 * without relying on a secondary database index. 
 * This ensures the search results are derived directly from the immutable truth.
 */
export class AuditSearchEngine {
  private graph: CanonicalGraphProjection;

  constructor(graph: CanonicalGraphProjection) {
    this.graph = graph;
  }

  /**
   * Search for nodes matching a predicate.
   */
  public searchNodes(predicate: (node: AuditNode) => boolean): AuditNode[] {
    return this.graph.nodes.filter(predicate);
  }

  /**
   * Find the path(s) explaining why a specific artifact exists (e.g. why an execution was approved).
   * This traverses outwards from the target artifact following evidence_refs.
   */
  public findEvidenceChain(startArtifactId: string): AuditNode[] {
    const startNode = this.graph.nodes.find(n => n.artifact_ref.artifact_id === startArtifactId);
    if (!startNode) {
      throw new Error(`Artifact ${startArtifactId} not found in projection`);
    }

    const chain: AuditNode[] = [];
    const visited = new Set<string>();
    const queue = [startNode];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current.artifact_ref.artifact_id)) continue;
      
      visited.add(current.artifact_ref.artifact_id);
      chain.push(current);

      // Find all outgoing edges from current (meaning current depends on them as evidence)
      const outgoingEdges = this.graph.edges.filter(e => e.source_ref.artifact_id === current.artifact_ref.artifact_id);
      
      for (const edge of outgoingEdges) {
        const targetNode = this.graph.nodes.find(n => n.artifact_ref.artifact_id === edge.target_ref.artifact_id);
        if (targetNode && !visited.has(targetNode.artifact_ref.artifact_id)) {
          queue.push(targetNode);
        }
      }
    }

    return chain;
  }
}
