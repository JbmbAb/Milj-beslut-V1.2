import type { AgentFinding, AgentHandoff, AgentResult } from '@miljobeslut/mps-control-plane';
import type { KnowledgeRunResult } from './types';

export class KnowledgeHandoffCodecError extends Error {}

const VALID_RESULTS: readonly AgentResult[] = [
  'PASS',
  'FAIL',
  'BLOCKED_ENVIRONMENT',
  'BLOCKED_DESIGN',
  'BLOCKED_DEPENDENCY',
  'DENIED_GOVERNANCE',
  'CANCELLED',
];

/**
 * Format-only translation of an already-decided Knowledge agent-run outcome
 * into the Control Plane's `AgentHandoff` shape.
 *
 * This function MUST NOT gain any branch that derives, infers, or overrides
 * `result` from anything else in `run` (exit code, finding severities,
 * artifact contents, ...). The one authority boundary this whole integration
 * exists to protect is that Control Plane never becomes a second place that
 * decides what counts as a Knowledge PASS -- it only ever receives one that
 * an already-governed Knowledge run already decided. `run.outcome` is
 * type-checked against the same closed `AgentResult` union `AgentHandoff`
 * itself uses, so there is nothing here to compute: only copy and validate
 * shape.
 */
export function toAgentHandoff(run: KnowledgeRunResult): AgentHandoff {
  if (!run || typeof run !== 'object') {
    throw new KnowledgeHandoffCodecError('run result must be an object');
  }
  if (!VALID_RESULTS.includes(run.outcome)) {
    throw new KnowledgeHandoffCodecError(`run result carries an unrecognized outcome: ${String(run.outcome)}`);
  }
  if (run.role !== 'IMPLEMENTER' && run.role !== 'VERIFIER') {
    throw new KnowledgeHandoffCodecError(`run result carries an unsupported role: ${String(run.role)}`);
  }
  if (typeof run.agentRunId !== 'string' || run.agentRunId.length === 0) {
    throw new KnowledgeHandoffCodecError('run result is missing a non-empty agentRunId');
  }
  if (run.role === 'VERIFIER' && run.outcome === 'PASS' && run.verifierIndependent !== true) {
    // Not an invented rule: this exactly mirrors StateMachine.applyVerifiedHandoff's own
    // requirement. Refusing here fails closed before a doomed handoff is ever dispatched,
    // rather than letting the Control Plane reject it for a reason this codec could see coming.
    throw new KnowledgeHandoffCodecError(
      'a VERIFIER PASS run result must set verifierIndependent: true',
    );
  }

  const findings: readonly AgentFinding[] = run.findings.map((finding) => ({
    id: finding.id,
    severity: finding.severity,
    classification: finding.classification,
    message: finding.message,
  }));

  return {
    agentRunId: run.agentRunId,
    unitId: run.unitId,
    role: run.role,
    inputState: run.inputState,
    observedBaseSha: run.observedBaseSha,
    observedCandidateSha: run.observedCandidateSha,
    unitDefinitionHash: run.unitDefinitionHash,
    proofContractHash: run.proofContractHash,
    result: run.outcome,
    verifierIndependent: run.verifierIndependent,
    findings,
    outputArtifacts: [...run.outputArtifacts],
    requestedNextAction: run.requestedNextAction,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}
