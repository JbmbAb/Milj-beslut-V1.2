import type {
  ActorReference,
  ArtifactIdentityStrategy,
  ArtifactReference,
  CanonicalArtifactSerializer,
  CanonicalHashEngine,
  ContentReference,
  Signer,
  Timestamp,
} from "../../mps-core/src/types";
import { ArtifactIdentityBuilder, createSignedArtifactIdentity } from "../../mps-core/src/identity";
import { assertContentReferenceMatches } from "../../mps-core/src/references";
import type { DatasetApprovalArtifact } from "./DatasetApprovalArtifact";

export interface ResolvedHarvestManifest {
  readonly manifest_ref: ContentReference;
  /** Authoritative producer identity supplied by the governed manifest/provenance reader. */
  readonly producer: ActorReference;
}

export interface HarvestManifestAuthorityPort {
  resolveVerifiedManifest(ref: ContentReference): Promise<ResolvedHarvestManifest>;
}

export interface DatasetApprovalStore {
  put(artifact: DatasetApprovalArtifact): Promise<ArtifactReference>;
}

export interface DatasetApprovalReloadPort {
  loadApproval(ref: ArtifactReference): Promise<DatasetApprovalArtifact>;
}

/** Signing is injectable; the production composition decides which existing key authority is trusted. */
export interface DatasetApprovalSigner extends Signer {
  readonly keyId: string;
}

export interface DatasetApprovalTrustPort {
  assertTrustedDatasetApprovalSigner(keyId: string): Promise<void>;
}

export interface DatasetApprovalDecisionRequest {
  readonly manifest_ref: ContentReference;
  readonly decision: "APPROVED" | "REJECTED";
  readonly actor_ref: ActorReference;
  readonly decision_at: Timestamp;
  readonly reason: string;
}

/**
 * Canonical issuance path for DatasetApprovalArtifact. It has no CAS capability and never
 * creates a key: both authority and storage are injected, then the persisted result is reloaded
 * through the admission verifier before it is returned.
 */
export class DatasetApprovalAuthority {
  private readonly builder: ArtifactIdentityBuilder;

  constructor(
    serializer: CanonicalArtifactSerializer,
    hashEngine: CanonicalHashEngine,
    private readonly signer: DatasetApprovalSigner,
    identityStrategy: ArtifactIdentityStrategy,
    private readonly manifests: HarvestManifestAuthorityPort,
    private readonly trust: DatasetApprovalTrustPort,
    private readonly store: DatasetApprovalStore,
    private readonly reload: DatasetApprovalReloadPort,
  ) {
    this.builder = new ArtifactIdentityBuilder(serializer, hashEngine, signer, identityStrategy);
  }

  async decide(request: DatasetApprovalDecisionRequest): Promise<ArtifactReference> {
    validateRequest(request);
    const manifest = await this.manifests.resolveVerifiedManifest(request.manifest_ref);
    assertContentReferenceMatches(
      manifest.manifest_ref,
      request.manifest_ref,
      "DATASET_APPROVAL_MANIFEST_UNVERIFIED",
      "Dataset approval request does not match the verified HarvestManifest",
    );
    if (sameActor(request.actor_ref, manifest.producer)) {
      throw new Error("REJECT_DATASET_APPROVAL_SELF_APPROVAL");
    }

    // Refuse an untrusted key before signing or persistence.
    await this.trust.assertTrustedDatasetApprovalSigner(this.signer.keyId);

    const signed = await createSignedArtifactIdentity(
      {
        artifact_type: "DATASET_APPROVAL" as const,
        approved_ref: request.manifest_ref,
        decision: request.decision,
        actor_ref: request.actor_ref,
        decision_at: request.decision_at,
        reason: request.reason.trim(),
      },
      this.builder,
    );
    if (signed.signature.key_id !== this.signer.keyId) {
      throw new Error("REJECT_DATASET_APPROVAL_SIGNER_KEY_MISMATCH");
    }
    const artifact: DatasetApprovalArtifact = signed;
    const ref = await this.store.put(artifact);
    const reloaded = await this.reload.loadApproval(ref);
    assertReloadMatches(artifact, reloaded, ref);
    return ref;
  }
}

function validateRequest(request: DatasetApprovalDecisionRequest): void {
  const ref = request.manifest_ref;
  if (!ref?.id || !ref.content_hash?.algorithm || !ref.content_hash?.digest) {
    throw new Error("REJECT_DATASET_APPROVAL_MANIFEST_REQUIRED");
  }
  if (request.decision !== "APPROVED" && request.decision !== "REJECTED") {
    throw new Error("REJECT_DATASET_APPROVAL_DECISION_INVALID");
  }
  if (!request.actor_ref?.identity_ref?.id || !request.actor_ref.identity_ref.content_hash?.digest) {
    throw new Error("REJECT_DATASET_APPROVAL_REVIEWER_IDENTITY_REQUIRED");
  }
  if (request.actor_ref.role !== "GOVERNANCE_REVIEWER") {
    throw new Error("REJECT_DATASET_APPROVAL_REVIEWER_ROLE");
  }
  if (!request.decision_at || Number.isNaN(Date.parse(request.decision_at))) {
    throw new Error("REJECT_DATASET_APPROVAL_DECISION_TIME_REQUIRED");
  }
  if (!request.reason?.trim()) throw new Error("REJECT_DATASET_APPROVAL_REASON_REQUIRED");
}

function sameActor(a: ActorReference, b: ActorReference): boolean {
  return a.identity_ref.id === b.identity_ref.id &&
    a.identity_ref.content_hash.algorithm === b.identity_ref.content_hash.algorithm &&
    a.identity_ref.content_hash.digest === b.identity_ref.content_hash.digest;
}

function assertReloadMatches(
  expected: DatasetApprovalArtifact,
  actual: DatasetApprovalArtifact,
  ref: ArtifactReference,
): void {
  if (actual.artifact_type !== "DATASET_APPROVAL" || actual.decision !== expected.decision ||
      actual.actor_ref.role !== "GOVERNANCE_REVIEWER" || actual.reason !== expected.reason) {
    throw new Error("REJECT_DATASET_APPROVAL_RELOAD_MISMATCH");
  }
  assertContentReferenceMatches(actual.approved_ref, expected.approved_ref,
    "DATASET_APPROVAL_RELOAD_MANIFEST_MISMATCH", "Reloaded approval manifest differs from signed approval");
  const actualRef = { artifact_id: actual.artifact_id, artifact_type: actual.artifact_type, content_hash: actual.content_hash };
  if (actualRef.artifact_id !== ref.artifact_id || actualRef.content_hash.digest !== ref.content_hash.digest ||
      actualRef.content_hash.algorithm !== ref.content_hash.algorithm) {
    throw new Error("REJECT_DATASET_APPROVAL_RELOAD_REFERENCE_MISMATCH");
  }
}
