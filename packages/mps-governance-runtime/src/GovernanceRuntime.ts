import type { ArtifactReference } from "../../mps-compliance/src/artifacts/ArtifactReference.js";
import type { AuditSessionArtifact } from "../../mps-compliance/src/artifacts/AuditSessionArtifact.js";
import type { ViewerCapabilityArtifact } from "../../mps-compliance/src/artifacts/ViewerCapabilityArtifact.js";
import type { ContentHash } from "../../mps-compliance/src/artifacts/ContentHash.js";
import {
  ProofPathResolver,
  type ArtifactReader,
  type ProofQuestion,
  type ProofResolutionBudget,
  type ProofResolutionResult,
} from "../../mps-compliance/src/audit/ProofPathResolver.js";
import { ProofCompletenessValidator } from "../../mps-compliance/src/audit/ProofCompletenessValidator.js";
import type { CanonicalPipeline } from "../../mps-canonical/src/CanonicalPipeline.js";
import { admitViewerCapability } from "./ViewerCapabilityAdmission.js";
import { AuditSessionRuntime } from "./AuditSessionRuntime.js";
import { DEFAULT_VIEWPORT_BUDGET, type ViewportBudget } from "./ViewportBudget.js";
import {
  assertAllowedObservationWrite,
  assertObservationMayNotWrite,
} from "./ObservationWriteGate.js";

export interface GovernanceRuntimeDeps {
  readonly reader: ArtifactReader;
  readonly canonicalPipeline: CanonicalPipeline;
  readonly release_hash: string;
  readonly viewport_budget?: ViewportBudget;
  readonly proof_budget?: ProofResolutionBudget;
}

export interface StartSessionInput {
  readonly session_id: string;
  readonly content_hash: ContentHash;
  readonly release_ref: ArtifactReference;
  readonly capability: ViewerCapabilityArtifact;
  readonly now?: Date;
}

/**
 * Phase 23B Operational Governance Runtime.
 * Observation facade only — never mints authority.
 */
export class GovernanceRuntime {
  private activeSession: AuditSessionRuntime | null = null;
  private admittedCapabilityId: string | null = null;
  private readonly completeness = new ProofCompletenessValidator();

  constructor(private readonly deps: GovernanceRuntimeDeps) {}

  /**
   * Start an observation session with exactly one admitted capability (VIEW-22-I6).
   */
  startSession(input: StartSessionInput): AuditSessionArtifact {
    if (this.activeSession !== null) {
      throw new Error("REJECT_CAPABILITY_UNION: an observation session is already active");
    }

    const admission = admitViewerCapability(input.capability, {
      expected_release_hash: this.deps.release_hash,
      now: input.now,
    });
    if (!admission.ok) {
      throw new Error(admission.reason);
    }

    this.admittedCapabilityId = admission.capability.artifact_id;
    this.activeSession = AuditSessionRuntime.open(
      {
        session_id: input.session_id,
        content_hash: input.content_hash,
        release_ref: input.release_ref,
        capability: admission.capability,
      },
      this.deps.viewport_budget ?? DEFAULT_VIEWPORT_BUDGET,
    );

    return this.activeSession.snapshot();
  }

  inspect(node: ArtifactReference): AuditSessionArtifact {
    return this.withOpenSession((session) => {
      session.inspect(node);
      return session.snapshot();
    });
  }

  recordExport(artifact: ArtifactReference): AuditSessionArtifact {
    return this.withOpenSession((session) => {
      session.recordExport(artifact);
      return session.snapshot();
    });
  }

  /**
   * Resolve a typed proof question bound to the active session identity.
   */
  resolveProofPath(query: {
    readonly target: ArtifactReference;
    readonly question: ProofQuestion;
    readonly validate_completeness?: boolean;
  }): ProofResolutionResult {
    return this.withOpenSession((session) => {
      assertAllowedObservationWrite("proof_resolution");

      const resolver = new ProofPathResolver(
        this.deps.reader,
        this.deps.canonicalPipeline,
        this.deps.release_hash,
        this.deps.proof_budget,
      );

      const result = resolver.resolveProofPath({
        target: query.target,
        question: query.question,
        session_identity: {
          artifact_id: session.snapshot().artifact_id,
          artifact_type: "audit_session",
        },
      });

      if (query.validate_completeness !== false) {
        this.completeness.validate(result.graph, this.deps.release_hash);
      }

      session.inspect(query.target);
      return result;
    });
  }

  closeSession(): AuditSessionArtifact {
    return this.endSession("close");
  }

  terminateSession(
    reason: "timeout" | "capability_revoked" | "system_halt" | "user_exit",
  ): AuditSessionArtifact {
    return this.endSession("terminate", reason);
  }

  /**
   * Explicit refuse path for any attempt to write authority through observation.
   */
  refuseAuthorityWrite(artifactType: string): never {
    assertObservationMayNotWrite(artifactType);
    throw new Error(`REJECT_OBSERVATION_WRITE: unexpected non-authority type ${artifactType}`);
  }

  getActiveCapabilityId(): string | null {
    return this.admittedCapabilityId;
  }

  private endSession(
    mode: "close" | "terminate",
    reason?: "timeout" | "capability_revoked" | "system_halt" | "user_exit",
  ): AuditSessionArtifact {
    if (this.activeSession === null) {
      throw new Error("REJECT_SESSION_STATE: no active session");
    }
    const snap =
      mode === "close"
        ? this.activeSession.close()
        : this.activeSession.terminate(reason ?? "system_halt");
    this.activeSession = null;
    this.admittedCapabilityId = null;
    return snap;
  }

  private withOpenSession<T>(fn: (session: AuditSessionRuntime) => T): T {
    if (this.activeSession === null) {
      throw new Error("REJECT_SESSION_STATE: no active session");
    }
    return fn(this.activeSession);
  }
}
