import { AuditRenderSnapshotArtifact } from "../artifacts/AuditRenderSnapshotArtifact";
import { RenderableGraph, RenderableNode } from "./DeterministicLayoutFunction";
import { ProofPathResolver, ArtifactReader } from "./ProofPathResolver";
import { CanonicalGraphProjection } from "./CanonicalGraphProjection";
import { DefaultCanonicalPipeline } from "../../../mps-canonical/src/CanonicalPipeline";

export interface RenderFrame {
    readonly nodes: readonly RenderableNode[];
    readonly edges: readonly any[];
    readonly frame_hash: string;
}

export class AuditGraphViewerKernel {
    private currentSnapshot: AuditRenderSnapshotArtifact | null = null;
    private currentGraph: RenderableGraph | null = null;

    constructor(
        private readonly reader: ArtifactReader,
        private readonly resolver: ProofPathResolver,
        private readonly canonicalPipeline: DefaultCanonicalPipeline,
        private readonly currentReleaseHash: string,
        private readonly rendererVersion: string = "1.0.0"
    ) {}

    public load(snapshot: AuditRenderSnapshotArtifact, graph: RenderableGraph): void {
        // Enforce VIEW-21-I9: Cross-release snapshot loading is explicitly forbidden.
        if (snapshot.release_hash !== this.currentReleaseHash) {
            throw new Error(`REJECT_RELEASE_MISMATCH: Snapshot release ${snapshot.release_hash} does not match current kernel release ${this.currentReleaseHash}`);
        }

        // Enforce VIEW-21-I1 & VIEW-21-I7 by strictly validating the snapshot against the graph
        if (snapshot.layout_hash !== graph.layout_hash) {
            throw new Error(`REJECT: Snapshot layout_hash mismatch`);
        }
        
        if (snapshot.node_count !== graph.nodes.length) {
            throw new Error(`REJECT: Snapshot node_count mismatch`);
        }

        if (snapshot.edge_count !== graph.edges.length) {
            throw new Error(`REJECT: Snapshot edge_count mismatch`);
        }
        
        // Deep verification: Ensure every node and edge in the graph exists in the canonical store
        for (const node of graph.nodes) {
            const artifact = this.reader.read(node.artifact_ref);
            if (!artifact) {
                throw new Error(`REJECT_NODE_NOT_CANONICAL: Unknown node ${node.artifact_ref.artifact_id}`);
            }
        }
        
        for (const edge of graph.edges) {
            if (!edge.evidence_ref) {
                 throw new Error(`REJECT_INVALID_EDGE: Edge without evidence`);
            }
            const evidence = this.reader.read(edge.evidence_ref);
            if (!evidence) {
                throw new Error(`REJECT_INVALID_EDGE: Unknown evidence ${edge.evidence_ref.artifact_id}`);
            }
        }

        // Store internally as frozen to enforce VIEW-21-I3 (Strict Immutability)
        this.currentSnapshot = Object.freeze({ ...snapshot });
        
        // The RenderableGraph is already frozen by DeterministicLayoutFunction, but we freeze it here again to be safe
        this.currentGraph = Object.freeze({
            ...graph,
            nodes: Object.freeze(graph.nodes.map(Object.freeze)),
            edges: Object.freeze(graph.edges.map(Object.freeze))
        }) as RenderableGraph;
    }

    public render(): RenderFrame {
        if (!this.currentGraph) {
            throw new Error("No graph loaded");
        }

        // Generate a deterministic frame payload
        const framePayload = this.currentGraph.nodes.map(n => `${n.content_hash}:${n.position.x},${n.position.y}`).join("|");
        const frameHash = this.canonicalPipeline.hashCanonical({ _raw: framePayload } as any, "JSON").digest;

        // Ensure we hand out deeply frozen objects to the frontend
        return Object.freeze({
            nodes: this.currentGraph.nodes,
            edges: this.currentGraph.edges,
            frame_hash: frameHash
        });
    }

    public inspect(node_id: string): CanonicalGraphProjection {
        if (!this.currentGraph) {
            throw new Error("No graph loaded");
        }

        const node = this.currentGraph.nodes.find(n => n.artifact_ref.artifact_id === node_id);
        if (!node) {
            throw new Error(`Unknown node ${node_id}`);
        }

        // Proof navigation: resolve the original path using the backend proof resolver
        // This guarantees the UI cannot invent paths
        return this.resolver.resolve(node.artifact_ref);
    }

    public export(snapshotId: string): import("../artifacts/AuditExportArtifact").AuditExportArtifact {
        if (!this.currentSnapshot || !this.currentGraph) {
            throw new Error("No graph loaded to export");
        }

        const frame = this.render();
        const snapshotHash = this.canonicalPipeline.hashCanonical(this.currentSnapshot, "JSON").digest;

        // Ensure VIEW-21-I11: Export must be sealed
        return Object.freeze({
            artifact_id: `export-${Date.now()}`, // Or a uuid
            artifact_type: "audit_export",
            release_hash: this.currentReleaseHash,
            snapshot_hash: snapshotHash,
            frame_hash: frame.frame_hash,
            renderer_version: this.rendererVersion
        });
    }
}
