/**
 * knowledgeGraphService.ts
 *
 *
 * STUBBED - Legacy graph functionality removed.
 */

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

// ─── Node / Edge upsert ─────────────────────────────────────────────────────

export async function upsertNode(
  _type: string,
  _name: string,
  _metadata: Record<string, unknown> = {},
): Promise<string> {
  return 'stub-node-id';
}

export async function upsertEdge(
  _sourceId: string,
  _targetId: string,
  _relation: string,
  _weight = 1.0,
  _metadata: Record<string, unknown> = {},
): Promise<string> {
  return 'stub-edge-id';
}

// ─── Build graph from requirements ─────────────────────────────────────────

export async function buildGraphFromRequirements(
  _requirements: RequirementInput[],
): Promise<{ nodesCreated: number; edgesCreated: number }> {
  return { nodesCreated: 0, edgesCreated: 0 };
}

// ─── Query helpers ──────────────────────────────────────────────────────────

export async function getTypicalRequirements(_params: {
  category?: string;
  municipality?: string;
  limit?: number;
}): Promise<{ requirements: string[]; risks: string[]; legalRules: string[] }> {
  return { requirements: [], risks: [], legalRules: [] };
}

export async function getGraphStats() {
  return {
    totalNodes: 0,
    totalEdges: 0,
    searchableNodes: 0,
    searchableEdges: 0,
    nodesByType: [],
    storage: {
      effective: { nodes: 0, edges: 0 },
    },
  };
}

// ─── Full-text search ────────────────────────────────────────────────────────

/**
 * searchGraph — STUBBED
 */
export async function searchGraph(_params: {
  query: string;
  nodeTypes?: string[];
  limit?: number;
}): Promise<GraphQueryResult> {
  return { nodes: [], edges: [] };
}
