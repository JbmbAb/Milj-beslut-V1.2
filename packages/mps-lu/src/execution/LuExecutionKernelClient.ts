import type { ContentReference } from "@miljobeslut/mps-evolution";
import type { SpatialEvidenceArtifact } from "../artifacts/SpatialEvidenceArtifact.js";
import type { DocumentEvidenceArtifact } from "../artifacts/DocumentEvidenceArtifact.js";
import type { AssessmentFinding } from "../domain/AssessmentFinding.js";
import type {
  LocalizationAssessmentArtifact,
  LocalizationAssessmentDraft,
} from "../artifacts/LocalizationAssessmentArtifact.js";
import {
  createGovernedLocalizationAssessment,
  GovernedAssessmentPersistence,
} from "../governance/GovernedAssessmentPersistence.js";
import type { VerifiedDocumentFactArtifact } from "../../../mps-data-governance/src/DocumentFactArtifact.js";
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
import type { RuntimeState } from "../../../mps-runtime/src/kernel/RuntimeState.js";
import type { OutcomeAttestation } from "../../../mps-runtime/src/security/index.js";
import { createLuRegistryRuntime } from "../registry/createLuRegistryRuntime.js";
import { LU_SITE_ASSESSMENT_CAPABILITY_KEY } from "../registry/LuSiteAssessmentRegistry.js";
import type { ExecutionIdentityArtifact } from "../../../mps-runtime/src/execution/ExecutionIdentityArtifact.js";
import type { FrozenCoreVerificationContext } from "../../../mps-compliance/src/conformance/FrozenCoreVerificationContext.js";
import { RuleRegistrySnapshot } from "../../../mps-compliance/src/conformance/RuleRegistrySnapshot.js";
import { CAP_26_I1 } from "../../../mps-compliance/src/validators/CAP_26_I1.js";
import { buildExecutionIdentityAttestationPredicate } from "./ExecutionIdentityAttestation.js";
import { preVerifyExecutionIdentityForAdmission } from "./LuAdmissionPreVerification.js";
import { getLuExecutionAuthorityVerifier } from "./LuExecutionAuthorityVerifier.js";
import { getLuExecutionAuthorityRootVerifier } from "./LuExecutionAuthorityVerifier.js";
import { LU_EXECUTION_AUTHORITY_ISSUER_TYPE } from "../artifacts/LuExecutionAuthorityArtifact.js";
import { verifyLuExecutionAuthorityChain } from "./LuExecutionAuthorityChain.js";

/** LU reference principal — domain composition root identity binding. */
export const LU_EXECUTION_PRINCIPAL_ID = "lu.site_assessment.actor" as const;

/**
 * Domain registers LURuleEngine as an invoke handler — kernel never imports it.
 */
export function createLuRuleEngineInvokeHandler(
  evidence: SpatialEvidenceArtifact[],
  documentEvidence: readonly DocumentEvidenceArtifact[] = [],
  verifiedDocumentFacts: readonly VerifiedDocumentFactArtifact[] = [],
): (inputs: readonly ContentReference[]) => Promise<readonly ContentReference[]> {
  return async () => {
    const engine = new LURuleEngine();
    const findings = engine.evaluate({
      spatial_evidence: evidence,
      document_evidence: documentEvidence,
      verified_document_facts: verifiedDocumentFacts,
    });
    return findings.map((f: AssessmentFinding) => ({
      artifact_id: f.finding_id,
    }));
  };
}

