/**
 * knowledgeGraphService.ts
 *
 * PostgreSQL-backed knowledge graph using raw SQL (idempotent, compatible with your
 * existing graph_nodes / graph_edges tables created in build-knowledge-graph.ts).
 *
 * Tables (created if missing):
 *   graph_nodes (node_id PK, node_type, name, metadata jsonb)
 *   graph_edges (edge_id PK, source_node, target_node, relation_type, metadata jsonb)
 */

import crypto from 'node:crypto';
import { prisma } from '../db/prisma';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface GraphNode {
    id: string;
    nodeType: string;
    name: string;
    metadata: Record<string, unknown>;
}

export interface GraphEdge {
    id: string;
    sourceId: string;
    targetId: string;
    relation: string;
    weight: number;
}

export interface GraphQueryResult {
    nodes: GraphNode[];
    edges: GraphEdge[];
}

export interface RequirementInput {
    attachmentHash?: string;
    municipality?: string | null;
    caseNumber?: string | null;
    requirementText: string;
    category: string;
    requirementLevel: string;
    legalReference?: string | null;
    confidence?: number;
}

// Category → Risk mappings
const CATEGORY_RISKS: Record<string, string[]> = {
    water_management: ['grundvattenförorening', 'lakvatten', 'dagvattenavrinning'],
    storage: ['brand', 'spridning', 'otillåtet upplag'],
    hazardous_waste: ['farliga ämnen', 'toxicitet', 'spridningsrisk'],
    documentation: ['bristande spårbarhet'],
    sampling: ['bristande mätdata', 'överskridna riktvärden'],
    fire_safety: ['brand', 'olycksrisk'],
    technical_measures: ['läckage', 'markförorening'],
    DagvattenLakvatten: ['lakvatten', 'dagvattenavrinning'],
    Ytkonstruktion: ['läckage', 'markförorening'],
    LagringVolymTid: ['otillåtet upplag'],
    KontrollProvtagning: ['bristande mätdata'],
};

