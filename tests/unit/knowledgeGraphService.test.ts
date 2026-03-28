import { describe, it, expect, vi, beforeEach } from 'vitest';

// 1. Mocka Prisma HOISTED (Definitiv lösning)
const prismaMock = vi.hoisted(() => ({
  knowledgeNode: {
    upsert: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
  },
  knowledgeEdge: {
    upsert: vi.fn(),
    count: vi.fn(),
  },
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: prismaMock,
}));

// Import tjänst EFTER mock
import { 
  upsertNode, 
  buildGraphFromRequirements, 
  getGraphStats,
  searchGraph,
  getTypicalRequirements
} from '../../server/services/knowledgeGraphService';

describe('knowledgeGraphService unit tests', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should map node types correctly', async () => {
    prismaMock.knowledgeNode.upsert.mockResolvedValue({ id: 'n1' });
    const id = await upsertNode('Kommun', 'Test');
    expect(id).toBe('n1');
    expect(prismaMock.knowledgeNode.upsert).toHaveBeenCalledWith(expect.objectContaining({
       create: expect.objectContaining({ nodeType: 'MUNICIPALITY' })
    }));
  });

  it('should build a graph from requirement input', async () => {
    prismaMock.knowledgeNode.upsert.mockResolvedValue({ id: 'any' });
    prismaMock.knowledgeEdge.upsert.mockResolvedValue({ id: 'edge' });

    const stats = await buildGraphFromRequirements([{
      requirementText: 'test',
      category: 'water_management',
      requirementLevel: 'MANDATORY'
    }]);

    expect(stats.nodesCreated).toBeGreaterThan(0);
    expect(prismaMock.knowledgeNode.upsert).toHaveBeenCalled();
  });

  it('should traverse the graph for search including neighbors', async () => {
    prismaMock.knowledgeNode.findMany
      .mockResolvedValueOnce([{
        id: 'n1', nodeType: 'REQUIREMENT', name: 'Ref', 
        outEdges: [{ id: 'e1', sourceId: 'n1', targetId: 'n2', relation: 'r' }],
        inEdges: []
      }])
      .mockResolvedValueOnce([{ id: 'n2', nodeType: 'LEGAL', name: 'Law' }]);

    const result = await searchGraph({ query: 'Ref' });
    expect(result.nodes).toHaveLength(2);
  });

  it('should return aggregated stats', async () => {
    prismaMock.knowledgeNode.groupBy.mockResolvedValue([{ nodeType: 'RISK', _count: { id: 1 } }]);
    prismaMock.knowledgeNode.count.mockResolvedValue(10);
    prismaMock.knowledgeEdge.count.mockResolvedValue(5);

    const stats = await getGraphStats();
    expect(stats.totalNodes).toBe(10);
  });

  it('should return requirements with associated targets', async () => {
    prismaMock.knowledgeNode.findMany.mockResolvedValue([{
      name: 'R1',
      outEdges: [{ target: { nodeType: 'RISK', name: 'Risk 1' } }]
    }]);

    const result = await getTypicalRequirements({});
    expect(result.risks).toContain('Risk 1');
  });

});
