import { ArtifactContract } from "../artifacts/ArtifactContract";
import { ArtifactReference } from "../artifacts/ArtifactReference";
import { CanonicalGraphProjection, AuditNode, AuditEdge } from "./CanonicalGraphProjection";
import { CanonicalPipeline } from "../../../mps-canonical/src/CanonicalPipeline";
import { ProofResolutionArtifact } from "../artifacts/ProofResolutionArtifact";
import { ContentHash } from "../artifacts/ContentHash";

export interface ArtifactReader {
  read(ref: ArtifactReference): ArtifactContract | null;
}

export type ProofQuestion = 
  | "approval_reason" 
  | "signature_chain" 
  | "capability_origin" 
  | "retention_basis";

export interface ProofResolutionBudget {
    max_nodes: number;
    max_edges: number;
    max_depth: number;
    max_bytes: number;
}

export interface ProofResolutionResult {
    graph: CanonicalGraphProjection;
    resolution: ProofResolutionArtifact;
}

/**
 * ProofPathResolver
 *
 * Core engine to build a canonical graph projection from a specific artifact identity,
 * iteratively tracing provenance, governance, and evidence relationships.
 */
export class ProofPathResolver {
  // Ephemeral cache: MUST NOT survive process lifetime, MUST NOT influence verification outcome.
  // Enforces PROOF-22-I9 Cache Purity.
  private ephemeralCache = new Map<string, AuditNode>();

  constructor(
      private readonly reader: ArtifactReader, 
      private readonly canonicalPipeline: CanonicalPipeline,
      private readonly releaseHash: string,
      private readonly budget: ProofResolutionBudget = { max_nodes: 10000, max_edges: 50000, max_depth: 10000, max_bytes: 50000000 }
  ) {}

  public clearCache(): void {
      this.ephemeralCache.clear();
  }

  public resolve(rootRef: ArtifactReference): CanonicalGraphProjection {
    const nodes = new Map<string, AuditNode>();
    const edges: AuditEdge[] = [];
    
    // Enforce iterative traversal to prevent recursion depth issues (10k+ levels deep)
    this.traverseIteratively(rootRef, nodes, edges);

    return Object.freeze({
      release_hash: this.releaseHash,
      root_node: rootRef,
      nodes: Object.freeze(Array.from(nodes.values()).map(Object.freeze)),
      edges: Object.freeze(edges.map(Object.freeze))
    }) as CanonicalGraphProjection;
  }

  /**
   * Resolves a specific proof path (e.g. why an execution was approved)
   * Enforces VIEW-22-I4 by strictly resolving proof chains rather than 
   * exposing an arbitrary semantic search over the graph.
   */
  public resolveProofPath(query: { target: ArtifactReference, question: ProofQuestion, session_identity: ArtifactReference }): ProofResolutionResult {
      const allowedQuestions: ProofQuestion[] = ["approval_reason", "signature_chain", "capability_origin", "retention_basis"];
      
      if (!allowedQuestions.includes(query.question)) {
          throw new Error(`REJECT_UNDECLARED_PROOF_QUERY: Unknown proof question ${query.question}`);
      }

      // Build the canonical graph
      const graph = this.resolve(query.target);
      
      // Calculate a resolution hash based on the projected graph structure
      const resolutionString = JSON.stringify({
          nodes: graph.nodes.map(n => n.content_hash),
          edges: graph.edges.map(e => `${e.source_ref.artifact_id}->${e.target_ref.artifact_id}`)
      });
      const resolutionHash = this.canonicalPipeline.hashCanonical({ _temp: resolutionString } as any, "JSON").digest;

      const pathRefs = graph.nodes.map(n => n.artifact_ref);

      const resolutionArtifact: ProofResolutionArtifact = Object.freeze({
          artifact_type: "proof_resolution",
          target_ref: query.target,
          root_release_ref: { artifact_id: this.releaseHash, artifact_type: "frozen_core_release_manifest" },
          path_refs: Object.freeze(pathRefs),
          resolution_hash: resolutionHash,
          created_by: query.session_identity
      } as unknown as ProofResolutionArtifact);

      return {
          graph,
          resolution: resolutionArtifact
      };
  }