const CATEGORY_LEGAL: Record<string, string> = {
    water_management: 'Miljöbalken (1998:808), 2 kap. 3 §',
    storage: 'Avfallsförordningen (2020:614), 6 kap.',
    hazardous_waste: 'Avfallsförordningen (2020:614), 2 kap. 3 §',
    documentation: 'Miljöbalken (1998:808), 26 kap. 19 §',
    sampling: 'Naturvårdsverkets föreskrift NFS 2006:9',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function hash24(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function nodeId(type: string, name: string): string {
    return `${type}:${hash24(`${type}|${name.toLowerCase()}`)}`;
}

function edgeId(source: string, relation: string, target: string): string {
    return `edge:${hash24(`${source}|${relation}|${target}`)}`;
}

export async function ensureGraphTables(): Promise<void> {
    await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS graph_nodes (
      node_id TEXT PRIMARY KEY,
      node_type TEXT NOT NULL,
      name TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(node_type, name)
    );
  `);
    await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS graph_edges (
      edge_id TEXT PRIMARY KEY,
      source_node TEXT NOT NULL REFERENCES graph_nodes(node_id) ON DELETE CASCADE,
      target_node TEXT NOT NULL REFERENCES graph_nodes(node_id) ON DELETE CASCADE,
      relation_type TEXT NOT NULL,
      weight FLOAT NOT NULL DEFAULT 1.0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(source_node, target_node, relation_type)
    );
  `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_graph_nodes_type ON graph_nodes(node_type);`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_graph_edges_rel ON graph_edges(relation_type);`);
}

// ─── Node / Edge upsert ─────────────────────────────────────────────────────

export async function upsertNode(
    type: string,
    name: string,
    metadata: Record<string, unknown> = {}
): Promise<string> {
    const id = nodeId(type, name);
    await prisma.$executeRawUnsafe(
        `
      INSERT INTO graph_nodes (node_id, node_type, name, metadata, updated_at)
      VALUES ($1, $2, $3, $4::jsonb, NOW())
      ON CONFLICT (node_id) DO UPDATE
        SET metadata = graph_nodes.metadata || EXCLUDED.metadata,
            updated_at = NOW();
    `,
        id, type, name, JSON.stringify(metadata)
    );
    return id;
}

export async function upsertEdge(
    sourceId: string,
    targetId: string,
    relation: string,
    weight = 1.0,
    metadata: Record<string, unknown> = {}
): Promise<string> {
    const id = edgeId(sourceId, relation, targetId);
    await prisma.$executeRawUnsafe(
        `
      INSERT INTO graph_edges (edge_id, source_node, target_node, relation_type, weight, metadata, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
      ON CONFLICT (edge_id) DO UPDATE
        SET metadata = graph_edges.metadata || EXCLUDED.metadata,
            weight = EXCLUDED.weight,
            updated_at = NOW();
    `,
        id, sourceId, targetId, relation, weight, JSON.stringify(metadata)
    );
    return id;
}

// ─── Build graph from requirements ─────────────────────────────────────────

export async function buildGraphFromRequirements(
    requirements: RequirementInput[]
): Promise<{ nodesCreated: number; edgesCreated: number }> {
    await ensureGraphTables();
    let nodesCreated = 0;
    let edgesCreated = 0;

    for (const req of requirements) {
        const munNode = req.municipality ? await upsertNode('Kommun', req.municipality) : null;
        const caseNode = req.caseNumber ? await upsertNode('Arende', req.caseNumber, { municipality: req.municipality }) : null;
        const reqName = req.requirementText.slice(0, 200);
        const reqNode = await upsertNode('Miljokrav', reqName, { category: req.category, confidence: req.confidence ?? 0 });
        nodesCreated++;

        if (munNode && caseNode) { await upsertEdge(munNode, caseNode, 'handlagger'); edgesCreated++; }
        if (caseNode) { await upsertEdge(caseNode, reqNode, 'innehaller', req.confidence ?? 1); edgesCreated++; }

        const legal = req.legalReference ?? CATEGORY_LEGAL[req.category];
        if (legal) {
            const legalNode = await upsertNode('Lagregel', legal);
            nodesCreated++;
            await upsertEdge(reqNode, legalNode, 'motiveras_av');
            edgesCreated++;
        }

        for (const riskName of (CATEGORY_RISKS[req.category] ?? [])) {
            const riskNode = await upsertNode('Risktyp', riskName);
            nodesCreated++;
            await upsertEdge(reqNode, riskNode, 'hanterar');
            edgesCreated++;
        }
    }

    return { nodesCreated, edgesCreated };
}

// ─── Query helpers ──────────────────────────────────────────────────────────

export async function getTypicalRequirements(params: {
    category?: string;
    municipality?: string;
    limit?: number;
}): Promise<{ requirements: string[]; risks: string[]; legalRules: string[] }> {
    type NodeRow = { node_id: string; node_type: string; name: string };
    type EdgeRow = { source_node: string; target_node: string; relation_type: string };

    const nodes = await prisma.$queryRawUnsafe<NodeRow[]>(
        `SELECT node_id, node_type, name FROM graph_nodes WHERE node_type = 'Miljokrav' LIMIT $1;`,
        params.limit ?? 50
    );
    const requirements: string[] = nodes.map(n => n.name);
    const risks = new Set<string>();
    const legalRules = new Set<string>();

    for (const n of nodes) {
        const edges = await prisma.$queryRawUnsafe<EdgeRow[]>(
            `SELECT ge.source_node, ge.target_node, ge.relation_type, gn.node_type, gn.name
       FROM graph_edges ge
       JOIN graph_nodes gn ON gn.node_id = ge.target_node
       WHERE ge.source_node = $1;`,
            n.node_id
        );
        for (const e of edges as Array<EdgeRow & { node_type: string; name: string }>) {
            if (e.node_type === 'Risktyp') risks.add(e.name);
            if (e.node_type === 'Lagregel') legalRules.add(e.name);
        }
    }

    return { requirements, risks: Array.from(risks), legalRules: Array.from(legalRules) };
}

export async function getGraphStats() {
    type StatRow = { node_type: string; count: bigint };
    const [byType, edgeCt, nodeCt] = await Promise.all([
        prisma.$queryRawUnsafe<StatRow[]>(`SELECT node_type, COUNT(*) AS count FROM graph_nodes GROUP BY node_type ORDER BY count DESC;`),
        prisma.$queryRawUnsafe<[{ count: bigint }]>(`SELECT COUNT(*) AS count FROM graph_edges;`),
        prisma.$queryRawUnsafe<[{ count: bigint }]>(`SELECT COUNT(*) AS count FROM graph_nodes;`),
    ]);
    return {
        totalNodes: Number(nodeCt[0]?.count ?? 0),
        totalEdges: Number(edgeCt[0]?.count ?? 0),
        nodesByType: byType.map(r => ({ nodeType: r.node_type, count: Number(r.count) })),
    };
}

// ─── Full-text search ────────────────────────────────────────────────────────

/**
 * searchGraph — sök noder vars namn matchar sökfrasen (case-insensitive ILIKE).
 * Returnerar matchande noder + deras direkta kanter (1 hop).
 */
export async function searchGraph(params: {
    query: string;
    nodeTypes?: string[];
    limit?: number;
}): Promise<GraphQueryResult> {
    type NodeRow = { node_id: string; node_type: string; name: string; metadata: string };
    type EdgeRow = {
        edge_id: string;
        source_node: string;
        target_node: string;
        relation_type: string;
        weight: number;
    };

    const limit = Math.min(params.limit ?? 50, 200);
    // Escape ILIKE special characters: %, _, and backslash (the escape char itself)
    const escaped = params.query
        .replace(/\\/g, '\\\\')
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_');
    const pattern = `%${escaped}%`;

    let nodeRows: NodeRow[];
    if (params.nodeTypes && params.nodeTypes.length > 0) {
        // Filter by type AND name pattern — build parameterised IN list
        const placeholders = params.nodeTypes.map((_, i) => `$${i + 2}`).join(', ');
        nodeRows = await prisma.$queryRawUnsafe<NodeRow[]>(
            `SELECT node_id, node_type, name, metadata::text AS metadata
       FROM graph_nodes
       WHERE name ILIKE $1 AND node_type IN (${placeholders})
       ORDER BY name
       LIMIT ${limit};`,
            pattern,
            ...params.nodeTypes
        );
    } else {
        nodeRows = await prisma.$queryRawUnsafe<NodeRow[]>(
            `SELECT node_id, node_type, name, metadata::text AS metadata
       FROM graph_nodes
       WHERE name ILIKE $1
       ORDER BY name
       LIMIT ${limit};`,
            pattern
        );
    }

    if (nodeRows.length === 0) {
        return { nodes: [], edges: [] };
    }

    const nodeIds = nodeRows.map(n => n.node_id);

    // Fetch all edges where source OR target is in our result set (1 hop)
    // Use ANY($1::text[]) so the array is passed only once, avoiding parameter mismatch.
    const edgeRows = await prisma.$queryRawUnsafe<EdgeRow[]>(
        `SELECT edge_id, source_node, target_node, relation_type, weight
     FROM graph_edges
     WHERE source_node = ANY($1::text[]) OR target_node = ANY($1::text[])
     LIMIT 500;`,
        nodeIds
    );

    // Collect additional node IDs referenced by edges but not in primary result
    const extraNodeIds = new Set<string>();
    for (const e of edgeRows) {
        if (!nodeIds.includes(e.source_node)) extraNodeIds.add(e.source_node);
        if (!nodeIds.includes(e.target_node)) extraNodeIds.add(e.target_node);
    }

    let extraNodes: NodeRow[] = [];
    if (extraNodeIds.size > 0) {
        const extraArr = Array.from(extraNodeIds);
        extraNodes = await prisma.$queryRawUnsafe<NodeRow[]>(
            `SELECT node_id, node_type, name, metadata::text AS metadata FROM graph_nodes WHERE node_id = ANY($1::text[]);`,
            extraArr
        );
    }

    const allNodes = [...nodeRows, ...extraNodes].map(n => ({
        id: n.node_id,
        nodeType: n.node_type,
        name: n.name,
        metadata: (() => {
            try { return JSON.parse(n.metadata) as Record<string, unknown>; }
            catch { return {} as Record<string, unknown>; }
        })(),
    }));

    const edges = edgeRows.map(e => ({
        id: e.edge_id,
        sourceId: e.source_node,
        targetId: e.target_node,
        relation: e.relation_type,
        weight: e.weight,
    }));

    return { nodes: allNodes, edges };
}