export interface LuKernelRunInput {
  readonly site_id: string;
  readonly deterministic_seed: string;
  readonly evidence: SpatialEvidenceArtifact[];
  /**
   * F4A: document evidence is now transported to the rule engine. Optional so existing
   * spatial-only callers are unaffected; normalized to `[]` at the evaluation boundary.
   */
  readonly document_evidence?: readonly DocumentEvidenceArtifact[];
  /**
   * F4B: the resolved Tier 3 facts the document evidence references. Transported on BOTH kernel
   * entrypoints deliberately — F4A's defect (cause A) was that only one path carried document
   * evidence, which made the outcome depend on which path executed. Repeating that asymmetry
   * here would reproduce the same class of defect one layer up.
   */
  readonly verified_document_facts?: readonly VerifiedDocumentFactArtifact[];
  /** HM1-C: semantic inputs for an assessment created only after governed execution succeeds. */
  readonly assessment_draft?: LocalizationAssessmentDraft;
  /** Composition-root repository; production passes the same canonical repository as providers. */
  readonly artifact_repository?: import("../../../mps-runtime/src/kernel/ExecutionKernel.js").ArtifactRepositoryPort;
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
  /**
   * F9 — the kernel's RuntimeState for this run.
   *
   * `ExecutionKernel.execute()` has always produced this and set `state.attempt` on the admitted
   * path; this client simply never surfaced it. Replay takes `RuntimeState` as its second
   * argument, so dropping it here made `DefaultReplayEngine.replay()` unreachable through the
   * only product assessment path — it failed with "Replay requires attempt on RuntimeState".
   *
   * Returned unconditionally, including on denial. State is the record of what happened, and a
   * denied run has a state worth inspecting (admission populated, attempt null).
   */
  readonly state: RuntimeState;
  /** Execution Contracts & Model — correlates ticket/attempt/outcome/replay. */
  readonly session: ExecutionSession | null;
  /** Outcome attestation from SecurityRuntime (null if denied). */
  readonly attestation: OutcomeAttestation | null;
  /** HM1-C: persisted only after outcome/attestation/hash verification. */
  readonly assessment: LocalizationAssessmentArtifact | null;
}

/**
 * RC8-K — LU admission boundary.
 *
 * SecurityRuntime documents bootstrapAdmit as an explicit opt-in for when a real FrozenCore
 * verification context is absent (composition-root / tests); production should leave it false.
 * This client previously hardcoded `bootstrapAdmit: true` unconditionally, so the one production
 * LU assessment path always self-admitted regardless of whether any real governed admission
 * existed -- an environment classification (which callers happen to run under Vitest) is not a
 * security authority. A real production FrozenCoreVerificationContext is not wired yet (that is
 * separate, larger work); until it is, admission MUST fail closed rather than silently succeed.
 *
 * Bootstrap admission is now reachable only via an explicit capability flag, never implicitly.
 */
function isLuBootstrapAdmitAllowed(): boolean {
  return process.env.MPS_LU_BOOTSTRAP_ADMIT === '1';
}

/**
 * PROD-LU-ADMISSION-02D — wraps a (possibly empty) synchronous ArtifactResolver into the full
 * context RuntimeAdmissionKernel needs. matrixResolver/canonicalSerializer are confirmed unused
 * on this execution path (only FrozenCoreVerifier reads them, which RuntimeAdmissionKernel
 * never calls) -- minimal stubs.
 */