  private traverseIteratively(startRef: ArtifactReference, nodes: Map<string, AuditNode>, edges: AuditEdge[]): void {
      interface StackFrame {
          ref: ArtifactReference;
          depth: number;
      }

      const stack: StackFrame[] = [{ ref: startRef, depth: 0 }];
      let currentBytes = 0;

      while (stack.length > 0) {
          const { ref, depth } = stack.pop()!;

          if (nodes.has(ref.artifact_id)) {
              continue;
          }

          if (nodes.size >= this.budget.max_nodes) {
              throw new Error(`REJECT_PROOF_SCOPE_EXCEEDED: Max nodes budget (${this.budget.max_nodes}) exceeded.`);
          }
          if (depth > this.budget.max_depth) {
              throw new Error(`REJECT_PROOF_SCOPE_EXCEEDED: Max depth budget (${this.budget.max_depth}) exceeded.`);
          }

          let node = this.ephemeralCache.get(ref.artifact_id);
          let artifact: ArtifactContract | null = null;
          
          if (!node) {
              artifact = this.reader.read(ref);
              if (!artifact) {
                  throw new Error(`REJECT_NODE_NOT_CANONICAL: Missing artifact ${ref.artifact_id}`);
              }

              // Rough byte estimation for budget
              const artifactStr = JSON.stringify(artifact);
              currentBytes += artifactStr.length;
              if (currentBytes > this.budget.max_bytes) {
                  throw new Error(`REJECT_PROOF_SCOPE_EXCEEDED: Max bytes budget (${this.budget.max_bytes}) exceeded.`);
              }

              const contentHash = this.canonicalPipeline.hashCanonical(artifact, "JSON").digest;

              node = {
                  artifact_ref: ref,
                  artifact_type: artifact.artifact_type,
                  content_hash: contentHash
              };
              
              this.ephemeralCache.set(ref.artifact_id, node);
          }

          nodes.set(ref.artifact_id, node);

          if (!artifact) {
             // Cache hit - still need to read artifact to extract edges for traversal
             artifact = this.reader.read(ref);
             if (!artifact) throw new Error(`REJECT_NODE_NOT_CANONICAL: Missing artifact ${ref.artifact_id} during edge traversal`);
          }

          const addEdge = (targetRef: ArtifactReference, relationType: "PROVENANCE" | "GOVERNANCE" | "LINEAGE" | "EVIDENCE", evidenceRef: ArtifactReference) => {
              if (edges.length >= this.budget.max_edges) {
                  throw new Error(`REJECT_PROOF_SCOPE_EXCEEDED: Max edges budget (${this.budget.max_edges}) exceeded.`);
              }
              edges.push({ source_ref: ref, target_ref: targetRef, relation_type: relationType, evidence_ref: evidenceRef });
              stack.push({ ref: targetRef, depth: depth + 1 });
          };

          // We must trace specific types of relationships to build the full proof path.
          if (artifact.artifact_type === "execution_outcome") {
              const attemptRef = (artifact as any).attempt_ref;
              if (attemptRef) {
                  addEdge(attemptRef, "PROVENANCE", ref);
              } else {
                   throw new Error(`REJECT_INVALID_PROVENANCE: Missing attempt_ref on execution_outcome ${ref.artifact_id}`);
              }
              
              if (!(artifact as any).evidence || !(artifact as any).evidence.length) {
                  throw new Error(`FAIL AUDIT-20-I7: Missing ValidationEvidence for outcome ${ref.artifact_id}`);
              }
          } else if (artifact.artifact_type === "execution_attempt") {
              const manifestRef = (artifact as any).manifest_ref;
              if (manifestRef) {
                  addEdge(manifestRef, "PROVENANCE", ref);
              }
          } else if (artifact.artifact_type === "execution_manifest") {
              const identityRef = (artifact as any).execution_identity;
              if (identityRef) {
                  addEdge(identityRef, "GOVERNANCE", ref);
              }
              const capabilityRef = (artifact as any).capability_ref;
              if (capabilityRef) {
                  addEdge(capabilityRef, "GOVERNANCE", ref);
              }
          } else if (artifact.artifact_type === "artifact_lineage") {
              const parentHash = (artifact as any).parent_hash;
              if (parentHash) {
                   const parentRef: ArtifactReference = { artifact_id: parentHash, artifact_type: "any" };
                   addEdge(parentRef, "LINEAGE", ref);
              }
          }
      }
  }
}
