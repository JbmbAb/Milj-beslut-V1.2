/**
 * knowledgeGraphService.ts
 *
 * PostgreSQL-backed knowledge graph via Prisma (knowledge_nodes / knowledge_edges).
 */

import { Prisma, type KnowledgeNodeType } from '@prisma/client';
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

interface GraphStorageStats {
  preferred: {
    backend: 'knowledge';
    nodes: number;
    edges: number;
  };
  legacy: {
    backend: 'graph';
    nodes: number;
    edges: number;
  } | null;
  effective: {
    backend: 'knowledge' | 'graph';
    nodes: number;
    edges: number;
  };
  driftDetected: boolean;
  byType?: Record<string, number>;

  // Legacy fields for backward compatibility
  totalNodes?: number;
  totalEdges?: number;
  searchableNodes?: number;
  searchableEdges?: number;
  nodesByType?: Array<{ nodeType: string; count: number }>;
  storage?: any;
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

const NODE_TYPE_MAP: Record<string, KnowledgeNodeType> = {
  Kommun: 'MUNICIPALITY',
  Arende: 'CASE',
  Miljokrav: 'REQUIREMENT',
  Lagregel: 'LEGAL_RULE',
  Risktyp: 'RISK',
  Aktivitet: 'ACTIVITY',
  Avfallskod: 'WASTE_CODE',
};

function getPrismaNodeType(type: string): KnowledgeNodeType {
  return NODE_TYPE_MAP[type] || 'REQUIREMENT';
}

function toJsonValue(metadata: Record<string, unknown> = {}): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(metadata ?? {})) as Prisma.InputJsonValue;
}

async function getLegacyGraphCounts(): Promise<{ nodes: number; edges: number; available: boolean }> {
  const raw = prisma as typeof prisma & {
    $queryRawUnsafe?: (query: string) => Promise<Array<{ nodes: bigint | number; edges: bigint | number }>>;
  };

  if (typeof raw.$queryRawUnsafe !== 'function') {
    return { nodes: 0, edges: 0, available: false };
  }

  try {
    const rows = await raw.$queryRawUnsafe(`
            SELECT
                (SELECT COUNT(*) FROM graph_nodes) AS nodes,
                (SELECT COUNT(*) FROM graph_edges) AS edges
        `);
    const row = rows[0];
    return {
      nodes: Number(row?.nodes ?? 0),
      edges: Number(row?.edges ?? 0),
      available: true,
    };
  } catch {
    return { nodes: 0, edges: 0, available: false };
  }
}

// ─── Node / Edge upsert ─────────────────────────────────────────────────────

export async function upsertNode(
  type: string,
  name: string,
  metadata: Record<string, unknown> = {},
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
    },
  });
  return node.id;
}

export async function upsertEdge(
  sourceId: string,
  targetId: string,
  relation: string,
  weight = 1.0,
  metadata: Record<string, unknown> = {},
): Promise<string> {
  const edge = await prisma.knowledgeEdge.upsert({
    where: { sourceId_targetId_relation: { sourceId, targetId, relation } },
    update: { weight, metadata: toJsonValue(metadata) },
    create: { sourceId, targetId, relation, weight, metadata: toJsonValue(metadata) },
  });
  return edge.id;
}

// ─── Build graph from requirements ─────────────────────────────────────────

