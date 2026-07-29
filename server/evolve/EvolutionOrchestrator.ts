import {
  approvalRecordFromDecision,
  approvalStoreKey,
  createPromotionArtifactV3Async,
  promotionStoreKey,
  requirePromotionV3,
  type ApprovalDecision,
  type ApprovalRecord,
  type PromotionArtifactV3,
  type SigningKeyProvider,
} from '../artifact';
import type { ArtifactStore } from '../artifact/ArtifactStore';
import type { PipelineDefinition } from '../compiler/types';
import { hashArtifact, hashArtifactPayload } from '../utils/hashArtifact';
import type { CandidateGenerator, GeneratedCandidate } from './CandidateGenerator';
import type { ConstraintContext, ConstraintSolver } from './ConstraintSolver';
import type { EvaluationEngine, EvaluationResult } from './EvaluationEngine';
import type { EventLedger } from './EventLedger';
import type { EvolutionRun } from './EvolutionRun';
import type { ExperimentRecord } from './ExperimentRecord';
import type { FitnessResult } from './FitnessResult';
import type { MutationRecord } from './MutationTypes';
import type { ParetoFrontier, FrontierCandidate } from './ParetoFrontier';
import type { PromotionCandidate } from './PromotionCandidate';
import { decidePromotion, type PromotionDecision, type PromotionPolicy } from './PromotionPolicy';
import type { ShadowMetrics } from './ShadowEvaluator';

interface FeasibleCandidate {
  readonly candidate: GeneratedCandidate;
  readonly candidateIndex: number;
}

export type ApprovalGate = {
  approve(candidate: PromotionCandidate): Promise<ApprovalDecision>;
};

const ZERO_METRICS: ShadowMetrics = {
  latencyMs: 0,
  costSek: 0,
  qualityScore: 0,
  errorRate: 0,
};

const REJECTED_FITNESS: FitnessResult = {
  rawFitness: 0,
  penalty: 0,
  fitness: -9999,
};

/**
 * WORM evolve loop: ExperimentRecord always; ApprovalRecord on gate path;
 * PromotionArtifactV3 only after approval (never mutated in place).
 */
export class EvolutionOrchestrator {
  constructor(
    private readonly generator: CandidateGenerator,
    private readonly evaluator: EvaluationEngine,
    private readonly artifactStore: ArtifactStore,
    private readonly frontier: ParetoFrontier,
    private readonly approvalGate: ApprovalGate,
    private readonly promotionPolicy: PromotionPolicy,
    private readonly constraintSolver: ConstraintSolver,
    private readonly eventLedger: EventLedger,
    private readonly signingKeyProvider?: SigningKeyProvider,
  ) {}

