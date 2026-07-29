import {
  CapabilityResolutionPass,
  PipelineCompiler,
  PolicyResolutionPass,
  type CapabilityImplementation,
  type CompilationResult,
  type ExecutionPolicy,
  type PipelineDefinition,
} from '../compiler';
import type { EvaluationEngine, EvaluationResult } from './EvaluationEngine';
import { FitnessEngine } from './FitnessEngine';
import { BatchShadowEvaluator } from './BatchShadowEvaluator';

export type DefaultEvaluationEngineOptions = {
  readonly implementations?: readonly CapabilityImplementation[];
  readonly policies?: readonly ExecutionPolicy[];
  readonly shadow?: BatchShadowEvaluator;
  readonly fitness?: FitnessEngine;
};

/**
 * Concrete EvaluationEngine: compile via PipelineCompiler, shadow via BatchShadowEvaluator.
 */
export class DefaultEvaluationEngine implements EvaluationEngine {
  private readonly compiler: PipelineCompiler;
  private readonly shadow: BatchShadowEvaluator;
  private readonly fitness: FitnessEngine;

  constructor(options: DefaultEvaluationEngineOptions = {}) {
    const implementations = options.implementations ?? DEFAULT_IMPLEMENTATIONS;
    const policies = options.policies ?? DEFAULT_POLICIES;
    this.compiler = new PipelineCompiler(
      new CapabilityResolutionPass(implementations),
      new PolicyResolutionPass(policies),
    );
    this.shadow = options.shadow ?? new BatchShadowEvaluator();
    this.fitness = options.fitness ?? new FitnessEngine();
  }

  compile(definition: PipelineDefinition): Promise<CompilationResult> {
    return this.compiler.compile(definition);
  }

  async evaluateBatch(
    candidates: readonly CompilationResult[],
    baseline: CompilationResult,
  ): Promise<readonly EvaluationResult[]> {
    const shadows = await this.shadow.evaluateBatch(candidates, baseline);
    return shadows.map((shadow) => ({
      metricsCandidate: shadow.metricsCandidate,
      metricsBaseline: shadow.metricsBaseline,
      fitnessCandidate: this.fitness.score(shadow.metricsCandidate),
      fitnessBaseline: this.fitness.score(shadow.metricsBaseline),
    }));
  }
}

const DEFAULT_IMPLEMENTATIONS: CapabilityImplementation[] = [
  {
    id: 'impl-vector-search',
    capabilityId: 'vector_search',
    version: '1.0.0',
    runtimeProfile: 'cpu',
  },
  {
    id: 'impl-reranker',
    capabilityId: 'reranker',
    version: '1.0.0',
    runtimeProfile: 'cpu',
  },
  {
    id: 'impl-retrieve',
    capabilityId: 'retrieve',
    version: '1.0.0',
    runtimeProfile: 'cpu',
  },
];

/** Policy.name must equal node.capability (compiler contract). */
const DEFAULT_POLICIES: ExecutionPolicy[] = [
  { id: 'pol-vector-search', name: 'vector_search', config: {} },
  { id: 'pol-reranker', name: 'reranker', config: {} },
  { id: 'pol-retrieve', name: 'retrieve', config: {} },
];
