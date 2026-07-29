/**
 * Local evolution smoke / integration harness.
 *
 *   npx tsx scripts/evolve-integration-test.ts
 *
 * Writes artifacts under ./tmp-artifacts (gitignored).
 */
import path from 'node:path';
import { FileArtifactStore } from '../server/artifact/FileArtifactStore';
import { DefaultEvaluationEngine } from '../server/evolve/DefaultEvaluationEngine';
import { EventLedger } from '../server/evolve/EventLedger';
import { EvolutionOrchestrator } from '../server/evolve/EvolutionOrchestrator';
import type { EvolutionRun } from '../server/evolve/EvolutionRun';
import { FitnessEngine, DefaultFitnessProfile } from '../server/evolve/FitnessEngine';
import { ParetoFrontier } from '../server/evolve/ParetoFrontier';
import { SimpleApprovalGate } from '../server/evolve/SimpleApprovalGate';
import { SimpleConstraintSolver } from '../server/evolve/ConstraintSolver';
import { BatchShadowEvaluator } from '../server/evolve/BatchShadowEvaluator';
import { StubCandidateGenerator } from '../server/evolve/StubCandidateGenerator';
import type { PipelineDefinition } from '../server/compiler/types';
import type { PromotionArtifact } from '../server/artifact/PromotionArtifact';

async function main(): Promise<void> {
  const artifactsDir = path.resolve(process.cwd(), 'tmp-artifacts');
  const store = new FileArtifactStore(artifactsDir);

  const run: EvolutionRun = {
    id: `evo-test-${Date.now()}`,
    seed: 'test-seed-123',
    compilerVersion: 'smoke-compiler-1',
    registryVersion: 'smoke-registry-1',
    searchSpaceHash: 'sha256:smoke',
    createdAt: Date.now(),
  };

  const baseline: PipelineDefinition = {
    id: 'baseline-pipeline',
    version: '1.0.0',
    nodes: [
      { id: 'n1', capability: 'vector_search', resources: [] },
      { id: 'n2', capability: 'reranker', resources: [] },
    ],
  };

  const shadow = new BatchShadowEvaluator();
  const fitness = new FitnessEngine(DefaultFitnessProfile);
  const evaluator = new DefaultEvaluationEngine({ shadow, fitness });
  const generator = new StubCandidateGenerator();
  const approvalGate = new SimpleApprovalGate();
  const constraintSolver = new SimpleConstraintSolver();
  const frontier = new ParetoFrontier();
  const eventLedger = new EventLedger(store, run.id);

  const orchestrator = new EvolutionOrchestrator(
    generator,
    evaluator,
    store,
    frontier,
    approvalGate,
    {
      // Lenient enough for stub shadow (quality↑ but latency↑).
      minQualityDelta: 0.01,
      maxLatencyRegression: 500,
      maxCostRegression: 1,
      maxErrorRegression: 0.1,
    },
    constraintSolver,
    eventLedger,
  );

  console.log('Starting short evolution run:', run.id);
  const finalBaseline = await orchestrator.evolve(run, baseline, 2, 3, {
    runtimeCapabilities: { gpu: false, memoryGb: 8 },
  });

  console.log('Evolution finished. Final baseline pipeline id:', finalBaseline.id);

  console.log('Simulating resume: listing promotions and frontier snapshot...');
  const promotions = await store.list('promotion/');
  console.log('Promotions keys:', promotions);

  const frontierSnapshot = await store.get(`frontier/${run.id}`);
  console.log('Frontier snapshot:', JSON.stringify(frontierSnapshot, null, 2));

  const experiments = await store.list(`experiment/${run.id}/`);
  console.log('Experiment keys:', experiments);

  const approved = await store.list('promotion-approved/');
  for (const key of approved) {
    const art = await store.get<PromotionArtifact>(key);
    console.log(
      'Approved promotion:',
      key,
      'executionHash:',
      art?.executionHash,
      'artifactHash:',
      art?.artifactHash,
    );
    console.log('Mutation chain length:', (art?.mutationChain ?? []).length);
  }

  const events = await store.list(`event/${run.id}/`);
  console.log('Event keys:', events.length);

  console.log('Integration test complete. Artifacts stored under:', artifactsDir);
}

main().catch((err) => {
  console.error('Integration test failed:', err);
  process.exit(1);
});
