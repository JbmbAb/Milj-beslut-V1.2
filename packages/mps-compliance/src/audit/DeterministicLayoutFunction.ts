import { CanonicalGraphProjection, AuditNode, AuditEdge } from "./CanonicalGraphProjection";
import { DefaultCanonicalPipeline } from "../../../mps-canonical/src/CanonicalPipeline";

export interface RenderableNode extends AuditNode {
    readonly position: { x: number, y: number };
}

export interface RenderableGraph {
    readonly release_hash: string;
    readonly nodes: readonly RenderableNode[];
    readonly edges: readonly AuditEdge[];
    readonly layout_hash: string;
}

const GRID_SIZE_X = 250;
const GRID_SIZE_Y = 150;

/**
 * DeterministicLayoutFunction
 *
 * A pure function mapping a CanonicalGraphProjection into (x, y) coordinates for rendering.
 * It does not use heuristics, physics, or browser state.
 * Position is exclusively a function of provenance depth (level) and lexicographical hash sorting (index).
 */
export class DeterministicLayoutFunction {
    constructor(private readonly canonicalPipeline: DefaultCanonicalPipeline) {}

    public project(graph: CanonicalGraphProjection): RenderableGraph {
        const levels = new Map<string, number>();
        
        // 1. Level assignment via BFS/DFS
        this.assignLevels(graph.root_node.artifact_id, 0, graph.edges, levels);

        // Group by level
        const nodesByLevel = new Map<number, AuditNode[]>();
        for (const node of graph.nodes) {
            const level = levels.get(node.artifact_ref.artifact_id) || 0;
            if (!nodesByLevel.has(level)) {
                nodesByLevel.set(level, []);
            }
            nodesByLevel.get(level)!.push(node);
        }

        const renderableNodes: RenderableNode[] = [];

        // 2. Sort within each level and assign positions
        const sortedLevels = Array.from(nodesByLevel.keys()).sort((a, b) => a - b);
        for (const level of sortedLevels) {
            const nodes = nodesByLevel.get(level)!;
            
            // Deterministic sorting based on content hash
            nodes.sort((a, b) => a.content_hash.localeCompare(b.content_hash));

            nodes.forEach((node, index) => {
                renderableNodes.push(Object.freeze({
                    ...node,
                    position: Object.freeze({
                        x: index * GRID_SIZE_X,
                        y: level * GRID_SIZE_Y
                    })
                }));
            });
        }

        // 3. Guarantee AUDIT-20-I5: Create a layout hash to prove identical topology & layout
        // We hash the coordinates and node hashes to prove the layout is deterministic
        const layoutPayload = renderableNodes.map(n => `${n.content_hash}:${n.position.x},${n.position.y}`).join("|");
        const layoutHash = this.canonicalPipeline.hashCanonical({ _raw: layoutPayload } as any, "JSON").digest;

        return Object.freeze({
            release_hash: graph.release_hash,
            nodes: Object.freeze(renderableNodes.map(Object.freeze)),
            edges: graph.edges, // already frozen from ProofPathResolver
            layout_hash: layoutHash
        }) as RenderableGraph;
    }

    private assignLevels(currentId: string, currentLevel: number, edges: readonly AuditEdge[], levels: Map<string, number>) {
        if (!levels.has(currentId) || levels.get(currentId)! < currentLevel) {
            levels.set(currentId, currentLevel);
        }

        const children = edges.filter(e => e.source_ref.artifact_id === currentId);
        for (const edge of children) {
            this.assignLevels(edge.target_ref.artifact_id, currentLevel + 1, edges, levels);
        }
    }
}