export async function buildGraphFromRequirements(
  requirements: RequirementInput[],
): Promise<{ nodesCreated: number; edgesCreated: number }> {
  let nodesCreated = 0;
  let edgesCreated = 0;

  for (const req of requirements) {
    const munNode = req.municipality ? await upsertNode('Kommun', req.municipality) : null;
    const caseNode = req.caseNumber
      ? await upsertNode('Arende', req.caseNumber, { municipality: req.municipality })
      : null;
    const reqName = req.requirementText.slice(0, 200);
    const reqNode = await upsertNode('Miljokrav', reqName, {
      category: req.category,
      confidence: req.confidence ?? 0,
    });
    nodesCreated++;

    if (munNode && caseNode) {
      await upsertEdge(munNode, caseNode, 'handlagger');
      edgesCreated++;
    }
    if (caseNode) {
      await upsertEdge(caseNode, reqNode, 'innehaller', req.confidence ?? 1);
      edgesCreated++;
    }

    const legal = req.legalReference ?? CATEGORY_LEGAL[req.category];
    if (legal) {
      const legalNode = await upsertNode('Lagregel', legal);
      nodesCreated++;
      await upsertEdge(reqNode, legalNode, 'motiveras_av');
      edgesCreated++;
    }

    for (const riskName of CATEGORY_RISKS[req.category] ?? []) {
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
        include: { target: true },
      },
    },
  });

  const requirements: string[] = nodes.map((n) => n.name);
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

export async function getGraphStats(): Promise<GraphStorageStats> {
  const [counts, totalEdges, totalNodes, legacy] = await Promise.all([
    prisma.knowledgeNode.groupBy({
      by: ['nodeType'],
      _count: { id: true },
    }),
    prisma.knowledgeEdge.count(),
    prisma.knowledgeNode.count(),
    getLegacyGraphCounts(),
  ]);

  const hasLegacyTables = legacy.available;
  const effectiveBackend: 'knowledge' | 'graph' =
    hasLegacyTables && (legacy.nodes > totalNodes || legacy.edges > totalEdges) ? 'graph' : 'knowledge';

  const preferred = {
    backend: 'knowledge' as const,
    nodes: totalNodes,
    edges: totalEdges,
  };

  const legacyObj = hasLegacyTables
    ? {
        backend: 'graph' as const,
        nodes: legacy.nodes,
        edges: legacy.edges,
      }
    : null;

  const effective = {
    backend: effectiveBackend,
    nodes: effectiveBackend === 'graph' ? legacy.nodes : totalNodes,
    edges: effectiveBackend === 'graph' ? legacy.edges : totalEdges,
  };

  const driftDetected = hasLegacyTables && (legacy.nodes !== totalNodes || legacy.edges !== totalEdges);

  const byType = counts.reduce((acc, curr) => {
    acc[curr.nodeType] = curr._count.id;
    return acc;
  }, {} as Record<string, number>);

  const nodesByType = counts.map((r) => ({ nodeType: r.nodeType, count: r._count.id }));

  const storage = {
    preferred,
    legacy: legacyObj,
    effective,
    driftDetected,
  };

  return {
    preferred,
    legacy: legacyObj,
    effective,
    driftDetected,
    byType,
    totalNodes: effective.nodes,
    totalEdges: effective.edges,
    searchableNodes: totalNodes,
    searchableEdges: totalEdges,
    nodesByType,
    storage,
  };
}

// ─── Full-text search with synonym-expanding lexical match ──────────────────

const SWEDISH_STOPWORDS = new Set([
  'och', 'i', 'att', 'en', 'ett', 'ska', 'som', 'men', 'om', 'med', 'de', 'den', 'det', 'på', 'av', 'för', 'till', 'eller', 'har', 'inte', 'under', 'över', 'vid', 'hur', 'vad', 'var', 'vem', 'vilka', 'vilken', 'vilket', 'finns', 'är', 'kan', 'kräva', 'planerad', 'nära', 'risk', 'kommunen'
]);

