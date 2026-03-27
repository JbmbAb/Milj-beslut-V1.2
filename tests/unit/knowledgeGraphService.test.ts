import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock prisma (vi.hoisted pattern) ────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  knowledgeNodeUpsert: vi.fn(),
  knowledgeEdgeUpsert: vi.fn(),
  knowledgeNodeFindMany: vi.fn(),
  knowledgeNodeCount: vi.fn(),
  knowledgeNodeGroupBy: vi.fn(),
  knowledgeEdgeCount: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    knowledgeNode: {
      upsert: mocks.knowledgeNodeUpsert,
      findMany: mocks.knowledgeNodeFindMany,
      count: mocks.knowledgeNodeCount,
      groupBy: mocks.knowledgeNodeGroupBy,
    },
    knowledgeEdge: {
      upsert: mocks.knowledgeEdgeUpsert,
      count: mocks.knowledgeEdgeCount,
    },
  },
}));

import {
  upsertNode,
  upsertEdge,
  buildGraphFromRequirements,
  getTypicalRequirements,
  getGraphStats,
  searchGraph,
  type RequirementInput,
} from '../../server/services/knowledgeGraphService';

// ─────────────────────────────────────────────────────────────────────────────

describe('upsertNode', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns the node id on success', async () => {
    mocks.knowledgeNodeUpsert.mockResolvedValue({ id: 'node-1' });
    const id = await upsertNode('Miljokrav', 'Krav på dagvatten', { extra: 1 });
    expect(id).toBe('node-1');
    expect(mocks.knowledgeNodeUpsert).toHaveBeenCalledOnce();
  });

  it('maps known Swedish type names to Prisma enum types', async () => {
    mocks.knowledgeNodeUpsert.mockResolvedValue({ id: 'node-2' });
    await upsertNode('Kommun', 'Stockholm');
    const call = mocks.knowledgeNodeUpsert.mock.calls[0][0];
    expect(call.create.nodeType).toBe('MUNICIPALITY');
  });

  it('falls back to REQUIREMENT for unknown types', async () => {
    mocks.knowledgeNodeUpsert.mockResolvedValue({ id: 'node-x' });
    await upsertNode('UnknownType', 'Something');
    const call = mocks.knowledgeNodeUpsert.mock.calls[0][0];
    expect(call.create.nodeType).toBe('REQUIREMENT');
  });

  it('passes metadata as JSON-safe value', async () => {
    mocks.knowledgeNodeUpsert.mockResolvedValue({ id: 'node-3' });
    await upsertNode('Lagregel', 'MB 2 kap', { ref: 'MB', year: 1998 });
    const call = mocks.knowledgeNodeUpsert.mock.calls[0][0];
    expect(call.create.metadata).toEqual({ ref: 'MB', year: 1998 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('upsertEdge', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns the edge id', async () => {
    mocks.knowledgeEdgeUpsert.mockResolvedValue({ id: 'edge-1' });
    const id = await upsertEdge('src-id', 'tgt-id', 'motiveras_av');
    expect(id).toBe('edge-1');
    expect(mocks.knowledgeEdgeUpsert).toHaveBeenCalledOnce();
  });

  it('uses default weight 1.0 when not provided', async () => {
    mocks.knowledgeEdgeUpsert.mockResolvedValue({ id: 'edge-2' });
    await upsertEdge('a', 'b', 'hanterar');
    const call = mocks.knowledgeEdgeUpsert.mock.calls[0][0];
    expect(call.create.weight).toBe(1.0);
  });

  it('uses supplied weight', async () => {
    mocks.knowledgeEdgeUpsert.mockResolvedValue({ id: 'edge-3' });
    await upsertEdge('a', 'b', 'innehaller', 0.75);
    const call = mocks.knowledgeEdgeUpsert.mock.calls[0][0];
    expect(call.create.weight).toBe(0.75);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('buildGraphFromRequirements', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns zero counts for empty input', async () => {
    const result = await buildGraphFromRequirements([]);
    expect(result.nodesCreated).toBe(0);
    expect(result.edgesCreated).toBe(0);
  });

  it('creates nodes and edges for a full requirement', async () => {
    mocks.knowledgeNodeUpsert.mockResolvedValue({ id: 'n1' });
    mocks.knowledgeEdgeUpsert.mockResolvedValue({ id: 'e1' });

    const req: RequirementInput = {
      attachmentHash: 'abc123',
      municipality: 'Stockholm',
      caseNumber: '2024-001',
      requirementText: 'Dagvatten ska hanteras korrekt.',
      category: 'water_management',
      requirementLevel: 'mandatory',
      legalReference: 'Miljöbalken 2 kap. 3 §',
      confidence: 0.9,
    };

    const result = await buildGraphFromRequirements([req]);
    expect(result.nodesCreated).toBeGreaterThan(0);
    expect(result.edgesCreated).toBeGreaterThan(0);
    expect(mocks.knowledgeNodeUpsert).toHaveBeenCalled();
    expect(mocks.knowledgeEdgeUpsert).toHaveBeenCalled();
  });

  it('skips municipality/case nodes when fields are absent', async () => {
    mocks.knowledgeNodeUpsert.mockResolvedValue({ id: 'n2' });
    mocks.knowledgeEdgeUpsert.mockResolvedValue({ id: 'e2' });

    const req: RequirementInput = {
      requirementText: 'Avfall ska sorteras.',
      category: 'hazardous_waste',
      requirementLevel: 'mandatory',
    };

    const result = await buildGraphFromRequirements([req]);
    // Only reqNode + legalNode + risk nodes — no municipality/case upserts
    const municipalityCalls = mocks.knowledgeNodeUpsert.mock.calls.filter(
      c => c[0].create?.nodeType === 'MUNICIPALITY'
    );
    expect(municipalityCalls.length).toBe(0);
    expect(result.nodesCreated).toBeGreaterThan(0);
  });

  it('uses CATEGORY_LEGAL fallback when legalReference is absent', async () => {
    mocks.knowledgeNodeUpsert.mockResolvedValue({ id: 'n3' });
    mocks.knowledgeEdgeUpsert.mockResolvedValue({ id: 'e3' });

    const req: RequirementInput = {
      requirementText: 'Dokumentation ska föras.',
      category: 'documentation',
      requirementLevel: 'mandatory',
    };

    await buildGraphFromRequirements([req]);
    const names = mocks.knowledgeNodeUpsert.mock.calls.map(c => c[0].create?.name ?? c[1]);
    const hasLegalFallback = names.some(n => typeof n === 'string' && n.includes('Miljöbalken'));
    expect(hasLegalFallback).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('getTypicalRequirements', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns empty arrays when no nodes found', async () => {
    mocks.knowledgeNodeFindMany.mockResolvedValue([]);
    const result = await getTypicalRequirements({});
    expect(result.requirements).toEqual([]);
    expect(result.risks).toEqual([]);
    expect(result.legalRules).toEqual([]);
  });

  it('extracts risk and legal rule names from outEdges', async () => {
    mocks.knowledgeNodeFindMany.mockResolvedValue([
      {
        id: 'n1',
        name: 'Dagvattenkrav',
        nodeType: 'REQUIREMENT',
        outEdges: [
          { target: { nodeType: 'RISK', name: 'lakvatten' } },
          { target: { nodeType: 'LEGAL_RULE', name: 'Miljöbalken 2 kap' } },
        ],
      },
    ]);
    const result = await getTypicalRequirements({ limit: 10 });
    expect(result.requirements).toContain('Dagvattenkrav');
    expect(result.risks).toContain('lakvatten');
    expect(result.legalRules).toContain('Miljöbalken 2 kap');
  });

  it('deduplicates risks across multiple nodes', async () => {
    mocks.knowledgeNodeFindMany.mockResolvedValue([
      {
        id: 'n1',
        name: 'Krav A',
        nodeType: 'REQUIREMENT',
        outEdges: [{ target: { nodeType: 'RISK', name: 'brand' } }],
      },
      {
        id: 'n2',
        name: 'Krav B',
        nodeType: 'REQUIREMENT',
        outEdges: [{ target: { nodeType: 'RISK', name: 'brand' } }],
      },
    ]);
    const result = await getTypicalRequirements({});
    expect(result.risks.filter(r => r === 'brand').length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('getGraphStats', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns totalNodes, totalEdges, and nodesByType', async () => {
    mocks.knowledgeNodeGroupBy.mockResolvedValue([
      { nodeType: 'REQUIREMENT', _count: { id: 5 } },
      { nodeType: 'RISK', _count: { id: 3 } },
    ]);
    mocks.knowledgeEdgeCount.mockResolvedValue(8);
    mocks.knowledgeNodeCount.mockResolvedValue(8);

    const stats = await getGraphStats();
    expect(stats.totalNodes).toBe(8);
    expect(stats.totalEdges).toBe(8);
    expect(stats.nodesByType).toEqual([
      { nodeType: 'REQUIREMENT', count: 5 },
      { nodeType: 'RISK', count: 3 },
    ]);
  });

  it('handles empty DB gracefully', async () => {
    mocks.knowledgeNodeGroupBy.mockResolvedValue([]);
    mocks.knowledgeEdgeCount.mockResolvedValue(0);
    mocks.knowledgeNodeCount.mockResolvedValue(0);

    const stats = await getGraphStats();
    expect(stats.totalNodes).toBe(0);
    expect(stats.totalEdges).toBe(0);
    expect(stats.nodesByType).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('searchGraph', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns empty result when no matching nodes', async () => {
    mocks.knowledgeNodeFindMany.mockResolvedValue([]);
    const result = await searchGraph({ query: 'nonexistent' });
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it('maps node rows to GraphNode shape', async () => {
    mocks.knowledgeNodeFindMany.mockResolvedValue([
      {
        id: 'n1',
        nodeType: 'REQUIREMENT',
        name: 'Dagvatten',
        metadata: { category: 'water_management' },
        outEdges: [],
        inEdges: [],
      },
    ]);
    const result = await searchGraph({ query: 'Dagvatten' });
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({ id: 'n1', nodeType: 'REQUIREMENT', name: 'Dagvatten' });
  });

  it('collects edges from outEdges and inEdges', async () => {
    const edge = { id: 'e1', sourceId: 'n1', targetId: 'n2', relation: 'hanterar', weight: 1 };
    mocks.knowledgeNodeFindMany
      .mockResolvedValueOnce([
        { id: 'n1', nodeType: 'REQUIREMENT', name: 'Krav', metadata: {}, outEdges: [edge], inEdges: [] },
      ])
      .mockResolvedValueOnce([
        { id: 'n2', nodeType: 'RISK', name: 'brand', metadata: {} },
      ]);

    const result = await searchGraph({ query: 'Krav' });
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({ id: 'e1', relation: 'hanterar' });
  });

  it('clamps limit to 200', async () => {
    mocks.knowledgeNodeFindMany.mockResolvedValue([]);
    await searchGraph({ query: 'x', limit: 9999 });
    const call = mocks.knowledgeNodeFindMany.mock.calls[0][0];
    expect(call.take).toBeLessThanOrEqual(200);
  });

  it('filters by nodeTypes when provided', async () => {
    mocks.knowledgeNodeFindMany.mockResolvedValue([]);
    await searchGraph({ query: 'x', nodeTypes: ['RISK'] });
    const call = mocks.knowledgeNodeFindMany.mock.calls[0][0];
    expect(call.where.nodeType).toBeDefined();
  });
});
