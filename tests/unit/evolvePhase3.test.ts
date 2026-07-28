import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileArtifactStore } from '../../server/artifact';
import type { PromotionArtifact } from '../../server/artifact';
import type { CompilationResult, PipelineDefinition } from '../../server/compiler';
import {
  EventLedger,
  EvolutionOrchestrator,
  ParetoFrontier,
  SimpleConstraintSolver,
  dominates,
  type CandidateGenerator,
  type EvaluationEngine,
} from '../../server/evolve';
import { hashArtifact } from '../../server/utils/hashArtifact';

function pipeline(id: string, quality = 1): PipelineDefinition {
  return {
    id,
    version: '1',
    nodes: [
      {
        id: 'n1',
        capability: 'retrieve',
        requirements: { minMemoryGb: quality },
      } as PipelineDefinition['nodes'][number],
    ],
  };
}

function compilation(definition: PipelineDefinition): CompilationResult {
  const executionHash = hashArtifact(definition);
  return {
    pipeline: {
      id: definition.id,
      version: definition.version,
      manifest: {
        pipelineId: definition.id,
        pipelineVersion: definition.version,
        nodes: [],
      },
      hashes: { manifestHash: executionHash, executionHash },
      executionOrder: [],
      nodes: [],
    },
    manifest: {
      pipelineId: definition.id,
      pipelineVersion: definition.version,
      nodes: [],
    },
    hashes: { manifestHash: executionHash, executionHash },
    warnings: [],
    durationMs: 0,
  };
}

describe('Phase 3 evolution stability fixes', () => {
  it('uses strict Pareto dominance so identical candidates remain non-dominating', () => {
    const a = {
      id: 'a',
      executionHash: 'a',
      artifactId: 'a',
      objectives: { quality: 1, latency: 10, cost: 2, error: 0 },
      fitness: 1,
    };
    const b = { ...a, id: 'b', executionHash: 'b', artifactId: 'b' };

    expect(dominates(a, b)).toBe(false);

    const frontier = new ParetoFrontier();
    frontier.add(a);
    frontier.add(b);

    expect(frontier.list()).toHaveLength(2);
  });

  it('restores event ledger sequence and hash chain from artifact store', async () => {
    const store = new FileArtifactStore(await tempDir());
    const first = new EventLedger(store, 'run-1');
    const started = await first.record({ type: 'RUN_STARTED', runId: 'run-1' });

    const second = new EventLedger(store, 'run-1');
    const generated = await second.record({ type: 'CANDIDATE_GENERATED', runId: 'run-1' });

    expect(generated.seq).toBe(2);
    expect(generated.prevEventHash).toBe(started.eventHash);
  });

  it('persists experiment records, approval decisions, cumulative lineage and batched shadow evaluation', async () => {
    const store = new FileArtifactStore(await tempDir());
    const frontier = new ParetoFrontier();
    const generator: CandidateGenerator = {
      generate: (_baseline, _context, _populationSize) => [
        {
          definition: pipeline('candidate-a', 2),
          mutation: { id: 'm1', type: 'raise-memory' },
        },
        {
          definition: pipeline('candidate-b', 99),
          mutation: { id: 'm2', type: 'too-large' },
        },
      ],
    };
    let batchCalls = 0;
    const evaluator: EvaluationEngine = {
      async compile(definition) {
        return compilation(definition);
      },
      async evaluateBatch(candidates, baseline) {
        batchCalls += 1;
        return candidates.map((_candidate) => ({
          metricsCandidate: { latencyMs: 8, costSek: 1, qualityScore: 2, errorRate: 0 },
          metricsBaseline: { latencyMs: 10, costSek: 1, qualityScore: 1, errorRate: 0 },
          fitnessCandidate: { rawFitness: 2, penalty: 0, fitness: 2 },
          fitnessBaseline: { rawFitness: 1, penalty: 0, fitness: 1 },
          baseline,
        }));
      },
    };
    const orchestrator = new EvolutionOrchestrator(
      generator,
      evaluator,
      store,
      frontier,
      {
        async approve() {
          return { approved: true, reviewer: 'test', reason: 'ok', timestamp: 1 };
        },
      },
      { minQualityDelta: 0.5, maxLatencyRegression: 0, maxCostRegression: 0, maxErrorRegression: 0 },
      new SimpleConstraintSolver(),
      new EventLedger(store, 'run-approval'),
    );

    await orchestrator.evolve(
      { id: 'run-approval', seed: 'seed' },
      pipeline('baseline', 1),
      1,
      2,
      { runtimeCapabilities: { memoryGb: 8 } },
    );

    const approved = await store.get<PromotionArtifact>('promotion-approved/promotion-run-approval-g001-c000');
    expect(batchCalls).toBe(1);
    expect(approved?.approvalDecision?.approved).toBe(true);
    expect(approved?.mutationChain.map((mutation) => mutation.id)).toEqual(['m1']);
    expect(await store.get('approval/promotion-run-approval-g001-c000')).toBeDefined();
    expect(await store.get('experiment/run-approval/run-approval-g001-c001')).toMatchObject({
      candidateExecutionHash: 'n/a',
      promotion: { promote: false },
    });
  });

  it('keeps original candidate indexes after constraint filtering', async () => {
    const store = new FileArtifactStore(await tempDir());
    const generator: CandidateGenerator = {
      generate: () => [
        {
          definition: pipeline('rejected-first', 32),
          mutation: { id: 'm0', type: 'too-large' },
        },
        {
          definition: pipeline('accepted-second', 2),
          mutation: { id: 'm1', type: 'accepted' },
        },
      ],
    };
    const evaluator: EvaluationEngine = {
      async compile(definition) {
        return compilation(definition);
      },
      async evaluateBatch(candidates) {
        return candidates.map(() => ({
          metricsCandidate: { latencyMs: 8, costSek: 1, qualityScore: 2, errorRate: 0 },
          metricsBaseline: { latencyMs: 10, costSek: 1, qualityScore: 1, errorRate: 0 },
          fitnessCandidate: { rawFitness: 2, penalty: 0, fitness: 2 },
          fitnessBaseline: { rawFitness: 1, penalty: 0, fitness: 1 },
        }));
      },
    };
    const orchestrator = new EvolutionOrchestrator(
      generator,
      evaluator,
      store,
      new ParetoFrontier(),
      {
        async approve() {
          return { approved: true, timestamp: 1 };
        },
      },
      { minQualityDelta: 0.5, maxLatencyRegression: 0, maxCostRegression: 0, maxErrorRegression: 0 },
      new SimpleConstraintSolver(),
      new EventLedger(store, 'run-sparse'),
    );

    await orchestrator.evolve(
      { id: 'run-sparse', seed: 'seed' },
      pipeline('baseline', 1),
      1,
      2,
      { runtimeCapabilities: { memoryGb: 8 } },
    );

    expect(await store.get('experiment/run-sparse/run-sparse-g001-c000')).toMatchObject({
      candidateExecutionHash: 'n/a',
    });
    expect(await store.get('experiment/run-sparse/run-sparse-g001-c001')).toMatchObject({
      candidateExecutionHash: expect.stringMatching(/^sha256:/),
    });
    expect(await store.get('promotion-approved/promotion-run-sparse-g001-c001')).toBeDefined();
  });
});

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'miljobeslut-evolve-'));
}
