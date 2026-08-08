import type { ArtifactReference } from "../../mps-compliance/src/artifacts/ArtifactReference.js";
import type { AuditSessionArtifact } from "../../mps-compliance/src/artifacts/AuditSessionArtifact.js";
import type { ViewerCapabilityArtifact } from "../../mps-compliance/src/artifacts/ViewerCapabilityArtifact.js";
import type { ContentHash } from "../../mps-compliance/src/artifacts/ContentHash.js";
import { DEFAULT_VIEWPORT_BUDGET, type ViewportBudget } from "./ViewportBudget.js";
import { assertAllowedObservationWrite } from "./ObservationWriteGate.js";

export interface OpenSessionInput {
  readonly session_id: string;
  readonly content_hash: ContentHash;
  readonly release_ref: ArtifactReference;
  readonly capability: ViewerCapabilityArtifact;
  readonly opened_at?: string;
}

/**
 * Mutable session controller that only emits AuditSessionArtifact snapshots.
 * VIEW-22-I4 / I5 / I6 — one capability, viewport-bounded, not truth.
 */
export class AuditSessionRuntime {
  private state: AuditSessionArtifact["state"] = "OPEN";
  private inspected: ArtifactReference[] = [];
  private exported: ArtifactReference[] = [];
  private closedAt?: string;
  private terminationReason?: AuditSessionArtifact["termination_reason"];
  private readonly openedAt: string;
  private readonly capabilityRef: ArtifactReference;
  private readonly sessionId: string;
  private readonly contentHash: ContentHash;
  private readonly releaseRef: ArtifactReference;
  private readonly budget: ViewportBudget;

  private constructor(
    input: OpenSessionInput,
    budget: ViewportBudget,
  ) {
    this.sessionId = input.session_id;
    this.contentHash = input.content_hash;
    this.releaseRef = input.release_ref;
    this.openedAt = input.opened_at ?? new Date().toISOString();
    this.capabilityRef = {
      artifact_id: input.capability.artifact_id,
      artifact_type: input.capability.artifact_type,
    };
    this.budget = budget;
  }

  static open(input: OpenSessionInput, budget: ViewportBudget = DEFAULT_VIEWPORT_BUDGET): AuditSessionRuntime {
    assertAllowedObservationWrite("audit_session");
    return new AuditSessionRuntime(input, budget);
  }

  get capability_ref(): ArtifactReference {
    return this.capabilityRef;
  }

  inspect(node: ArtifactReference): void {
    this.assertOpen();
    if (this.inspected.length >= this.budget.max_inspected_nodes) {
      throw new Error(
        `REJECT_VIEWPORT_EXCEEDED: max_inspected_nodes=${this.budget.max_inspected_nodes}`,
      );
    }
    if (!this.inspected.some((n) => n.artifact_id === node.artifact_id)) {
      this.inspected.push(Object.freeze({ ...node }));
    }
  }

  recordExport(artifact: ArtifactReference): void {
    this.assertOpen();
    if (this.exported.length >= this.budget.max_exported_artifacts) {
      throw new Error(
        `REJECT_VIEWPORT_EXCEEDED: max_exported_artifacts=${this.budget.max_exported_artifacts}`,
      );
    }
    if (!this.exported.some((n) => n.artifact_id === artifact.artifact_id)) {
      this.exported.push(Object.freeze({ ...artifact }));
    }
  }

  close(at?: string): AuditSessionArtifact {
    this.assertOpen();
    this.state = "CLOSED";
    this.closedAt = at ?? new Date().toISOString();
    this.terminationReason = "user_exit";
    return this.snapshot();
  }

  terminate(
    reason: Exclude<AuditSessionArtifact["termination_reason"], undefined>,
    at?: string,
  ): AuditSessionArtifact {
    this.assertOpen();
    this.state = "TERMINATED";
    this.closedAt = at ?? new Date().toISOString();
    this.terminationReason = reason;
    return this.snapshot();
  }

  snapshot(): AuditSessionArtifact {
    const base = {
      artifact_id: this.sessionId,
      artifact_type: "audit_session" as const,
      content_hash: this.contentHash,
      references: Object.freeze([this.releaseRef, this.capabilityRef]) as readonly ArtifactReference[],
      release_ref: this.releaseRef,
      viewer_capability_ref: this.capabilityRef,
      opened_at: this.openedAt,
      inspected_nodes: Object.freeze([...this.inspected]) as readonly ArtifactReference[],
      exported_artifacts: Object.freeze([...this.exported]) as readonly ArtifactReference[],
      state: this.state,
    };

    if (this.state === "OPEN") {
      return Object.freeze(base) as AuditSessionArtifact;
    }

    return Object.freeze({
      ...base,
      closed_at: this.closedAt,
      termination_reason: this.terminationReason,
    }) as AuditSessionArtifact;
  }

  private assertOpen(): void {
    if (this.state !== "OPEN") {
      throw new Error(`REJECT_SESSION_STATE: session is ${this.state}`);
    }
  }
}
