import type { ContentReference } from "@miljobeslut/mps-evolution";
import type { SpatialEvidenceArtifact } from "../artifacts/SpatialEvidenceArtifact.js";
import type { AssessmentFinding } from "../domain/AssessmentFinding.js";
import { LURuleEngine } from "../rules/LURuleEngine.js";
import {
  ExecutionKernel,
  sha256ContentHash,
  type CapabilityExecutorPort,
} from "../../../mps-runtime/src/kernel/ExecutionKernel.js";
import { FrozenAdmissionAdapter } from "../../../mps-runtime/src/kernel/FrozenAdmissionAdapter.js";
import { createKernelArtifactRepository } from "../../../mps-runtime/src/repository/createKernelArtifactRepository.js";
import { DefaultReplayEngine } from "../../../mps-runtime/src/replay/DefaultReplayEngine.js";
import type { FrozenExecutionManifestIdentity } from "../../../mps-runtime/src/contracts/freeze/FrozenIdentities.js";
import type { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference.js";
import type { RuntimeState } from "../../../mps-runtime/src/kernel/RuntimeState.js";
import {
  LU_REGISTRY_SNAPSHOT,
  LU_SITE_ASSESSMENT_CAPABILITY_KEY,
} from "../registry/LuSiteAssessmentRegistry.js";
import {
  createExecutionSession,
  appendAttemptToSession,
  bindOutcomeToSession,
  type ExecutionSession,
} from "../../../mps-runtime/src/contracts/model/index.js";

/**
 * Domain registers LURuleEngine as an invoke handler — kernel never imports it.
 */
export function createLuRuleEngineInvokeHandler(
  evidence: SpatialEvidenceArtifact[],
): (inputs: readonly ContentReference[]) => Promise<readonly ContentReference[]> {
  return async () => {
    const engine = new LURuleEngine();
    const findings = engine.evaluate(evidence);
    return findings.map((f: AssessmentFinding) => ({
      artifact_id: f.finding_id,
    }));
  };
}

export interface LuKernelRunInput {
  readonly site_id: string;
  readonly deterministic_seed: string;
  readonly evidence: SpatialEvidenceArtifact[];
}

export interface LuKernelRunResult {
  readonly admitted: boolean;
  readonly reason_codes: readonly string[];
  readonly finding_ids: readonly string[];
  readonly findings: readonly AssessmentFinding[];
  readonly attempt_id: string | null;
  readonly outcome_id: string | null;
  readonly manifest_id: string;
  /** Execution Contracts & Model — correlates ticket/attempt/outcome/replay. */
  readonly session: ExecutionSession | null;
}

/**
 * LU as ExecutionKernel client — admit → capability invoke → findings.
 * This is the only product assessment path (LU cutover complete).
 * Artifacts persist via Mimers CAS; memory only under test / LU_MPS_CAS=memory.
 *
 * LURuleEngine runs only as the capability invoke handler — never outside Admission.
 */
export async function runLuAssessmentViaKernel(
  input: LuKernelRunInput,
): Promise<LuKernelRunResult> {
  const repo = await createKernelArtifactRepository();
  const engine = new LURuleEngine();
  let findings: AssessmentFinding[] = [];

  const handlers = new Map<
    string,
    (inputs: readonly ContentReference[]) => Promise<readonly ContentReference[]>
  >();
  handlers.set(`lu-rule-engine:${input.site_id}`, async () => {
    findings = engine.evaluate(input.evidence);
    return findings.map((f) => ({ artifact_id: f.finding_id }));
  });

  const capabilityExecutor: CapabilityExecutorPort = {
    async execute(args: {
      capability_ref: ArtifactReference;
      input_refs: readonly ArtifactReference[];
      state: RuntimeState;
    }) {
      const handler = handlers.get(`lu-rule-engine:${input.site_id}`);
      if (!handler) {
        throw new Error("LU rule handler not registered");
      }
      const outputs = await handler(
        args.input_refs.map((r) => ({ artifact_id: r.artifact_id })),
      );
      const payload = {
        capability: args.capability_ref.artifact_id,
        outputs: outputs.map((o) => o.artifact_id),
      };
      const content_hash = sha256ContentHash(payload);
      return {
        artifact_id: `exec-lu-${input.site_id}-${content_hash.value.slice(0, 12)}`,
        artifact_type: "CAPABILITY_EXECUTION",
        capability_ref: args.capability_ref,
        input_refs: args.input_refs,
        output_refs: outputs.map((o) => ({
          artifact_id: o.artifact_id,
          artifact_type: "localization_assessment" as const,
        })),
        content_hash,
      };
    },
  };

  const kernel = new ExecutionKernel({
    admission: new FrozenAdmissionAdapter(null, true),
    capabilityExecutor,
    artifactRepository: repo,
    replayEngine: new DefaultReplayEngine(repo),
    registrySnapshot: {
      snapshot_id: LU_REGISTRY_SNAPSHOT.snapshot_id,
      registry_hash: LU_REGISTRY_SNAPSHOT.registry_hash.value,
    },
    nowIso: () => input.deterministic_seed,
  });

  const manifest: FrozenExecutionManifestIdentity = {
    manifest_id: `lu-manifest-${input.site_id}`,
    artifact_type: "execution_manifest",
    execution_identity_ref: {
      artifact_id: `lu-identity-${input.site_id}`,
      artifact_type: "execution_identity",
    },
    capability_resolution_ref: {
      artifact_id: `lu-cap-resolution-${input.site_id}`,
      artifact_type: "capability_resolution",
    },
    parameters: { deterministic_seed: input.deterministic_seed, site_id: input.site_id },
    content_hash: sha256ContentHash({
      site_id: input.site_id,
      seed: input.deterministic_seed,
    }),
  };

  await repo.put({
    artifact_id: LU_REGISTRY_SNAPSHOT.snapshot_id,
    content_hash: LU_REGISTRY_SNAPSHOT.content_hash,
    body: {
      ...LU_REGISTRY_SNAPSHOT,
      capability_key: LU_SITE_ASSESSMENT_CAPABILITY_KEY,
    },
  });

  await repo.put({
    artifact_id: manifest.manifest_id,
    content_hash: manifest.content_hash,
    body: manifest,
  });

  const result = await kernel.execute(manifest);
  const admitted = result.admission.decision === "admitted";
  const finding_ids =
    result.capability_executions[0]?.output_refs.map((r) => r.artifact_id) ?? [];

  let session: ExecutionSession | null = null;
  if (admitted) {
    session = createExecutionSession({
      session_id: `session-${manifest.manifest_id}`,
      manifest_ref: {
        artifact_id: manifest.manifest_id,
        artifact_type: "execution_manifest",
      },
    });
    if (result.attempt) {
      session = appendAttemptToSession(session, {
        artifact_id: result.attempt.attempt_id,
        artifact_type: "execution_attempt",
      });
    }
    if (result.outcome) {
      session = bindOutcomeToSession(session, {
        artifact_id: result.outcome.outcome_id,
        artifact_type: "execution_outcome",
      });
    }
    await repo.put({
      artifact_id: session.session_id,
      content_hash: session.content_hash,
      body: session,
    });
  }

  return {
    admitted,
    reason_codes: result.admission.reason_codes,
    finding_ids,
    findings: admitted ? findings : [],
    attempt_id: result.attempt?.attempt_id ?? null,
    outcome_id: result.outcome?.outcome_id ?? null,
    manifest_id: manifest.manifest_id,
    session,
  };
}