const CONCEPT_SYNONYMS: Record<string, string[]> = {
  sanering: ['sanering', 'förorenad mark', 'ebh', 'mifo', 'markförorening', 'föroreningar', 'miljöskuld'],
  bygglov: ['bygglov', 'lov', 'detaljplan', 'pbl', 'plan- och bygglagen', 'byggnation', 'bygga'],
  vattenskydd: ['vattenskydd', 'skyddsområde', 'grundvatten', 'vattentäkt', 'dricksvatten', 'vattenrening'],
  avfall: ['avfall', 'farligt avfall', 'avfallsförordningen', 'deponi', 'återvinning', 'skrot'],
  strandskydd: ['strandskydd', 'strand', 'vattendrag', 'sjö', 'hav', 'miljöbalken 7 kap'],
  dagvatten: ['dagvatten', 'avrinning', 'lakvatten', 'brunn', 'dagvattenavrinning', 'skyfall', 'dränering'],
  skred: ['skred', 'skredrisk', 'ravin', 'lera', 'sluttning', 'ras', 'markstabilitet'],
  buller: ['buller', 'bullernivå', 'bullerskydd', 'ljud', 'trafikbuller', 'industribuller']
};

/**
 * Splits query phrases into normalized words, filters out Swedish stopwords,
 * and expands terms using synonym mapping.
 */
export function extractExpandedSearchTerms(query: string): string[] {
  const words = query
    .toLowerCase()
    .replace(/[^a-z0-9åäöé\-]/g, ' ')
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length > 2 && !SWEDISH_STOPWORDS.has(w));

  const expanded = new Set<string>();
  for (const word of words) {
    expanded.add(word);
    
    // Expand using synonyms
    for (const [key, synonyms] of Object.entries(CONCEPT_SYNONYMS)) {
      if (word === key || synonyms.includes(word)) {
        synonyms.forEach(syn => expanded.add(syn));
      }
    }
  }

  return Array.from(expanded);
}

/**
 * searchGraph — sök noder vars namn matchar sökfrasen.
 * Använder en exakt/standard ILIKE-sökning först, och faller tillbaka på synonym- och stoppords-expanderad OR-sökning
 * för optimal RAG-berikning på naturligt språk.
 * Returnerar matchande noder + deras direkta kanter (1 hop).
 */
export async function searchGraph(params: {
  query: string;
  nodeTypes?: string[];
  limit?: number;
}): Promise<GraphQueryResult> {
  const limit = Math.min(params.limit ?? 50, 200);
  const query = params.query.trim();

  let nodeRows = await prisma.knowledgeNode.findMany({
    where: {
      name: { contains: query, mode: 'insensitive' },
      ...(params.nodeTypes ? { nodeType: { in: params.nodeTypes as KnowledgeNodeType[] } } : {}),
    },
    take: limit,
    orderBy: [{ name: 'asc' }, { id: 'desc' }],
    include: {
      outEdges: { take: 100 },
      inEdges: { take: 100 },
    },
  });

  // Fallback to synonym and stopword expanded search if exact match is empty
  if (nodeRows.length === 0) {
    const expandedTerms = extractExpandedSearchTerms(query);
    if (expandedTerms.length > 0) {
      nodeRows = await prisma.knowledgeNode.findMany({
        where: {
          OR: expandedTerms.map(term => ({
            name: { contains: term, mode: 'insensitive' }
          })),
          ...(params.nodeTypes ? { nodeType: { in: params.nodeTypes as KnowledgeNodeType[] } } : {}),
        },
        take: limit,
        orderBy: [{ name: 'asc' }, { id: 'desc' }],
        include: {
          outEdges: { take: 100 },
          inEdges: { take: 100 },
        },
      });
    }
  }

  if (nodeRows.length === 0) {
    return { nodes: [], edges: [] };
  }

  const nodes = nodeRows.map((n) => ({
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
      if (!nodeRows.some((orig) => orig.id === e.sourceId)) extraNodeIds.add(e.sourceId);
      if (!nodeRows.some((orig) => orig.id === e.targetId)) extraNodeIds.add(e.targetId);
    }
  }

  if (extraNodeIds.size > 0) {
    const extraNodes = await prisma.knowledgeNode.findMany({
      where: { id: { in: Array.from(extraNodeIds) } },
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

  return { nodes, edges: Array.from(new Set(edges.map((e) => JSON.stringify(e)))).map((s) => JSON.parse(s)) };
}