function buildAdmissionContext(
  artifactResolver: FrozenCoreVerificationContext["artifactResolver"],
): FrozenCoreVerificationContext {
  return {
    artifactResolver,
    matrixResolver: { resolve: () => undefined },
    ruleRegistry: new RuleRegistrySnapshot([CAP_26_I1]),
    canonicalSerializer: {
      serialize: () => ({ bytes: new Uint8Array(), encoding: "identity" }),
    } as FrozenCoreVerificationContext["canonicalSerializer"],
  };
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
  const repo = input.artifact_repository ?? (await MimersIntegration.create()).artifactRepository;
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
        findings = engine.evaluate({
          spatial_evidence: input.evidence,
          document_evidence: input.document_evidence ?? [],
          verified_document_facts: input.verified_document_facts ?? [],
        });
        return findings.map((f) => ({ artifact_id: f.finding_id }));
      },
    ],
  ]);

  const capabilityRuntime = CapabilityRuntime.create({ registry, handlers });

  // PROD-LU-ADMISSION-02D: this deterministic ref names WHICH identity a valid prior issuance
  // would have been persisted under (see LuExecutionIdentityIssuer.ts) -- it is not, itself, an
  // identity. This module never constructs or signs one.
  const executionIdentityRef = {
    artifact_id: `lu-identity-${input.site_id}`,
    artifact_type: "execution_identity" as const,
  };

  const bootstrap = isLuBootstrapAdmitAllowed();
  let verificationContext: FrozenCoreVerificationContext | null = null;

  if (!bootstrap) {
    // PROD-LU-ADMISSION-02D: consume-only. If an authority-issued identity was explicitly
    // provisioned ahead of this run (LuExecutionIdentityIssuer.issueExecutionIdentity, called by
    // something other than this function), resolve and cryptographically pre-verify it. If none
    // exists, this module does NOT mint one itself -- that would just be self-issuance wearing a
    // different file name, which PROD-LU-ADMISSION-01C already proved is not a real trust
    // boundary. No prior issuance means the synchronous resolver simply never contains an
    // identity, and RuntimeAdmissionKernel denies on its own existing "Invalid or missing
    // Execution Identity" check -- no new trust is placed in this function to report that
    // correctly.
    let resolvedIdentity: ExecutionIdentityArtifact | null = null;
    try {
      resolvedIdentity = await repo.resolve<ExecutionIdentityArtifact>(executionIdentityRef);
    } catch {
      resolvedIdentity = null;
    }

    const rootAuthorityConfigured = Boolean(
      process.env.LU_EXECUTION_AUTHORITY_ROOT_KEY_ID &&
      process.env.LU_EXECUTION_AUTHORITY_ROOT_PUBLIC_KEY_PEM,
    );
    if (resolvedIdentity && rootAuthorityConfigured) {
      const issuerRef = resolvedIdentity.references.find((reference) => reference.artifact_type === LU_EXECUTION_AUTHORITY_ISSUER_TYPE);
      if (!issuerRef) {
        resolvedIdentity = null;
      } else {
        try {
          await verifyLuExecutionAuthorityChain({
            issuerRef,
            repository: repo,
            rootVerification: getLuExecutionAuthorityRootVerifier(),
            issuerVerification: getLuExecutionAuthorityVerifier(),
          });
        } catch {
          resolvedIdentity = null;
        }
      }
    }

    if (resolvedIdentity) {
      const expectedPredicate = buildExecutionIdentityAttestationPredicate({
        execution_identity_id: resolvedIdentity.artifact_id,
        actor_ref: resolvedIdentity.actor_ref,
        capability_ref: resolvedIdentity.capability_ref,
        release_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
        site_id: input.site_id,
        deterministic_seed: input.deterministic_seed,
      });
      const { artifactResolver } = await preVerifyExecutionIdentityForAdmission({
        identity: resolvedIdentity,
        capabilityArtifact: capability,
        resolveAttestation: async (ref) => {
          try {
            return await repo.resolve(ref);
          } catch {
            return null;
          }
        },
        expectedPredicate,
        authorityVerifier: getLuExecutionAuthorityVerifier(),
      });
      verificationContext = buildAdmissionContext(artifactResolver);
    } else {
      verificationContext = buildAdmissionContext({
        resolve: (ref) =>
          ref.artifact_id === capability.artifact_id && ref.artifact_type === capability.artifact_type
            ? capability
            : undefined,
      });
    }
  }

  const security = SecurityRuntime.create({
    bootstrapAdmit: bootstrap,
    verificationContext,
    bindSeed: input.deterministic_seed,
    grants: [
      {
        principal_id: LU_EXECUTION_PRINCIPAL_ID,
        capability_id: capability.artifact_id,
      },
    ],
  });
  security.bindPrincipal(LU_EXECUTION_PRINCIPAL_ID, executionIdentityRef);

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
    execution_identity_ref: executionIdentityRef,
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
  let assessment: LocalizationAssessmentArtifact | null = null;
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
      if (input.assessment_draft) {
        assessment = createGovernedLocalizationAssessment({
          draft: input.assessment_draft,
          findings,
          outcome: result.outcome,
          attestation,
        });
        await new GovernedAssessmentPersistence(
          repo,
          (candidate) => security.verifyAttestation(candidate),
        ).persist({ artifact: assessment, outcome: result.outcome, attestation });
      }
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
    state: result.state,
    session,
    attestation,
    assessment,
  };
}
