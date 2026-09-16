import type { ArtifactAttestation, VerificationKeyProvider } from "@miljobeslut/mimers-brunn-core";
import type { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract.js";
import type { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference.js";
import type { ArtifactRepositoryPort } from "../../../mps-runtime/src/kernel/ExecutionKernel.js";
import type { ExecutionIdentityArtifact } from "../../../mps-runtime/src/execution/ExecutionIdentityArtifact.js";
import type { ExecutionIdentitySubjectV3 } from "../../../mps-runtime/src/execution/ExecutionIdentityScopeV2.js";
import {
  createActorArtifact,
} from "../../../mps-governance/src/actors/ActorArtifact.js";
import {
  createActorLifecycleArtifact,
} from "../../../mps-governance/src/actors/ActorLifecycleArtifact.js";
import {
  createAuthorityEvidenceArtifact,
  type AuthorityEvidenceArtifact,
} from "../../../mps-governance/src/actors/AuthorityEvidenceArtifact.js";
import {
  createServiceIdentityArtifact,
} from "../../../mps-governance/src/actors/IdentityArtifacts.js";
import {
  createTrustAnchorArtifact,
} from "../../../mps-governance/src/actors/TrustAnchorArtifact.js";
import {
  createTrustDomainArtifact,
} from "../../../mps-governance/src/actors/TrustDomainArtifact.js";
import {
  verifySourceAuthorityAtDecisionTime,
  type VerifiedSourceAuthorityDecision,
} from "../../../mps-governance-runtime/src/SourceAuthorityVerification.js";
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
import { LU_EXECUTION_PRINCIPAL_ID } from "../execution/LuExecutionPrincipal.js";

export const LU_LOCALIZATION_ASSESSMENT_PERSIST_ACTION =
  "lu.localization_assessment.persist" as const;

export interface VerifiedLuSourceAuthority {
  readonly decision: VerifiedSourceAuthorityDecision;
  readonly evidence: AuthorityEvidenceArtifact;
  readonly supporting_artifacts: readonly ArtifactContract[];
}

function sameRef(left: ArtifactReference, right: ArtifactReference): boolean {
  return left.artifact_id === right.artifact_id && left.artifact_type === right.artifact_type;
}

function decisionInstant(value: string): { readonly iso: string; readonly milliseconds: number } {
  const milliseconds = Date.parse(value);
  if (Number.isNaN(milliseconds)) {
    throw new Error("REJECT_LU_SOURCE_AUTHORITY: authority_decision_time must be ISO-8601");
  }
  return { iso: new Date(milliseconds).toISOString(), milliseconds };
}

/**
 * 04D adapter: executed LU cryptographic source authority -> generic authority representation ->
 * generic source-authority decision.
 *
 * The lifecycle artifacts below are explicitly evaluation-scoped projections. They do not claim
 * a historical provisioning instant or current authority. ArtifactAttestation has no signed
 * timestamp, so inventing one would be false evidence. CREATED at T-1ms and ACTIVE at T merely
 * represent the state used at this exact persisted decision boundary; the positive authority
 * result still comes exclusively from the cryptographic verifier callback.
 */
export async function verifyLuSourceAuthorityForAssessment(input: {
  readonly repository: ArtifactRepositoryPort;
  readonly execution_identity: ExecutionIdentityArtifact;
  readonly expected_subject_v3: ExecutionIdentitySubjectV3;
  readonly expected_capability_ref: ArtifactReference;
  readonly release_snapshot_id: string;
  readonly deterministic_seed: string;
  readonly authority_decision_time: string;
  readonly root_verification: VerificationKeyProvider;
  readonly issuer_verification: VerificationKeyProvider;
}): Promise<VerifiedLuSourceAuthority> {
  const decision = decisionInstant(input.authority_decision_time);
  const canonicalActorRef: ArtifactReference = {
    artifact_id: LU_EXECUTION_PRINCIPAL_ID,
    artifact_type: "execution_identity",
  };

  if (!sameRef(input.execution_identity.actor_ref, canonicalActorRef)) {
    throw new Error("REJECT_LU_SOURCE_AUTHORITY: execution identity actor is not the canonical LU principal");
  }
  if (!sameRef(input.execution_identity.capability_ref, input.expected_capability_ref)) {
    throw new Error("REJECT_LU_SOURCE_AUTHORITY: execution identity capability mismatch");
  }

  const issuerRefs = input.execution_identity.references.filter(
    (reference) => reference.artifact_type === LU_EXECUTION_AUTHORITY_ISSUER_TYPE,
  );
  if (issuerRefs.length !== 1) {
    throw new Error("REJECT_LU_SOURCE_AUTHORITY: execution identity must reference exactly one LU issuer");
  }

  // These first resolutions are representation input only. No authorization is derived here.
  const representedIssuer = await input.repository.resolve<LuExecutionAuthorityIssuerArtifact>(
    issuerRefs[0]!,
  );
  const representedRoot = await input.repository.resolve<LuExecutionAuthorityRootArtifact>(
    representedIssuer.payload.root_ref,
  );

  const serviceIdentity = createServiceIdentityArtifact({
    service_namespace: "mimer.lu",
    principal_id: LU_EXECUTION_PRINCIPAL_ID,
  });
  const created = createActorLifecycleArtifact({
    identity: serviceIdentity,
    state: "CREATED",
    effective_from: new Date(decision.milliseconds - 1).toISOString(),
  });
  const active = createActorLifecycleArtifact({
    identity: serviceIdentity,
    state: "ACTIVE",
    effective_from: decision.iso,
    previous: created,
  });
  const anchor = createTrustAnchorArtifact({
    anchor_name: "LU execution authority",
    governance_profile: "ADR-24-21/04D",
    root: representedRoot,
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
  const actor = createActorArtifact({
    identity: serviceIdentity,
    trust_domain_refs: [{ artifact_id: domain.artifact_id, artifact_type: domain.artifact_type }],
    lifecycle_ref: { artifact_id: active.artifact_id, artifact_type: active.artifact_type },
  });
  const evidence = createAuthorityEvidenceArtifact({
    actor,
    trust_domain: domain,
    trust_anchor: anchor,
    lifecycle: active,
    action: LU_LOCALIZATION_ASSESSMENT_PERSIST_ACTION,
    decision_time: decision.iso,
    authority_path: [
      { role: "root", artifact: representedRoot },
      { role: "issuer", artifact: representedIssuer },
      { role: "subject", artifact: input.execution_identity },
    ],
  });

  const verifiedDecision = await verifySourceAuthorityAtDecisionTime({
    evidence,
    actor,
    lifecycle: active,
    trust_domain: domain,
    trust_anchor: anchor,
    decision_time: decision.iso,
    required_action: LU_LOCALIZATION_ASSESSMENT_PERSIST_ACTION,
    required_scope: LU_EXECUTION_AUTHORITY_SCOPE,
    verify_source_path: async () => {
      const verifiedIssuer = await verifyLuExecutionAuthorityChain({
        issuerRef: issuerRefs[0]!,
        repository: input.repository,
        rootVerification: input.root_verification,
        issuerVerification: input.issuer_verification,
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
        authorityVerifier: input.issuer_verification,
        expectedSubjectV3: input.expected_subject_v3,
      });
      if (!identityResult.verified) {
        throw new Error(
          `REJECT_LU_SOURCE_AUTHORITY: execution identity verification ${identityResult.reason}`,
        );
      }
      return {
        root: verifiedRoot,
        issuer: verifiedIssuer,
        subject: identityResult.identity,
      };
    },
  });

  return {
    decision: verifiedDecision,
    evidence,
    // The root/issuer/execution identity already exist in the source-authority CAS chain.
    // Persist only the generic projection closure needed to resolve AuthorityEvidence transitively.
    supporting_artifacts: [serviceIdentity, created, active, anchor, domain, actor],
  };
}