  async evolve(
    run: EvolutionRun,
    baseline: PipelineDefinition,
    generations: number,
    populationSize = 5,
    constraintCtx: ConstraintContext = { runtimeCapabilities: {} },
  ): Promise<PipelineDefinition> {
    await this.artifactStore.put(`evolution-run/${run.id}`, run);
    await this.eventLedger.record({ type: 'RUN_STARTED', runId: run.id });

    let current = baseline;
    /** Content-addressed parent promotion artifactId (AES V3). */
    let parentPromotionId: string | undefined;

    for (let generation = 1; generation <= generations; generation += 1) {
      const candidates = this.generator.generate(
        current,
        {
          experimentId: run.id,
          seed: run.seed,
          generation,
          candidateIndex: 0,
        },
        populationSize,
      );

      await this.eventLedger.record({
        type: 'CANDIDATE_GENERATED',
        runId: run.id,
        payloadHash: hashArtifact(candidates),
      });

      const feasible = await this.filterFeasible(run, generation, candidates, constraintCtx);
      const compiledBaseline = await this.evaluator.compile(current);
      const compiledCandidates = await Promise.all(
        feasible.map(async (item) => ({
          ...item,
          compiled: await this.evaluator.compile(item.candidate.definition),
        })),
      );

      const unique = compiledCandidates.filter((item, index, all) => {
        const executionHash = item.compiled.pipeline.hashes.executionHash;
        return all.findIndex((candidate) => candidate.compiled.pipeline.hashes.executionHash === executionHash) === index;
      });

      const evaluations = await this.evaluator.evaluateBatch(
        unique.map((item) => item.compiled),
        compiledBaseline,
      );
      await this.eventLedger.record({
        type: 'SHADOW_COMPLETED',
        runId: run.id,
        payloadHash: hashArtifact(evaluations.map((result) => result.metricsCandidate)),
      });

      if (evaluations.length !== unique.length) {
        throw new Error(`evaluateBatch returned ${evaluations.length} results for ${unique.length} candidates`);
      }

      for (let idx = 0; idx < unique.length; idx += 1) {
        const item = unique[idx];
        const evaluation = evaluations[idx];
        if (!item || !evaluation) continue;

        const experimentId = this.makeExperimentId(run.id, generation, item.candidateIndex);
        const promotionDecision = decidePromotion(
          evaluation.metricsCandidate,
          evaluation.metricsBaseline,
          this.promotionPolicy,
        );
        const experimentKey = await this.recordExperiment({
          run,
          generation,
          experimentId,
          mutation: item.candidate.mutation,
          candidateExecutionHash: item.compiled.pipeline.hashes.executionHash,
          baselineExecutionHash: compiledBaseline.pipeline.hashes.executionHash,
          evaluation,
          promotionDecision,
        });

        if (promotionDecision.promote) {
          const rawParent = parentPromotionId
            ? await this.artifactStore.get(`promotion/${parentPromotionId}`)
            : undefined;
          const parentPromotion = rawParent ? requirePromotionV3(rawParent) : undefined;
          const mutationChain = [...(parentPromotion?.mutationChain ?? []), item.candidate.mutation];

          const promotionCandidate = this.buildPromotionCandidate({
            runId: run.id,
            experimentId,
            candidate: item.candidate,
            pipelineId: item.compiled.pipeline.id,
            parentPromotionId,
            parentExecutionHash: compiledBaseline.pipeline.hashes.executionHash,
            executionHash: item.compiled.pipeline.hashes.executionHash,
            mutationChain,
            fitness: evaluation.fitnessCandidate,
          });

          const decision = await this.approvalGate.approve(promotionCandidate);
          const approval = this.writeApprovalRecord(run.id, promotionCandidate.candidateId, decision);
          await this.artifactStore.put(approvalStoreKey(approval.approvalId), approval);
          await this.eventLedger.record({
            type: decision.approved ? 'PROMOTION_APPROVED' : 'PROMOTION_REJECTED',
            runId: run.id,
            artifactId: approvalStoreKey(approval.approvalId),
            payloadHash: approval.artifactHash,
          });

          if (decision.approved) {
            const sealed = await this.sealApprovedPromotion(promotionCandidate, approval);
            const key = promotionStoreKey(sealed);
            await this.artifactStore.put(key, sealed);
            await this.eventLedger.record({
              type: 'PROMOTION_CREATED',
              runId: run.id,
              artifactId: key,
              payloadHash: sealed.artifactHash,
            });
            current = item.candidate.definition;
            parentPromotionId = sealed.artifactId;
          }
        }

        this.frontier.add(
          this.toFrontierCandidate(experimentId, experimentKey, item.compiled.pipeline.hashes.executionHash, evaluation),
        );
        await this.artifactStore.put(`frontier/${run.id}`, this.frontier.list());
      }
    }

    return current;
  }

  private buildPromotionCandidate(args: {
    readonly runId: string;
    readonly experimentId: string;
    readonly candidate: GeneratedCandidate;
    readonly pipelineId: string;
    readonly parentPromotionId?: string;
    readonly parentExecutionHash: string;
    readonly executionHash: string;
    readonly mutationChain: readonly MutationRecord[];
    readonly fitness: FitnessResult;
  }): PromotionCandidate {
    const pipelineDefinitionRef = `definition:${hashArtifactPayload(args.candidate.definition)}`;
    return {
      candidateId: args.experimentId,
      experimentId: args.experimentId,
      evolutionRunId: args.runId,
      humanId: `promotion-${args.experimentId}`,
      pipelineId: args.pipelineId,
      parentPromotionId: args.parentPromotionId,
      parentExecutionHash: args.parentExecutionHash,
      executionHash: args.executionHash,
      pipelineDefinitionRef,
      pipelineDefinition: args.candidate.definition,
      mutationChain: args.mutationChain,
      fitness: args.fitness,
      metadata: {},
    };
  }

  private writeApprovalRecord(
    evolutionRunId: string,
    subjectId: string,
    decision: ApprovalDecision,
  ): ApprovalRecord {
    return approvalRecordFromDecision({
      approvalId: subjectId,
      subjectId,
      evolutionRunId,
      gate: decision,
    });
  }

  private async sealApprovedPromotion(
    candidate: PromotionCandidate,
    approval: ApprovalRecord,
  ): Promise<PromotionArtifactV3> {
    return createPromotionArtifactV3Async(
      {
        humanId: candidate.humanId,
        pipelineId: candidate.pipelineId,
        parentPromotionId: candidate.parentPromotionId,
        parentExecutionHash: candidate.parentExecutionHash,
        executionHash: candidate.executionHash,
        pipelineDefinitionRef: candidate.pipelineDefinitionRef,
        mutationChain: candidate.mutationChain,
        fitness: candidate.fitness,
        promotedAt: Date.now(),
        sourceExperimentId: candidate.experimentId,
        evolutionRunId: candidate.evolutionRunId,
        approvalRecordId: approval.approvalId,
        schemaVersion: 'promotion.v3',
        runtimeFingerprint: candidate.runtimeFingerprint,
        policySnapshotRef: candidate.policySnapshotRef,
        metadata: candidate.metadata,
      },
      { signingKeyProvider: this.signingKeyProvider },
    );
  }

