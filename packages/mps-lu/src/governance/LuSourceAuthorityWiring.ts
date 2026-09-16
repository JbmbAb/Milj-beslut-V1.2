import type { ArtifactAttestation } from "@miljobeslut/mimers-brunn-core";
import type { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract.js";
import type { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference.js";
import type { ContentHash } from "../../../mps-compliance/src/artifacts/ContentHash.js";
import type { ArtifactRepositoryPort } from "../../../mps-runtime/src/kernel/ExecutionKernel.js";
import type { ExecutionIdentityArtifact } from "../../../mps-runtime/src/execution/ExecutionIdentityArtifact.js";
import type { ExecutionIdentitySubjectV3 } from "../../../mps-runtime/src/execution/ExecutionIdentityScopeV2.js";
import {
  createTrustAnchorArtifact,
} from "../../../mps-governance/src/actors/TrustAnchorArtifact.js";
import {
  createTrustDomainArtifact,
} from "../../../mps-governance/src/actors/TrustDomainArtifact.js";
import {
  LU_EXECUTION_AUTHORITY_ISSUER_TYPE,
  LU_EXECUTION_AUTHORITY_SCOPE,
  type LuExecutionAuthorityIssuerArtifact,
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

export const LU_LOCALIZATION_ASSESSMENT_PERSIST_ACTION =
  "lu.localization_assessment.persist" as const;

export interface VerifiedLuSourceAuthorityDecision {
  readonly source_authority_verified: true;
  readonly action: string;
  readonly authority_scope: string;
  readonly evidence_ref: {
    readonly artifact_id: string;
    readonly artifact_type: "authority_evidence";
  };
  readonly evidence_hash: ContentHash;
  readonly subject_ref: ArtifactReference;
  readonly subject_hash: ContentHash;
}

export interface VerifiedLuSourceAuthority {
  readonly decision: VerifiedLuSourceAuthorityDecision;
  readonly evidence: LuSourceAuthorityEvidenceArtifact;
  readonly supporting_artifacts: readonly ArtifactContract[];
}

/**
 * Positive authority provenance is process-local and LU-specific. A caller can construct an
 * object with the same fields, but cannot insert it into this module-private WeakSet. More
 * importantly, the function that mints membership below obtains the provisioned verification
 * keys internally; callers cannot inject an "always true" VerificationKeyProvider.
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
 * 04D-R1 adapter: real LU root -> issuer -> ExecutionIdentity verification, followed by a
 * deterministic, non-temporal AuthorityEvidence representation.
 *
 * This function deliberately makes NO authorized_at_decision_time/currentness claim. The source
 * artifacts carry no signed validity window, revocation state, or decision-time binding. Those
 * claims remain unavailable until a later temporal/revocation authority delta supplies them.
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

  // Trust roots are process provisioning, not caller parameters.
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

  // Canonical generic projection is built only AFTER source cryptography succeeds.
  const serviceIdentity = deriveLuCanonicalServiceIdentity(identityResult);
  const anchor = createTrustAnchorArtifact({
    anchor_name: "LU execution authority",
    governance_profile: "ADR-24-21/04D-R1",
    root: verifiedRoot,
  });
  const domain = createTrustDomainArtifact({
    anchor,
    domain_name: "LU execution",
    authority_scope: LU_EXECUTION_AUTHORITY_SCOPE,
    constraints: [
      "allowed_artifact_type=execution_identity",
      "owner_provisioning=OWNER_PROVISIONED",
    ],
    allowed_actor_types: ["service"],
    delegation_rules: ["source-authority-chain"],
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
  });

  const decision: VerifiedLuSourceAuthorityDecision = Object.freeze({
    source_authority_verified: true as const,
    action: LU_LOCALIZATION_ASSESSMENT_PERSIST_ACTION,
    authority_scope: LU_EXECUTION_AUTHORITY_SCOPE,
    evidence_ref: {
      artifact_id: evidence.artifact_id,
      artifact_type: evidence.artifact_type,
    },
    evidence_hash: evidence.content_hash,
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
    supporting_artifacts: [serviceIdentity, anchor, domain],
  };
}
