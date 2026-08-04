import { describe, it, expect, beforeEach } from "vitest";
import { ArtifactContract } from "../src/artifacts/ArtifactContract";
import { ArtifactReference } from "../src/artifacts/ArtifactReference";
import { DefaultCanonicalPipeline } from "../../mps-canonical/src/CanonicalPipeline";
import { ProofPathResolver, ArtifactReader } from "../src/audit/ProofPathResolver";
import { DeterministicLayoutFunction, RenderableGraph } from "../src/audit/DeterministicLayoutFunction";
import { AuditGraphViewerKernel } from "../src/audit/AuditGraphViewerKernel";
import { AuditRenderSnapshotArtifact } from "../src/artifacts/AuditRenderSnapshotArtifact";

class MockGraphArtifactStore implements ArtifactReader {
  public data = new Map<string, ArtifactContract>();
  
  read(ref: ArtifactReference): ArtifactContract | null {
    return this.data.get(ref.artifact_id) || null;
  }
  
  write(artifact: ArtifactContract): void {
    this.data.set(artifact.artifact_id, artifact);
  }
}

describe("Phase 21: Audit Graph Presentation Contract (VIEW-21)", () => {
  let pipeline: DefaultCanonicalPipeline;
  let store: MockGraphArtifactStore;
  let resolver: ProofPathResolver;
  let layouter: DeterministicLayoutFunction;
  let kernel: AuditGraphViewerKernel;

  beforeEach(async () => {
    pipeline = new DefaultCanonicalPipeline();
    await pipeline.initHasher();

    store = new MockGraphArtifactStore();
    resolver = new ProofPathResolver(store, pipeline, "release-1.0");
    layouter = new DeterministicLayoutFunction(pipeline);
    kernel = new AuditGraphViewerKernel(store, resolver, pipeline, "release-1.0");
  });

  const setupValidGraph = () => {
    const outcome = { artifact_id: "outcome-1", artifact_type: "execution_outcome", attempt_ref: { artifact_id: "attempt-1", artifact_type: "execution_attempt" }, evidence: [{ evidence_id: "ev-1" }] } as any;
    const attempt = { artifact_id: "attempt-1", artifact_type: "execution_attempt" } as any;
    
    store.write(outcome);
    store.write(attempt);

    const graph = resolver.resolve({ artifact_id: "outcome-1", artifact_type: "execution_outcome" });
    const renderable = layouter.project(graph);

    const snapshot: AuditRenderSnapshotArtifact = {
        artifact_id: "snapshot-1",
        artifact_type: "audit_render_snapshot",
        release_hash: renderable.release_hash,
        graph_hash: "mock-hash", // we aren't enforcing graph_hash specifically in the kernel check yet, but layout_hash is critical
        layout_hash: renderable.layout_hash,
        node_count: renderable.nodes.length,
        edge_count: renderable.edges.length,
        generated_from: { artifact_id: "outcome-1", artifact_type: "execution_outcome" }
    };

    return { renderable, snapshot };
  };

  it("Attack 1: Viewer SHALL NOT render unknown node (VIEW-21-I1)", () => {
      const { renderable, snapshot } = setupValidGraph();

      // Maliciously inject a fake node into the payload before sending to kernel
      const poisonedRenderable: RenderableGraph = {
          ...renderable,
          nodes: [...renderable.nodes, { artifact_ref: { artifact_id: "fake-node", artifact_type: "fake" }, artifact_type: "fake", content_hash: "fake", position: { x: 0, y: 0 } }],
      };
      
      const poisonedSnapshot = { ...snapshot, node_count: poisonedRenderable.nodes.length };

      expect(() => {
          kernel.load(poisonedSnapshot, poisonedRenderable);
      }).toThrowError(/REJECT_NODE_NOT_CANONICAL/);
  });

  it("Attack 4: Viewer SHALL NOT synthesize provenance edges (VIEW-21-I7)", () => {
      const { renderable, snapshot } = setupValidGraph();

      const poisonedRenderable: RenderableGraph = {
          ...renderable,
          edges: [...renderable.edges, { source_ref: { artifact_id: "a", artifact_type: "b" }, target_ref: { artifact_id: "x", artifact_type: "y" }, relation_type: "UI_EDGE", evidence_ref: null as any }],
      };
      
      const poisonedSnapshot = { ...snapshot, edge_count: poisonedRenderable.edges.length };

      expect(() => {
          kernel.load(poisonedSnapshot, poisonedRenderable);
      }).toThrowError(/REJECT_INVALID_EDGE: Edge without evidence/);
  });

  it("Attack 2: Viewer SHALL NOT mutate graph state (VIEW-21-I3)", () => {
      const { renderable, snapshot } = setupValidGraph();
      kernel.load(snapshot, renderable);

      const frame = kernel.render();

      // UI attempts to mutate state
      expect(() => {
          (frame.nodes as any).push({ artifact_id: "malicious" });
      }).toThrowError(TypeError);
  });

  it("Attack 3: Same snapshot SHALL produce identical frame hash (VIEW-21-I5)", () => {
      const { renderable, snapshot } = setupValidGraph();
      kernel.load(snapshot, renderable);

      const frame1 = kernel.render();
      const frame2 = kernel.render();
      
      expect(frame1.frame_hash).toBe(frame2.frame_hash);
  });

  it("Attack 5: Snapshot version mismatch (VIEW-21-I9)", () => {
      const { renderable, snapshot } = setupValidGraph();

      // Kernel is operating on release-2.0, but snapshot is for release-1.0
      const mismatchedKernel = new AuditGraphViewerKernel(store, resolver, pipeline, "release-2.0");

      expect(() => {
          mismatchedKernel.load(snapshot, renderable);
      }).toThrowError(/REJECT_RELEASE_MISMATCH/);
  });

  it("Attack 6: Export Determinism (VIEW-21-I11)", () => {
      const { renderable, snapshot } = setupValidGraph();
      kernel.load(snapshot, renderable);

      const exportArtifact = kernel.export("snapshot-1");

      expect(exportArtifact.artifact_type).toBe("audit_export");
      expect(exportArtifact.release_hash).toBe("release-1.0");
      expect(exportArtifact.frame_hash).toBe(kernel.render().frame_hash);
      expect(exportArtifact.renderer_version).toBe("1.0.0");
  });
});
