import type { ArtifactAttestation } from "@miljobeslut/mimers-brunn-core";
import type { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract.js";
import type { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference.js";
import type { ContentHash } from "../../../mps-compliance/src/artifacts/ContentHash.js";
import type { ArtifactRepositoryPort } from "../../../mps-runtime/src/kernel/ExecutionKernel.js";
import type { ExecutionIdentityArtifact } from "../../../mps-runtime/src/execution/ExecutionIdentityArtifact.js";
import type { ExecutionIdentitySubjectV3 } from "../../../mps-runtime/src/execution/ExecutionIdentityScopeV2.js";
import { createTrustAnchorArtifact } from "../../../mps-governance/src/actors/TrustAnchorArtifact.js";
import { createTrustDomainArtifact } from "../../../mps-governance/src/actors/TrustDomainArtifact.js";
import {
  LU_EXECUTION_AUTHORITY_ISSUER_TYPE,
  LU_EXECUTION_AUTHORITY_SCOPE,
  type LuExecutionAuthorityRootArtifact,
  validateLuExecutionAuthorityRootArtifact,
} from "../artifacts/LuExecutionAuthorityArtifact.js";
import {
  buildExecutionIdentityAttestationPredicate,
  verifyExecutionIdentityAttestation,
} from "../execution/ExecutionIdentityAttestation.js";
import { verifyLuExecutionAuthorityChain } from "../execution/LuExecutionAuthorityChain.js";
import {
  getLuExecutionAuthorityRootVerifier,
  getLuExecutionAuthorityVerifier,
} from "../execution/LuExecutionAuthorityVerifier.js";
import { LU_EXECUTION_PRINCIPAL_ID } from "../execution/LuExecutionPrincipal.js";
import { deriveLuCanonicalServiceIdentity } from "../execution/LuCanonicalServiceIdentity.js";
import {
  createLuSourceAuthorityEvidenceArtifact,
  validateLuSourceAuthorityEvidenceArtifact,
  type LuSourceAuthorityEvidenceArtifact,
} from "./LuSourceAuthorityEvidence.js";
import {
  LU_SOURCE_AUTHORITY_TEMPORAL_STATUS_TYPE,
  verifyLuSourceAuthorityTemporalStatus,
  type LuSourceAuthorityTemporalStatusArtifact,
} from "./LuSourceAuthorityTemporalStatus.js";

export const LU_LOCALIZATION_ASSESSMENT_PERSIST_ACTION =
  "lu.localization_assessment.persist" as const;
export const LU_SOURCE_AUTHORITY_TEMPORAL_STATUS_ID_ENV =
  "LU_SOURCE_AUTHORITY_TEMPORAL_STATUS_ID" as const;

export interface VerifiedLuSourceAuthorityDecision {
  readonly source_authority_verified: true;
  readonly authorized_at_decision_time: true;
  readonly decision_time: string;
  readonly action: string;
  readonly authority_scope: string;
  readonly evidence_ref: {
    readonly artifact_id: string;
    readonly artifact_type: "authority_evidence";
  };
  readonly evidence_hash: ContentHash;
  readonly temporal_status_ref: ArtifactReference;
  readonly temporal_status_hash: ContentHash;
  readonly subject_ref: ArtifactReference;
  readonly subject_hash: ContentHash;
}

export interface VerifiedLuSourceAuthority {
  readonly decision: VerifiedLuSourceAuthorityDecision;
  readonly evidence: LuSourceAuthorityEvidenceArtifact;
  readonly temporal_status: LuSourceAuthorityTemporalStatusArtifact;
  readonly supporting_artifacts: readonly ArtifactContract[];
}

/**
 * Positive authority provenance is process-local and LU-specific. A caller can construct an
 * object with the same fields, but cannot insert it into this module-private WeakSet. The minting
 * function also obtains all verification keys and the temporal-status id from process provisioning;
 * none are caller-supplied parameters.
 */
const verifiedLuSourceAuthorityDecisions = new WeakSet<object>();

export function isVerifiedLuSourceAuthorityDecision(
  value: unknown,
): value is VerifiedLuSourceAuthorityDecision {
  return (
    typeof value === "object" &&
    value !== null &&
    verifiedLuSourceAuthorityDecisions.has(value as object)
  );
}

function sameRef(left: ArtifactReference, right: ArtifactReference): boolean {
  return left.artifact_id === right.artifact_id && left.artifact_type === right.artifact_type;
}

/**
 * 04E source-authority evaluator.
 *
 * Cryptographic identity is verified first. Temporal authorization is then evaluated from a
 * root-signed, hash-bound status artifact selected by process provisioning. The status artifact
 * carries the replay-stable T_decision, qualification window and effective revocation time.
 * Therefore this function can make the strictly historical claim authorized_at_decision_time=true,
 * while still making no claim about authorized_now.
 */
export async function verifyLuSourceAuthorityForAssessment(input: {
  readonly repository: ArtifactRepositoryPort;
  readonly execution_identity: ExecutionIdentityArtifact;
  readonly expected_subject_v3: ExecutionIdentitySubjectV3;
  readonly expected_capability_ref: ArtifactReference;
  readonly release_snapshot_id: string;
  readonly deterministic_seed: string;
}): Promise<VerifiedLuSourceAuthority> {
  const canonicalActorRef: ArtifactReference = {
    artifact_id: LU_EXECUTION_PRINCIPAL_ID,
    artifact_type: "execution_identity",
  };
  if (!sameRef(input.execution_identity.actor_ref, canonicalActorRef)) {
    throw new Error(
      "REJECT_LU_SOURCE_AUTHORITY: execution identity actor is not the canonical LU principal",
    );
  }
  if (!sameRef(input.execution_identity.capability_ref, input.expected_capability_ref)) {
    throw new Error("REJECT_LU_SOURCE_AUTHORITY: execution identity capability mismatch");
  }

  const issuerRefs = input.execution_identity.references.filter(
    (reference) => reference.artifact_type === LU_EXECUTION_AUTHORITY_ISSUER_TYPE,
  );
  if (issuerRefs.length !== 1) {
    throw new Error(
      "REJECT_LU_SOURCE_AUTHORITY: execution identity must reference exactly one LU issuer",
    );
  }

  const rootVerification = getLuExecutionAuthorityRootVerifier();
  const issuerVerification = getLuExecutionAuthorityVerifier();
  const verifiedIssuer = await verifyLuExecutionAuthorityChain({
    issuerRef: issuerRefs[0]!,
    repository: input.repository,
    rootVerification,
    issuerVerification,
  });
  const verifiedRoot = validateLuExecutionAuthorityRootArtifact(
    await input.repository.resolve<LuExecutionAuthorityRootArtifact>(
      verifiedIssuer.payload.root_ref,
    ),
  );
  const attestation = await input.repository.resolve<ArtifactAttestation>(
    input.execution_identity.signature_envelope_ref,
  );
  const identityResult = await verifyExecutionIdentityAttestation({
    identity: input.execution_identity,
    attestation,
    expectedPredicate: buildExecutionIdentityAttestationPredicate({
      execution_identity_id: input.execution_identity.artifact_id,
      actor_ref: canonicalActorRef,
      capability_ref: input.expected_capability_ref,
      release_snapshot_id: input.release_snapshot_id,
      site_id: input.expected_subject_v3.site_id,
      deterministic_seed: input.deterministic_seed,
    }),
    authorityVerifier: issuerVerification,
    expectedSubjectV3: input.expected_subject_v3,
  });
  if ("reason" in identityResult) {
    throw new Error(
      `REJECT_LU_SOURCE_AUTHORITY: execution identity verification ${identityResult.reason}`,
    );
  }

  const temporalStatusId = process.env[LU_SOURCE_AUTHORITY_TEMPORAL_STATUS_ID_ENV]?.trim();
  if (!temporalStatusId) {
    throw new Error("REJECT_LU_SOURCE_AUTHORITY: temporal_status_unconfigured");
  }
  const temporalStatus = await input.repository.resolve<LuSourceAuthorityTemporalStatusArtifact>({
    artifact_id: temporalStatusId,
    artifact_type: LU_SOURCE_AUTHORITY_TEMPORAL_STATUS_TYPE,
  });
  await verifyLuSourceAuthorityTemporalStatus({
    status: temporalStatus,
    root: verifiedRoot,
    issuer: verifiedIssuer,
    subject: identityResult.identity,
    expected_action: LU_LOCALIZATION_ASSESSMENT_PERSIST_ACTION,
    root_verification: rootVerification,
  });

  // Canonical generic projection is built only AFTER source cryptography and temporal status pass.
  const serviceIdentity = deriveLuCanonicalServiceIdentity(identityResult);
  const anchor = createTrustAnchorArtifact({
    anchor_name: "LU execution authority",
    governance_profile: "ADR-24-21/04E",
    root: verifiedRoot,
  });
  const domain = createTrustDomainArtifact({
    anchor,
    domain_name: "LU execution",
    authority_scope: LU_EXECUTION_AUTHORITY_SCOPE,
    constraints: [
      "allowed_artifact_type=execution_identity",
      "owner_provisioning=OWNER_PROVISIONED",
      "temporal_status=root_signed",
    ],
    allowed_actor_types: ["service"],
    delegation_rules: ["source-authority-chain", "temporal-currentness"],
  });
  const evidence = createLuSourceAuthorityEvidenceArtifact({
    service_identity: serviceIdentity,
    trust_domain: domain,
    trust_anchor: anchor,
    action: LU_LOCALIZATION_ASSESSMENT_PERSIST_ACTION,
    authority_path: [
      { role: "root", artifact: verifiedRoot },
      { role: "issuer", artifact: verifiedIssuer },
      { role: "subject", artifact: identityResult.identity },
    ],
    temporal_status: temporalStatus,
  });
  validateLuSourceAuthorityEvidenceArtifact(evidence, {
    service_identity: serviceIdentity,
    trust_domain: domain,
    trust_anchor: anchor,
    authority_path: [
      { role: "root", artifact: verifiedRoot },
      { role: "issuer", artifact: verifiedIssuer },
      { role: "subject", artifact: identityResult.identity },
    ],
    temporal_status: temporalStatus,
  });

  const decision: VerifiedLuSourceAuthorityDecision = Object.freeze({
    source_authority_verified: true as const,
    authorized_at_decision_time: true as const,
    decision_time: temporalStatus.payload.decision_time,
    action: LU_LOCALIZATION_ASSESSMENT_PERSIST_ACTION,
    authority_scope: LU_EXECUTION_AUTHORITY_SCOPE,
    evidence_ref: {
      artifact_id: evidence.artifact_id,
      artifact_type: evidence.artifact_type,
    },
    evidence_hash: evidence.content_hash,
    temporal_status_ref: {
      artifact_id: temporalStatus.artifact_id,
      artifact_type: temporalStatus.artifact_type,
    },
    temporal_status_hash: temporalStatus.content_hash,
    subject_ref: {
      artifact_id: identityResult.identity.artifact_id,
      artifact_type: identityResult.identity.artifact_type,
    },
    subject_hash: identityResult.identity.content_hash,
  });
  verifiedLuSourceAuthorityDecisions.add(decision);

  return {
    decision,
    evidence,
    temporal_status: temporalStatus,
    supporting_artifacts: [serviceIdentity, anchor, domain, temporalStatus],
  };
}
