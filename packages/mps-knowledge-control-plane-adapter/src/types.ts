import type {
  AgentOutputArtifact,
  AgentResult,
  FindingClassification,
  MultiAgentState,
} from '@miljobeslut/mps-control-plane';

/**
 * Structural subset of a `dev-gov-v1-unit-definition` document (see
 * governance/devgov/schema/dev-gov-v1-unit-definition.schema.json) that this
 * adapter needs. Deliberately loose (`readonly [key: string]: unknown`) so it
 * accepts the real, richer JSON without this package having to track every
 * field DEV-GOV's own schema owns -- this package reads the unit definition,
 * it never re-defines what one is.
 */
export interface KnowledgeUnitDefinitionLike {
  readonly schema_version: string;
  readonly unit: string;
  readonly base_sha: string;
  readonly branch: string;
  readonly allowed_paths: readonly string[];
  readonly [key: string]: unknown;
}

/**
 * The already-computed outcome of one Knowledge implementer or verifier
 * agent run (a vitest suite, a DEV-GOV local diagnostic, etc). Every field
 * that determines PASS/FAIL/blocked semantics is supplied by the caller --
 * this shape exists so `toAgentHandoff` has something format-only to copy,
 * never something to (re)compute.
 */
export interface KnowledgeRunResult {
  readonly agentRunId: string;
  readonly unitId: string;
  readonly role: 'IMPLEMENTER' | 'VERIFIER';
  readonly inputState: MultiAgentState;
  readonly observedBaseSha: string;
  readonly observedCandidateSha?: string;
  readonly unitDefinitionHash: string;
  readonly proofContractHash: string;
  /** Required, and only ever true when the runner is a role/holder distinct from the implementer. */
  readonly verifierIndependent?: boolean;
  /** The Knowledge run's own, already-decided verdict. Never inferred by this package. */
  readonly outcome: AgentResult;
  readonly findings: readonly KnowledgeFindingInput[];
  readonly outputArtifacts: readonly AgentOutputArtifact[];
  readonly requestedNextAction?: string;
  readonly startedAt: string;
  readonly finishedAt: string;
}

export interface KnowledgeFindingInput {
  readonly id: string;
  readonly severity: 'BLOCKING' | 'NON_BLOCKING';
  readonly classification: FindingClassification;
  readonly message: string;
}
