import { describe, it, expect, beforeEach } from "vitest";
import { ArtifactContract } from "../src/artifacts/ArtifactContract";
import { ArtifactReference } from "../src/artifacts/ArtifactReference";
import { DefaultCanonicalPipeline } from "../../mps-canonical/src/CanonicalPipeline";
import { ProofPathResolver, ArtifactReader } from "../src/audit/ProofPathResolver";
import { DeterministicLayoutFunction } from "../src/audit/DeterministicLayoutFunction";

class MockGraphArtifactStore implements ArtifactReader {
  public data = new Map<string, ArtifactContract>();
  
  read(ref: ArtifactReference): ArtifactContract | null {
    return this.data.get(ref.artifact_id) || null;
  }
  
  write(artifact: ArtifactContract): void {
    this.data.set(artifact.artifact_id, artifact);
  }
}

describe("Phase 20: Global Audit Graph (AUDIT-20)", () => {
  let pipeline: DefaultCanonicalPipeline;
  let store: MockGraphArtifactStore;
  let resolver: ProofPathResolver;
  let layouter: DeterministicLayoutFunction;

  beforeEach(async () => {
    pipeline = new DefaultCanonicalPipeline();
    await pipeline.initHasher();

    store = new MockGraphArtifactStore();
    resolver = new ProofPathResolver(store, pipeline, "release-1.0-frozen-core");
    layouter = new DeterministicLayoutFunction(pipeline);
  });

  const createOutcome = (id: string, attemptId: string | null, evidence: any[] | null) => {
      const art: any = {
          artifact_id: id,
          artifact_type: "execution_outcome",
      };
      if (attemptId) art.attempt_ref = { artifact_id: attemptId, artifact_type: "execution_attempt" };
      if (evidence) art.evidence = evidence;
      return art;
  };

  const createAttempt = (id: string, manifestId: string | null) => {
      const art: any = {
          artifact_id: id,
          artifact_type: "execution_attempt",
      };
      if (manifestId) art.manifest_ref = { artifact_id: manifestId, artifact_type: "execution_manifest" };
      return art;
  };

  it("Attack 1: Phantom node (REJECT_NODE_NOT_CANONICAL)", () => {
      store.write(createOutcome("outcome-1", "attempt-missing", [{ evidence_id: "ev-1" }]));
      // We don't write "attempt-missing" to the store.

      expect(() => {
          resolver.resolve({ artifact_id: "outcome-1", artifact_type: "execution_outcome" });
      }).toThrowError(/REJECT_NODE_NOT_CANONICAL: Missing artifact attempt-missing/);
  });

  it("Attack 2: Phantom edge (REJECT_INVALID_PROVENANCE)", () => {
      // Create an outcome with no attempt_ref
      store.write(createOutcome("outcome-no-edge", null, [{ evidence_id: "ev-1" }]));

      expect(() => {
          resolver.resolve({ artifact_id: "outcome-no-edge", artifact_type: "execution_outcome" });
      }).toThrowError(/REJECT_INVALID_PROVENANCE/);
  });

  it("Attack 4: Missing evidence (FAIL AUDIT-20-I7)", () => {
      // Create an outcome with missing evidence array
      store.write(createOutcome("outcome-no-evidence", "attempt-1", null));
      store.write(createAttempt("attempt-1", null)); // End chain here for simplicity

      expect(() => {
          resolver.resolve({ artifact_id: "outcome-no-evidence", artifact_type: "execution_outcome" });
      }).toThrowError(/FAIL AUDIT-20-I7/);
  });

  it("Attack 3: Layout poisoning (Topological Determinism)", () => {
      store.write(createOutcome("outcome-1", "attempt-1", [{ evidence_id: "ev-1" }]));
      store.write(createAttempt("attempt-1", "manifest-1"));
      store.write({ artifact_id: "manifest-1", artifact_type: "execution_manifest", execution_identity: { artifact_id: "id-1", artifact_type: "any" } });
      store.write({ artifact_id: "id-1", artifact_type: "execution_identity" });

      const graph = resolver.resolve({ artifact_id: "outcome-1", artifact_type: "execution_outcome" });

      const layout1 = layouter.project(graph);
      const layout2 = layouter.project(graph);
      const layout3 = layouter.project(graph);

      // Must produce identical layout hashes
      expect(layout1.layout_hash).toBe(layout2.layout_hash);
      expect(layout2.layout_hash).toBe(layout3.layout_hash);
  });

  it("Attack 5: Graph mutation", () => {
      store.write(createOutcome("outcome-1", "attempt-1", [{ evidence_id: "ev-1" }]));
      store.write(createAttempt("attempt-1", null));

      const graph = resolver.resolve({ artifact_id: "outcome-1", artifact_type: "execution_outcome" });

      // Try to mutate nodes
      expect(() => {
          (graph.nodes as any).push({ artifact_ref: { artifact_id: "fake", artifact_type: "fake" }, label: "fake", content_hash: "fake" });
      }).toThrowError(TypeError); // Object is non-extensible

      // Try to mutate layout
      const layout = layouter.project(graph);
      expect(() => {
          (layout.nodes as any)[0].position.x = 9999;
      }).toThrowError(TypeError); // Cannot assign to read only property
  });
});
