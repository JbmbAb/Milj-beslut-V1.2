import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Prisma mock ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  knowledgeNodeFindMany: vi.fn(),
  knowledgeNodeCount: vi.fn(),
  knowledgeNodeGroupBy: vi.fn(),
  knowledgeNodeUpsert: vi.fn(),
  knowledgeEdgeUpsert: vi.fn(),
  knowledgeEdgeCount: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    knowledgeNode: {
      findMany: mocks.knowledgeNodeFindMany,
      count: mocks.knowledgeNodeCount,
      groupBy: mocks.knowledgeNodeGroupBy,
      upsert: mocks.knowledgeNodeUpsert,
    },
    knowledgeEdge: {
      upsert: mocks.knowledgeEdgeUpsert,
      count: mocks.knowledgeEdgeCount,
    },
  },
}));

import {
  getGraphStats,
  getTypicalRequirements,
  searchGraph,
} from '../../server/services/knowledgeGraphService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeNode(overrides: Partial<{
  id: string;
  nodeType: string;
  name: string;
  metadata: Record<string, unknown>;
  outEdges: unknown[];
  inEdges: unknown[];
}> = {}) {
  return {
    id: 'node-1',
    nodeType: 'REQUIREMENT',
    name: 'Krav på dagvattenhantering',
    metadata: {},
    outEdges: [],
    inEdges: [],
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('knowledgeGraphService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── searchGraph ────────────────────────────────────────────────────────────

  describe('searchGraph', () => {
    it('returns empty result when no nodes match', async () => {
      mocks.knowledgeNodeFindMany.mockResolvedValue([]);

      const result = await searchGraph({ query: 'nonexistent term' });

      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
    });

    it('returns matched nodes and their edges', async () => {
      const node = makeNode({
        outEdges: [{ id: 'edge-1', sourceId: 'node-1', targetId: 'node-2', relation: 'motiveras_av', weight: 1 }],
        inEdges: [],
      });
      mocks.knowledgeNodeFindMany
        .mockResolvedValueOnce([node])   // primary query
        .mockResolvedValueOnce([]);       // extra nodes (targets not in result)

      const result = await searchGraph({ query: 'dagvatten' });

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].name).toBe('Krav på dagvattenhantering');
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].relation).toBe('motiveras_av');
    });

    it('caps results at 200', async () => {
      mocks.knowledgeNodeFindMany.mockResolvedValue([]);

      await searchGraph({ query: 'x', limit: 9999 });

      expect(mocks.knowledgeNodeFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 200 }),
      );
    });

    it('applies nodeTypes filter when provided', async () => {
      mocks.knowledgeNodeFindMany.mockResolvedValue([]);

      await searchGraph({ query: 'miljö', nodeTypes: ['LAW'] });

      expect(mocks.knowledgeNodeFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            nodeType: expect.anything(),
          }),
        }),
      );
    });

    it('deduplicates edges', async () => {
      const edge = { id: 'edge-1', sourceId: 'node-1', targetId: 'node-2', relation: 'hanterar', weight: 1 };
      const node = makeNode({ outEdges: [edge, edge], inEdges: [] }); // duplicate edge
      mocks.knowledgeNodeFindMany.mockResolvedValueOnce([node]).mockResolvedValueOnce([]);

      const result = await searchGraph({ query: 'test' });

      const uniqueEdgeIds = new Set(result.edges.map((e) => e.id));
      expect(uniqueEdgeIds.size).toBe(result.edges.length);
    });
  });

  // ── getGraphStats ──────────────────────────────────────────────────────────

  describe('getGraphStats', () => {
    it('returns totals and per-type breakdown', async () => {
      mocks.knowledgeNodeGroupBy.mockResolvedValue([
        { nodeType: 'REQUIREMENT', _count: { id: 10 } },
        { nodeType: 'LAW', _count: { id: 5 } },
      ]);
      mocks.knowledgeEdgeCount.mockResolvedValue(25);
      mocks.knowledgeNodeCount.mockResolvedValue(15);

      const stats = await getGraphStats();

      expect(stats.totalNodes).toBe(15);
      expect(stats.totalEdges).toBe(25);
      expect(stats.nodesByType).toHaveLength(2);
      expect(stats.nodesByType.find((n) => n.nodeType === 'REQUIREMENT')?.count).toBe(10);
    });

    it('handles empty graph', async () => {
      mocks.knowledgeNodeGroupBy.mockResolvedValue([]);
      mocks.knowledgeEdgeCount.mockResolvedValue(0);
      mocks.knowledgeNodeCount.mockResolvedValue(0);

      const stats = await getGraphStats();

      expect(stats.totalNodes).toBe(0);
      expect(stats.totalEdges).toBe(0);
      expect(stats.nodesByType).toHaveLength(0);
    });
  });

  // ── getTypicalRequirements ─────────────────────────────────────────────────

  describe('getTypicalRequirements', () => {
    it('returns requirement names and connected risks/laws', async () => {
      const riskNode = { id: 'n-risk', nodeType: 'RISK', name: 'Grundvattenförorening' };
      const lawNode = { id: 'n-law', nodeType: 'LEGAL_RULE', name: 'Miljöbalken' };

      mocks.knowledgeNodeFindMany.mockResolvedValue([
        makeNode({
          outEdges: [
            { id: 'e1', sourceId: 'node-1', targetId: 'n-risk', relation: 'hanterar', weight: 1, target: riskNode },
            { id: 'e2', sourceId: 'node-1', targetId: 'n-law', relation: 'motiveras_av', weight: 1, target: lawNode },
          ],
        }),
      ]);

      const result = await getTypicalRequirements({});

      expect(result.requirements).toContain('Krav på dagvattenhantering');
      expect(result.risks).toContain('Grundvattenförorening');
      expect(result.legalRules).toContain('Miljöbalken');
    });

    it('returns empty arrays for empty graph', async () => {
      mocks.knowledgeNodeFindMany.mockResolvedValue([]);

      const result = await getTypicalRequirements({});

      expect(result.requirements).toHaveLength(0);
      expect(result.risks).toHaveLength(0);
      expect(result.legalRules).toHaveLength(0);
    });
  });
});
