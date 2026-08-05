import type { ContentReference } from "@miljobeslut/mps-evolution";
import type { SpatialEvidenceArtifact } from "../artifacts/SpatialEvidenceArtifact.js";
import type { AssessmentFinding } from "../domain/AssessmentFinding.js";
import { LURuleEngine } from "../rules/LURuleEngine.js";
import {
  ExecutionKernel,
  sha256ContentHash,
} from "../../../mps-runtime/src/kernel/ExecutionKernel.js";
import { MimersIntegration } from "../../../mps-runtime/src/mimers/index.js";
import { CapabilityRuntime } from "../../../mps-runtime/src/capability/index.js";
import { SecurityRuntime } from "../../../mps-runtime/src/security/index.js";
import { DefaultReplayEngine } from "../../../mps-runtime/src/replay/DefaultReplayEngine.js";
import type { FrozenExecutionManifestIdentity } from "../../../mps-runtime/src/contracts/freeze/FrozenIdentities.js";
import {
  createExecutionSession,
  appendAttemptToSession,
  bindOutcomeToSession,
  type ExecutionSession,
} from "../../../mps-runtime/src/contracts/model/index.js";
import type { RegistryRuntime } from "../../../mps-runtime/src/registry/index.js";
import type { OutcomeAttestation } from "../../../mps-runtime/src/security/index.js";
import { createLuRegistryRuntime } from "../registry/createLuRegistryRuntime.js";
import { LU_SITE_ASSESSMENT_CAPABILITY_KEY } from "../registry/LuSiteAssessmentRegistry.js";

/** LU reference principal — domain composition root identity binding. */
export const LU_EXECUTION_PRINCIPAL_ID = "lu.site_assessment.actor" as const;

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
  /** Optional injected registry (tests); defaults to LU release seed. */
  readonly registry?: RegistryRuntime;
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
  /** Outcome attestation from SecurityRuntime (null if denied). */
  readonly attestation: OutcomeAttestation | null;
}

/**
 * LU as ExecutionKernel client — Security → admit → CapabilityRuntime → findings.
 * This is the only product assessment path (LU cutover complete).
 *
 * Domain composition root: registry seed + grants + implementation handlers.
 * Platform: MimersIntegration + SecurityRuntime + CapabilityRuntime + ExecutionKernel.
 */
export async function runLuAssessmentViaKernel(
  input: LuKernelRunInput,
): Promise<LuKernelRunResult> {
  const mimers = await MimersIntegration.create();
  const repo = mimers.artifactRepository;
  const registry = input.registry ?? createLuRegistryRuntime();
  const capability = registry.resolveCapabilityByKey(LU_SITE_ASSESSMENT_CAPABILITY_KEY);
  if (!capability) {
    throw new Error(
      `LU capability not registered: ${LU_SITE_ASSESSMENT_CAPABILITY_KEY}`,
    );
  }

  const engine = new LURuleEngine();
  let findings: AssessmentFinding[] = [];

  const handlers = new Map([
    [
      capability.implementation_ref.artifact_id,
      async () => {
        findings = engine.evaluate(input.evidence);
        return findings.map((f) => ({ artifact_id: f.finding_id }));
      },
    ],
  ]);

  const capabilityRuntime = CapabilityRuntime.create({ registry, handlers });

  const security = SecurityRuntime.create({
    bootstrapAdmit: true,
    bindSeed: input.deterministic_seed,
    grants: [
      {
        principal_id: LU_EXECUTION_PRINCIPAL_ID,
        capability_id: capability.artifact_id,
      },
    ],
  });
  security.bindPrincipal(LU_EXECUTION_PRINCIPAL_ID, {
    artifact_id: `lu-identity-${input.site_id}`,
    artifact_type: "execution_identity",
  });

  const snapshot = registry.getReleaseSnapshot();
  const kernel = new ExecutionKernel({
    admission: security.asAdmissionPort(),
    capabilityExecutor: security.asAuthorizedExecutorPort(
      capabilityRuntime.asExecutorPort(),
    ),
    artifactRepository: repo,
    replayEngine: new DefaultReplayEngine(repo),
    registrySnapshot: registry.toSnapshotView(),
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
      artifact_id: capability.artifact_id,
      artifact_type: "CAPABILITY_DEFINITION",
    },
    parameters: { deterministic_seed: input.deterministic_seed, site_id: input.site_id },
    content_hash: sha256ContentHash({
      site_id: input.site_id,
      seed: input.deterministic_seed,
    }),
  };

  await repo.put({
    artifact_id: snapshot.snapshot_id,
    content_hash: snapshot.content_hash,
    body: {
      ...snapshot,
      capability_key: capability.capability_key,
    },
  });

  await repo.put({
    artifact_id: capability.artifact_id,
    content_hash: sha256ContentHash(capability),
    body: capability,
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
  let attestation: OutcomeAttestation | null = null;
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
      attestation = security.attestOutcome(result.outcome.content_hash);
      await repo.put({
        artifact_id: attestation.attestation_id,
        content_hash: attestation.content_hash,
        body: attestation,
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
    attestation,
  };
}
