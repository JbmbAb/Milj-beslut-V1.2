import { it, expect, beforeAll } from 'vitest';
import { prisma } from '../../server/db/prisma';
import {
  upsertNode,
  buildGraphFromRequirements,
  getGraphStats,
  searchGraph,
} from '../../server/services/knowledgeGraphService';
import { describeIfDatabaseIntegration } from './integrationTestEnv';

describeIfDatabaseIntegration('knowledgeGraphService integration tests (REAL DB)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  it('should persist a REAL node in the database and retrieve it', async () => {
    const uniqueName = `IntegrationNode_${Date.now()}`;

    const nodeId = await upsertNode('Kommun', uniqueName, { test: true });
    expect(nodeId).toBeDefined();

    const savedNode = await prisma.knowledgeNode.findUnique({
      where: { id: nodeId },
    });

    expect(savedNode).not.toBeNull();
    expect(savedNode?.name).toBe(uniqueName);
    expect(savedNode?.nodeType).toBe('MUNICIPALITY');
  });

  it('should generate multiple nodes and edges for a real-world requirement', async () => {
    const input = [
      {
        municipality: 'Stockholm',
        caseNumber: `CASE-${Date.now()}`,
        requirementText: 'Täckmassor ska siktas och kontrolleras för lakvatten.',
        category: 'water_management',
        requirementLevel: 'MANDATORY',
      },
    ];

    const { nodesCreated, edgesCreated } = await buildGraphFromRequirements(input);

    expect(nodesCreated).toBeGreaterThan(0);
    expect(edgesCreated).toBeGreaterThan(0);

    const graphSearch = await searchGraph({ query: 'Stockholm' });
    expect(graphSearch.nodes.length).toBeGreaterThan(1);
    expect(graphSearch.edges.length).toBeGreaterThan(0);
  });

  it('should show correct statistics from the real database', async () => {
    const statsBefore = await getGraphStats();

    await upsertNode('Risktyp', `Brand_Test_${Date.now()}`);

    const statsAfter = await getGraphStats();
    expect(statsAfter.totalNodes).toBeGreaterThan(statsBefore.totalNodes);
  });
});
