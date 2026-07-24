import { it, expect, beforeAll, afterAll } from 'vitest';
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

  afterAll(async () => {
    await prisma.$disconnect();
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
    expect(statsAfter.effective.nodes).toBeGreaterThan(statsBefore.effective.nodes);
  });

  it('should search graph with Swedish natural language questions using stopword filtering and synonym expansion', async () => {
    // 1. Create a node for 'förorenad mark' which is a synonym of 'sanering'
    const uniqueSynonymName = `förorenad mark ${Date.now()}`;
    await upsertNode('Risktyp', uniqueSynonymName);

    // 2. Search using natural language containing synonym word 'sanering'
    // 'Kan kommunen kräva sanering?' should trigger expansion to include 'förorenad mark'
    const searchResult = await searchGraph({ query: 'Kan kommunen kräva sanering?' });

    // 3. Verify it found the 'förorenad mark' node
    const foundNames = searchResult.nodes.map((n) => n.name);
    expect(foundNames).toContain(uniqueSynonymName);
  });
});
