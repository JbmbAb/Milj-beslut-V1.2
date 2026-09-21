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
import {
  computeExecutionIdentityArtifactIdV1,
  computeExecutionIdentityArtifactIdV2,
  computeExecutionIdentityArtifactIdV3,
  computeExecutionManifestIdV2,
  computeExecutionManifestIdV3,
  type ExecutionIdentitySubjectV2,
  type ExecutionIdentitySubjectV3,
} from "../../../mps-runtime/src/execution/ExecutionIdentityScopeV2.js";
import type { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference.js";
import type { FrozenCoreVerificationContext } from "../../../mps-compliance/src/conformance/FrozenCoreVerificationContext.js";
import { RuleRegistrySnapshot } from "../../../mps-compliance/src/conformance/RuleRegistrySnapshot.js";
import { CAP_26_I1 } from "../../../mps-compliance/src/validators/CAP_26_I1.js";
import { buildExecutionIdentityAttestationPredicate } from "./ExecutionIdentityAttestation.js";
import { preVerifyExecutionIdentityForAdmission } from "./LuAdmissionPreVerification.js";
import { getLuExecutionAuthorityVerifier } from "./LuExecutionAuthorityVerifier.js";
import { getLuExecutionAuthorityRootVerifier } from "./LuExecutionAuthorityVerifier.js";
import { LU_EXECUTION_AUTHORITY_ISSUER_TYPE } from "../artifacts/LuExecutionAuthorityArtifact.js";
import { verifyLuExecutionAuthorityChain } from "./LuExecutionAuthorityChain.js";
import { verifyLuSourceAuthorityForAssessment } from "../governance/LuSourceAuthorityWiring.js";
import { LU_EXECUTION_PRINCIPAL_ID } from "./LuExecutionPrincipal.js";
export { LU_EXECUTION_PRINCIPAL_ID } from "./LuExecutionPrincipal.js";

/**
 * The single LU rule-evaluation construction point.
 *
 * Both governed kernel execution and deterministic re-execution reuse this internal evaluator,
 * so no second module can construct LURuleEngine or grow independent rule semantics.
 */
export function evaluateLuRuleSet(
  evidence: SpatialEvidenceArtifact[],
  documentEvidence: readonly DocumentEvidenceArtifact[] = [],
  verifiedDocumentFacts: readonly VerifiedDocumentFactArtifact[] = [],
): AssessmentFinding[] {
  return new LURuleEngine().evaluate({
    spatial_evidence: evidence,
    document_evidence: documentEvidence,
    verified_document_facts: verifiedDocumentFacts,
  });
}

/**
 * Domain registers the canonical evaluator as an invoke handler — kernel never imports the rule engine.
 */
export function createLuRuleEngineInvokeHandler(
  evidence: SpatialEvidenceArtifact[],
  documentEvidence: readonly DocumentEvidenceArtifact[] = [],
  verifiedDocumentFacts: readonly VerifiedDocumentFactArtifact[] = [],
): (inputs: readonly ContentReference[]) => Promise<readonly ContentReference[]> {
  return async () =>
    evaluateLuRuleSet(evidence, documentEvidence, verifiedDocumentFacts).map(
      (f: AssessmentFinding) => ({ artifact_id: f.finding_id }),
    );
}

export interface LuKernelRunInput {
  readonly site_id: string;
  readonly deterministic_seed: string;
  /**
   * 04D-R1: source authority is bound only to deterministic execution semantics. The LU source
   * chain carries no signed temporal/currentness facts, so no wall-clock "decision time" is
   * accepted here or placed in the assessment hash domain.
   */
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
  /**
   * LU-EXECUTION-IDENTITY-SCOPE-V2. When provided, admission resolves the exact expected V2
   * ExecutionIdentity for this canonical execution subject (site_id + this) and refuses a legacy
   * V1 identity as a substitute, even if one exists for the same site_id. Omitted only by callers
   * still exercising the legacy V1 site-scoped path (existing tests / bootstrap admission);
   * current product issuance always supplies this.
   */
  readonly identity_subject_v2?: {
    readonly project_context_binding_ref: ArtifactReference;
    readonly product_release_ref: ArtifactReference;
    readonly execution_contract_version: string;
  };
  /**
   * PRODUCT-LU-LOCALIZATION-GEOMETRY-01. When provided (instead of / in addition to
   * `identity_subject_v2`), admission resolves the exact expected V3 ExecutionIdentity, scoped by
   * the localization point too -- a V2 identity (bound to the right property/binding/release but
   * no explicit point) never substitutes, and moving the point mints a distinct identity/manifest.
   * Mutually exclusive in effect with `identity_subject_v2`: when both are supplied, V3 wins.
   */
  readonly identity_subject_v3?: {
    readonly project_context_binding_ref: ArtifactReference;
    readonly product_release_ref: ArtifactReference;
    readonly execution_contract_version: string;
    readonly localization_geometry_ref: ArtifactReference;
  };
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
 *
 * ASSESSMENT-RELEASE-BINDING-RECON-01: this general engine still accepts `identity_subject_v2`/
 * `identity_subject_v3` as OPTIONAL, and still falls back to the non-release-scoped
 * `lu-manifest-${site_id}` id when neither is supplied (see LU-MANIFEST-WORM-IDEMPOTENCY-01
 * below) — that fallback is real and deliberately kept for legacy/test callers exercising the
 * pre-V2 identity shape. It is NOT, itself, the product entrypoint any more: the canonical live
 * product path must call `runCanonicalLuProductAssessment` below, whose type makes
 * `identity_subject_v3` mandatory, so a canonical caller omitting it is a compile error rather
 * than a silent runtime fallback. This function remains the general/legacy-capable engine both
 * that wrapper and every existing test call into directly.
 *
 * Domain composition root: registry seed + grants + implementation handlers.
 * Platform: MimersIntegration + SecurityRuntime + CapabilityRuntime + ExecutionKernel.
 */
export async function runLuAssessmentViaKernel(
  input: LuKernelRunInput,
): Promise<LuKernelRunResult> {
  return executeLuAssessment(input, isLuBootstrapAdmitAllowed());
}

/**
 * LU-CANONICAL-RUNTIME-HARDENING-R1: the engine body. Whether bootstrap admission is in force is an
 * explicit argument, decided once by the caller, so the canonical product path can pass `false`
 * without ever consulting ambient `process.env` again (no check-then-read window across the
 * `await`s below).
 */
async function executeLuAssessment(
  input: LuKernelRunInput,
  bootstrap: boolean,
): Promise<LuKernelRunResult> {
  const repo = input.artifact_repository ?? (await MimersIntegration.create()).artifactRepository;
  const registry = input.registry ?? createLuRegistryRuntime();
  const capability = registry.resolveCapabilityByKey(LU_SITE_ASSESSMENT_CAPABILITY_KEY);
  if (!capability) {
    throw new Error(
      `LU capability not registered: ${LU_SITE_ASSESSMENT_CAPABILITY_KEY}`,
    );
  }

  let findings: AssessmentFinding[] = [];

  const handlers = new Map([
    [
      capability.implementation_ref.artifact_id,
      async () => {
        findings = evaluateLuRuleSet(
          input.evidence,
          input.document_evidence ?? [],
          input.verified_document_facts ?? [],
        );
        return findings.map((f) => ({ artifact_id: f.finding_id }));
      },
    ],
  ]);

  const capabilityRuntime = CapabilityRuntime.create({ registry, handlers });

  // LU-EXECUTION-IDENTITY-SCOPE-V2: when identity_subject_v2 is supplied, the expected identity
  // is resolved from the FULL canonical execution subject, never from site_id alone -- a legacy
  // V1 identity existing for this site must never be silently substituted.
  const expectedSubjectV2: ExecutionIdentitySubjectV2 | null = input.identity_subject_v2
    ? { site_id: input.site_id, ...input.identity_subject_v2 }
    : null;

  // PRODUCT-LU-LOCALIZATION-GEOMETRY-01: same reasoning as expectedSubjectV2, plus the explicit
  // localization point as a fifth axis. Takes priority over expectedSubjectV2 when both are given.
  const expectedSubjectV3: ExecutionIdentitySubjectV3 | null = input.identity_subject_v3
    ? { site_id: input.site_id, ...input.identity_subject_v3 }
    : null;

  // PROD-LU-ADMISSION-02D: this deterministic ref names WHICH identity a valid prior issuance
  // would have been persisted under (see LuExecutionIdentityIssuer.ts) -- it is not, itself, an
  // identity. This module never constructs or signs one.
  const executionIdentityRef = {
    artifact_id: expectedSubjectV3
      ? computeExecutionIdentityArtifactIdV3(expectedSubjectV3)
      : expectedSubjectV2
      ? computeExecutionIdentityArtifactIdV2(expectedSubjectV2)
      : computeExecutionIdentityArtifactIdV1(input.site_id),
    artifact_type: "execution_identity" as const,
  };

  let verificationContext: FrozenCoreVerificationContext | null = null;
  let verifiedExecutionIdentity: ExecutionIdentityArtifact | null = null;

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
      const preVerification = await preVerifyExecutionIdentityForAdmission({
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
        expectedSubjectV2: expectedSubjectV2 ?? undefined,
        expectedSubjectV3: expectedSubjectV3 ?? undefined,
      });
      if (preVerification.result.verified) {
        verifiedExecutionIdentity = preVerification.result.identity;
      }
      verificationContext = buildAdmissionContext(preVerification.artifactResolver);
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

  // LU-MANIFEST-WORM-IDEMPOTENCY-01: manifest_id must scope by the same subject as
  // content_hash (which already varies with project_context_binding_ref / product_release_ref
  // via deriveLuExecutionSeed) -- site_id alone collapses legitimately distinct execution
  // subjects (e.g. across a binding supersession) onto one WORM slot. Falls back to the V1
  // site-only id only when no V2 subject was supplied (legacy/test callers).
  const manifest: FrozenExecutionManifestIdentity = {
    manifest_id: expectedSubjectV3
      ? computeExecutionManifestIdV3(expectedSubjectV3)
      : expectedSubjectV2
      ? computeExecutionManifestIdV2(expectedSubjectV2)
      : `lu-manifest-${input.site_id}`,
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
        const sourceAuthorityRequired =
          !bootstrap &&
          expectedSubjectV3 !== null;
        if (sourceAuthorityRequired && !verifiedExecutionIdentity) {
          throw new Error(
            "REJECT_LU_SOURCE_AUTHORITY: admitted canonical run has no verified execution identity",
          );
        }
        const sourceAuthority = sourceAuthorityRequired
          ? await verifyLuSourceAuthorityForAssessment({
              repository: repo,
              execution_identity: verifiedExecutionIdentity!,
              expected_subject_v3: expectedSubjectV3!,
              expected_capability_ref: {
                artifact_id: capability.artifact_id,
                artifact_type: capability.artifact_type,
              },
              release_snapshot_id: snapshot.snapshot_id,
              deterministic_seed: input.deterministic_seed,
            })
          : undefined;

        assessment = createGovernedLocalizationAssessment({
          draft: input.assessment_draft,
          findings,
          outcome: result.outcome,
          attestation,
          authority_evidence: sourceAuthority?.evidence,
        });
        await new GovernedAssessmentPersistence(
          repo,
          (candidate) => security.verifyAttestation(candidate),
          { requireAuthorityEvidence: sourceAuthorityRequired },
        ).persist({
          artifact: assessment,
          outcome: result.outcome,
          attestation,
          authority: sourceAuthority,
        });
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

/**
 * ASSESSMENT-RELEASE-BINDING-RECON-01 Phase B, part B.
 *
 * The canonical live product entrypoint. `identity_subject_v3` is REQUIRED at the type level —
 * not optional-but-conventionally-always-supplied — so a canonical product caller can never reach
 * `runLuAssessmentViaKernel`'s legacy `identity_subject_v2`-only or no-subject-at-all fallback
 * paths (`lu-manifest-${site_id}`, non-release-scoped) by omission. `identity_subject_v2` is
 * deliberately absent from this type entirely, not merely optional, for the same reason.
 *
 * Legacy/test callers that need the older shapes must call `runLuAssessmentViaKernel` directly,
 * which is an explicit, visible choice of a differently-named function — never an implicit
 * default reached by leaving a field off this one.
 */
export interface CanonicalLuKernelRunInput
  extends Omit<LuKernelRunInput, "identity_subject_v2" | "identity_subject_v3"> {
  readonly identity_subject_v3: NonNullable<LuKernelRunInput["identity_subject_v3"]>;
}

/**
 * LU-CANONICAL-RUNTIME-HARDENING-R1: a canonical product call violated a contract the type system
 * cannot enforce at runtime (untyped/JavaScript callers, `any`). `code` is stable and machine-read.
 */
export type LuCanonicalRuntimeContractErrorCode =
  | "LU_CANONICAL_BOOTSTRAP_ADMIT_FORBIDDEN"
  | "LU_CANONICAL_IDENTITY_SUBJECT_V3_INVALID";

export class LuCanonicalRuntimeContractError extends Error {
  readonly code: LuCanonicalRuntimeContractErrorCode;

  constructor(code: LuCanonicalRuntimeContractErrorCode, message: string) {
    super(message);
    this.name = "LuCanonicalRuntimeContractError";
    this.code = code;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** The `ArtifactReference` contract: an object carrying non-empty string `artifact_id` and `artifact_type`. */
function isArtifactReferenceShape(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const ref = value as Record<string, unknown>;
  return isNonEmptyString(ref.artifact_id) && isNonEmptyString(ref.artifact_type);
}

/**
 * Enforces, at runtime, exactly what `ExecutionIdentitySubjectV3` (minus the `site_id` the engine
 * adds itself) already requires: three artifact references plus an execution-contract version. No
 * new semantics -- only the shape the identity/manifest derivation already consumes.
 */
function assertCanonicalIdentitySubjectV3(input: unknown): void {
  const subject = (input as { identity_subject_v3?: unknown } | null | undefined)?.identity_subject_v3;
  const invalid: string[] = [];
  if (typeof subject !== "object" || subject === null || Array.isArray(subject)) {
    invalid.push("identity_subject_v3");
  } else {
    const fields = subject as Record<string, unknown>;
    for (const name of [
      "project_context_binding_ref",
      "product_release_ref",
      "localization_geometry_ref",
    ] as const) {
      if (!isArtifactReferenceShape(fields[name])) invalid.push(`identity_subject_v3.${name}`);
    }
    if (!isNonEmptyString(fields.execution_contract_version)) {
      invalid.push("identity_subject_v3.execution_contract_version");
    }
  }
  if (invalid.length > 0) {
    throw new LuCanonicalRuntimeContractError(
      "LU_CANONICAL_IDENTITY_SUBJECT_V3_INVALID",
      `runCanonicalLuProductAssessment requires a complete identity_subject_v3; missing or malformed: ${invalid.join(", ")}`,
    );
  }
}

/**
 * LU-CANONICAL-RUNTIME-HARDENING-R1 -- the public product boundary.
 *
 * Fails closed BEFORE the general engine is entered:
 *  - if MPS_LU_BOOTSTRAP_ADMIT enables bootstrap admission, the call is rejected. The canonical path
 *    never clears or rewrites the ambient flag to work around it (that would be ambient-state
 *    mutation with race semantics); and even past this check it hands the engine an explicit
 *    `bootstrap = false`, so it cannot obtain bootstrap admission through a later env read either;
 *  - if `identity_subject_v3` is missing or structurally broken, the call is rejected -- the type
 *    requirement above is not the only line of defence for untyped callers.
 *
 * A valid call reaches the unchanged engine.
 */
export async function runCanonicalLuProductAssessment(
  input: CanonicalLuKernelRunInput,
): Promise<LuKernelRunResult> {
  if (isLuBootstrapAdmitAllowed()) {
    throw new LuCanonicalRuntimeContractError(
      "LU_CANONICAL_BOOTSTRAP_ADMIT_FORBIDDEN",
      "runCanonicalLuProductAssessment refuses to run while MPS_LU_BOOTSTRAP_ADMIT enables bootstrap admission; " +
        "bootstrap is available only through the explicit general engine used by tests and proof tooling",
    );
  }
  assertCanonicalIdentitySubjectV3(input);
  return executeLuAssessment(input, false);
}
