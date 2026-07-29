import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FileCASRepository,
  InMemoryEventLog,
  RecoveryOrchestrator,
} from '@miljobeslut/mimers-brunn-core';
import { FileArtifactStore, type ApprovalRecord, type PromotionArtifactV3 } from '../../server/artifact';
import type { CompilationResult, PipelineDefinition } from '../../server/compiler';
import {
  EventLedger,
  EvolutionOrchestrator,
  ParetoFrontier,
  SimpleConstraintSolver,
  dominates,
  type CandidateGenerator,
  type EvaluationEngine,
  type PromotionCandidate,
} from '../../server/evolve';
import { MimersPromotionBackend, mimersBindingKey, verifyPromotionAgainstBackend } from '../../server/mimers';
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

describe('Phase 3/4 WORM evolution', () => {
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

  it('WORM: seals promotion only after approval; approval points at candidate', async () => {
    const store = new FileArtifactStore(await tempDir());
    const frontier = new ParetoFrontier();
    const seenCandidates: PromotionCandidate[] = [];
    const generator: CandidateGenerator = {
      generate: () => [
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
        return candidates.map(() => ({
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
        async approve(candidate) {
          seenCandidates.push(candidate);
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

    expect(batchCalls).toBe(1);
    expect(seenCandidates).toHaveLength(1);
    expect(seenCandidates[0]?.candidateId).toBe('run-approval-g001-c000');

    const promotions = await store.list('promotion/');
    expect(promotions).toHaveLength(1);
    expect(promotions[0]?.startsWith('promotion/sha256:')).toBe(true);

    const sealed = await store.get<PromotionArtifactV3>(promotions[0]!);
    expect(sealed?.schemaVersion).toBe('promotion.v3');
    expect(sealed?.approvalRecordId).toBe('run-approval-g001-c000');
    expect(sealed?.mutationChain.map((m) => m.id)).toEqual(['m1']);
    expect(sealed?.evolutionRunId).toBe('run-approval');

    const approval = await store.get<ApprovalRecord>('approval/run-approval-g001-c000');
    expect(approval?.subjectId).toBe('run-approval-g001-c000');
    expect(approval?.subjectType).toBe('promotion-candidate');
    expect(approval?.decision).toBe('approved');
    expect(approval?.decidedBy).toBe('test');

    expect(await store.list('promotion-approved/')).toEqual([]);
    expect(await store.get('experiment/run-approval/run-approval-g001-c001')).toMatchObject({
      candidateExecutionHash: 'n/a',
      promotion: { promote: false },
    });
  });

  it('WORM: gate rejection writes ApprovalRecord but no promotion artifact', async () => {
    const store = new FileArtifactStore(await tempDir());
    const generator: CandidateGenerator = {
      generate: () => [
        {
          definition: pipeline('candidate-a', 2),
          mutation: { id: 'm1', type: 'raise-memory' },
        },
      ],
    };
    const evaluator: EvaluationEngine = {
      async compile(definition) {
        return compilation(definition);
      },
      async evaluateBatch(candidates, baseline) {
        return candidates.map(() => ({
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
      new ParetoFrontier(),
      {
        async approve() {
          return { approved: false, reviewer: 'test', reason: 'nope', timestamp: 1 };
        },
      },
      { minQualityDelta: 0.5, maxLatencyRegression: 0, maxCostRegression: 0, maxErrorRegression: 0 },
      new SimpleConstraintSolver(),
      new EventLedger(store, 'run-reject'),
    );

    await orchestrator.evolve(
      { id: 'run-reject', seed: 'seed' },
      pipeline('baseline', 1),
      1,
      1,
      { runtimeCapabilities: { memoryGb: 8 } },
    );

    expect(await store.list('promotion/')).toEqual([]);
    const approval = await store.get<ApprovalRecord>('approval/run-reject-g001-c000');
    expect(approval?.decision).toBe('rejected');
    expect(await store.get('experiment/run-reject/run-reject-g001-c000')).toBeDefined();
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
    const promotions = await store.list('promotion/');
    expect(promotions).toHaveLength(1);
    expect(await store.list('promotion-approved/')).toEqual([]);
  });

  it('CAS-primary: Mimers ledger is truth; V3 is index with binding', async () => {
    const store = new FileArtifactStore(await tempDir());
    const casDir = await tempDir();
    const cas = new FileCASRepository(casDir, { durabilityMode: 'none' });
    await cas.initialize();
    const mimersLog = new InMemoryEventLog();
    const mimers = new MimersPromotionBackend(cas, mimersLog);

    const generator: CandidateGenerator = {
      generate: () => [
        {
          definition: pipeline('candidate-a', 2),
          mutation: { id: 'm1', type: 'raise-memory' },
        },
      ],
    };
    const evaluator: EvaluationEngine = {
      async compile(definition) {
        return compilation(definition);
      },
      async evaluateBatch(candidates, baseline) {
        return candidates.map(() => ({
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
      new ParetoFrontier(),
      {
        async approve() {
          return { approved: true, reviewer: 'test', reason: 'ok', timestamp: 1 };
        },
      },
      { minQualityDelta: 0.5, maxLatencyRegression: 0, maxCostRegression: 0, maxErrorRegression: 0 },
      new SimpleConstraintSolver(),
      new EventLedger(store, 'run-mimers'),
      undefined,
      mimers,
      true, // requireMimers — CAS-primary
    );

    await orchestrator.evolve(
      { id: 'run-mimers', seed: 'seed', compilerVersion: 'c1', registryVersion: 'r1' },
      pipeline('baseline', 1),
      1,
      1,
      { runtimeCapabilities: { memoryGb: 8 } },
    );

    const promotions = await store.list('promotion/');
    expect(promotions).toHaveLength(1);
    const sealed = await store.get<PromotionArtifactV3>(promotions[0]!);
    expect(sealed?.manifestHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(sealed?.metadata?.mimersPromotionHash).toMatch(/^sha256:/);
    expect(sealed?.metadata?.mimersEventId).toBeTruthy();
    expect(await cas.existsAuthoritative(sealed!.manifestHash!)).toBe(true);
    expect(await cas.existsAuthoritative(String(sealed!.metadata!.mimersPromotionHash))).toBe(true);

    const casCheck = await verifyPromotionAgainstBackend(sealed!, mimers, {
      store,
      verifyDescriptors: true,
      eventLog: mimersLog,
    });
    expect(casCheck.ok).toBe(true);
    expect(casCheck.errors).toEqual([]);
    expect(await store.get(mimersBindingKey(sealed!.artifactHash))).toMatchObject({
      manifestHash: sealed!.manifestHash,
      mimersPromotionHash: sealed!.metadata!.mimersPromotionHash,
      toolVersion: 'mimers-cas-primary-v1',
    });

    const recovery = new RecoveryOrchestrator(cas, () => mimersLog.getAllEvents());
    expect((await recovery.auditL0()).status).toBe('CLEAN');
    expect((await recovery.auditL1()).status).toBe('CLEAN');
    expect((await recovery.auditL2()).status).toBe('CLEAN');
  });

  it('requireMimers fails closed without backend', async () => {
    const store = new FileArtifactStore(await tempDir());
    const orchestrator = new EvolutionOrchestrator(
      { generate: () => [] },
      {
        async compile(definition) {
          return compilation(definition);
        },
        async evaluateBatch() {
          return [];
        },
      },
      store,
      new ParetoFrontier(),
      { async approve() { return { approved: false, reviewer: 't', reason: 'n', timestamp: 1 }; } },
      { minQualityDelta: 0.5, maxLatencyRegression: 0, maxCostRegression: 0, maxErrorRegression: 0 },
      new SimpleConstraintSolver(),
      new EventLedger(store, 'run-req'),
      undefined,
      undefined,
      true,
    );
    await expect(
      orchestrator.evolve(
        { id: 'run-req', seed: 's', compilerVersion: 'c', registryVersion: 'r' },
        pipeline('baseline', 1),
        1,
        1,
      ),
    ).rejects.toThrow(/requireMimers/);
  });
});

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'miljobeslut-evolve-'));
}
