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

import { Prisma } from '@prisma/client';
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

// ─── Constants (Defaults for Missing Data) ──────────────────────────────────

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

// Map internal type names to Prisma Enum types
const NODE_TYPE_MAP: Record<string, any> = {
    'Kommun': 'MUNICIPALITY',
    'Arende': 'CASE',
    'Miljokrav': 'REQUIREMENT',
    'Lagregel': 'LEGAL_RULE',
    'Risktyp': 'RISK',
    'Aktivitet': 'ACTIVITY',
    'Avfallskod': 'WASTE_CODE',
};

function getPrismaNodeType(type: string): any {
    return NODE_TYPE_MAP[type] || 'REQUIREMENT';
}

function toJsonValue(metadata: Record<string, unknown> = {}): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(metadata ?? {})) as Prisma.InputJsonValue;
}

// ─── Node / Edge upsert ─────────────────────────────────────────────────────

export async function upsertNode(
    type: string,
    name: string,
    metadata: Record<string, unknown> = {}
): Promise<string> {
    const nodeType = getPrismaNodeType(type);
    const node = await prisma.knowledgeNode.upsert({
        where: { nodeType_name: { nodeType, name } },
        update: {
            metadata: toJsonValue(metadata),
        },
        create: {
            nodeType,
            name,
            metadata: toJsonValue(metadata),
        }
    });
    return node.id;
}

export async function upsertEdge(
    sourceId: string,
    targetId: string,
    relation: string,
    weight = 1.0,
    metadata: Record<string, unknown> = {}
): Promise<string> {
    const edge = await prisma.knowledgeEdge.upsert({
        where: { sourceId_targetId_relation: { sourceId, targetId, relation } },
        update: { weight, metadata: toJsonValue(metadata) },
        create: { sourceId, targetId, relation, weight, metadata: toJsonValue(metadata) }
    });
    return edge.id;
}

// ─── Build graph from requirements ─────────────────────────────────────────

export async function buildGraphFromRequirements(
    requirements: RequirementInput[]
): Promise<{ nodesCreated: number; edgesCreated: number }> {
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
    const nodes = await prisma.knowledgeNode.findMany({
        where: { nodeType: 'REQUIREMENT' },
        take: params.limit ?? 50,
        include: {
            outEdges: {
                include: { target: true }
            }
        }
    });

    const requirements: string[] = nodes.map(n => n.name);
    const risks = new Set<string>();
    const legalRules = new Set<string>();

    for (const n of nodes) {
        for (const edge of n.outEdges) {
            if (edge.target.nodeType === 'RISK') risks.add(edge.target.name);
            if (edge.target.nodeType === 'LEGAL_RULE') legalRules.add(edge.target.name);
        }
    }

    return { requirements, risks: Array.from(risks), legalRules: Array.from(legalRules) };
}

export async function getGraphStats() {
    const [counts, totalEdges, totalNodes] = await Promise.all([
        prisma.knowledgeNode.groupBy({
            by: ['nodeType'],
            _count: { id: true },
        }),
        prisma.knowledgeEdge.count(),
        prisma.knowledgeNode.count(),
    ]);

    return {
        totalNodes,
        totalEdges,
        nodesByType: counts.map(r => ({ nodeType: r.nodeType, count: r._count.id })),
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
    const limit = Math.min(params.limit ?? 50, 200);
    const query = params.query.trim();

    const nodeRows = await prisma.knowledgeNode.findMany({
        where: {
            name: { contains: query, mode: 'insensitive' },
            ...(params.nodeTypes ? { nodeType: { in: params.nodeTypes as any } } : {}),
        },
        take: limit,
        orderBy: { name: 'asc' },
        include: {
            outEdges: { take: 100 },
            inEdges: { take: 100 }
        }
    });

    if (nodeRows.length === 0) {
        return { nodes: [], edges: [] };
    }

    const nodes = nodeRows.map(n => ({
        id: n.id,
        nodeType: n.nodeType,
        name: n.name,
        metadata: n.metadata as Record<string, unknown>,
    }));

    const edges: GraphEdge[] = [];
    const extraNodeIds = new Set<string>();

    for (const n of nodeRows) {
        for (const e of [...n.outEdges, ...n.inEdges]) {
            edges.push({
                id: e.id,
                sourceId: e.sourceId,
                targetId: e.targetId,
                relation: e.relation,
                weight: e.weight,
            });
            if (!nodeRows.some(orig => orig.id === e.sourceId)) extraNodeIds.add(e.sourceId);
            if (!nodeRows.some(orig => orig.id === e.targetId)) extraNodeIds.add(e.targetId);
        }
    }

    if (extraNodeIds.size > 0) {
        const extraNodes = await prisma.knowledgeNode.findMany({
            where: { id: { in: Array.from(extraNodeIds) } }
        });
        for (const n of extraNodes) {
            nodes.push({
                id: n.id,
                nodeType: n.nodeType,
                name: n.name,
                metadata: n.metadata as Record<string, unknown>,
            });
        }
    }

    return { nodes, edges: Array.from(new Set(edges.map(e => JSON.stringify(e)))).map(s => JSON.parse(s)) };
}