  private async filterFeasible(
    run: EvolutionRun,
    generation: number,
    candidates: readonly GeneratedCandidate[],
    constraintCtx: ConstraintContext,
  ): Promise<readonly FeasibleCandidate[]> {
    const feasible: FeasibleCandidate[] = [];

    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
      const candidate = candidates[candidateIndex];
      if (!candidate) continue;

      const violations = await this.constraintSolver.validate(candidate.definition, constraintCtx);
      if (violations.length === 0) {
        feasible.push({ candidate, candidateIndex });
        continue;
      }

      const experimentId = this.makeExperimentId(run.id, generation, candidateIndex);
      await this.recordRejectedExperiment(run, generation, experimentId, candidate.mutation, violations.map((v) => v.reason));
    }

    return feasible;
  }

  private async recordRejectedExperiment(
    run: EvolutionRun,
    generation: number,
    experimentId: string,
    mutation: MutationRecord,
    reasons: readonly string[],
  ): Promise<void> {
    const promotion: PromotionDecision = {
      promote: false,
      reasons,
      metricsDelta: { latency: 0, cost: 0, quality: 0, errorRate: 0 },
    };
    const record = this.withExperimentHash({
      id: experimentId,
      generation,
      experimentId: run.id,
      mutation,
      candidateExecutionHash: 'n/a',
      baselineExecutionHash: 'n/a',
      metricsCandidate: ZERO_METRICS,
      metricsBaseline: ZERO_METRICS,
      fitnessCandidate: REJECTED_FITNESS,
      fitnessBaseline: REJECTED_FITNESS,
      promotion,
      searchSpaceHash: run.searchSpaceHash,
      compilerVersion: run.compilerVersion,
      registryVersion: run.registryVersion,
      createdAt: Date.now(),
      schemaVersion: 'experiment.v1',
      evolutionRunId: run.id,
    });
    const artifactId = `experiment/${run.id}/${experimentId}`;

    await this.artifactStore.put(artifactId, record);
    await this.eventLedger.record({
      type: 'EXPERIMENT_RECORDED',
      runId: run.id,
      artifactId,
      payloadHash: record.artifactHash,
    });
  }

  private async recordExperiment(args: {
    readonly run: EvolutionRun;
    readonly generation: number;
    readonly experimentId: string;
    readonly mutation: MutationRecord;
    readonly candidateExecutionHash: string;
    readonly baselineExecutionHash: string;
    readonly evaluation: EvaluationResult;
    readonly promotionDecision: PromotionDecision;
  }): Promise<string> {
    const record = this.withExperimentHash({
      id: args.experimentId,
      generation: args.generation,
      experimentId: args.run.id,
      mutation: args.mutation,
      candidateExecutionHash: args.candidateExecutionHash,
      baselineExecutionHash: args.baselineExecutionHash,
      metricsCandidate: args.evaluation.metricsCandidate,
      metricsBaseline: args.evaluation.metricsBaseline,
      fitnessCandidate: args.evaluation.fitnessCandidate,
      fitnessBaseline: args.evaluation.fitnessBaseline,
      promotion: args.promotionDecision,
      searchSpaceHash: args.run.searchSpaceHash,
      compilerVersion: args.run.compilerVersion,
      registryVersion: args.run.registryVersion,
      createdAt: Date.now(),
      schemaVersion: 'experiment.v1',
      evolutionRunId: args.run.id,
    });
    const artifactId = `experiment/${args.run.id}/${args.experimentId}`;

    await this.artifactStore.put(artifactId, record);
    await this.eventLedger.record({
      type: 'EXPERIMENT_RECORDED',
      runId: args.run.id,
      artifactId,
      payloadHash: record.artifactHash,
    });

    return artifactId;
  }

  private withExperimentHash(record: Omit<ExperimentRecord, 'artifactHash'>): ExperimentRecord {
    return {
      ...record,
      artifactHash: hashArtifact(record),
    };
  }

  private toFrontierCandidate(
    experimentId: string,
    artifactId: string,
    executionHash: string,
    evaluation: EvaluationResult,
  ): FrontierCandidate {
    return {
      id: experimentId,
      executionHash,
      artifactId,
      objectives: {
        quality: evaluation.metricsCandidate.qualityScore,
        latency: evaluation.metricsCandidate.latencyMs,
        cost: evaluation.metricsCandidate.costSek,
        error: evaluation.metricsCandidate.errorRate,
      },
      fitness: evaluation.fitnessCandidate.fitness,
      sourceExperimentId: experimentId,
    };
  }

  private makeExperimentId(runId: string, generation: number, candidateIndex: number): string {
    return `${runId}-g${generation.toString().padStart(3, '0')}-c${candidateIndex.toString().padStart(3, '0')}`;
  }
}
