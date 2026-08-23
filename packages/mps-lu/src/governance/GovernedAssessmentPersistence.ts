import type { ArtifactRepositoryPort } from "../../../mps-runtime/src/kernel/ExecutionKernel.js";
import { sha256ContentHash } from "../../../mps-runtime/src/kernel/ExecutionKernel.js";
import type { FrozenExecutionOutcomeIdentity } from "../../../mps-runtime/src/contracts/freeze/FrozenIdentities.js";
import type { OutcomeAttestation } from "../../../mps-runtime/src/security/SecurityContracts.js";
import type { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactReference";
import type { AssessmentFinding } from "../domain/AssessmentFinding.js";
import {
  LOCALIZATION_ASSESSMENT_CONTRACT_VERSION_V2,
  type LocalizationAssessmentArtifact,
  type LocalizationAssessmentDraft,
  type LocalizationAssessmentPayload,
} from "../artifacts/LocalizationAssessmentArtifact.js";

export type VerifyOutcomeAttestation = (attestation: OutcomeAttestation) => boolean;

/** The canonical hash domain. Identity fields are derived from this body, never self-hashed. */
export function localizationAssessmentCanonicalBody(
  artifact: LocalizationAssessmentArtifact,
): Pick<LocalizationAssessmentArtifact, "artifact_type" | "references" | "payload"> {
  return {
    artifact_type: artifact.artifact_type,
    references: artifact.references,
    payload: artifact.payload,
  };
}

function sameHash(
  left: { readonly algorithm: string; readonly value: string },
  right: { readonly algorithm: string; readonly value: string },
): boolean {
  return left.algorithm === right.algorithm && left.value === right.value;
}

function sameRef(
  left: { readonly artifact_id: string; readonly artifact_type: string } | undefined,
  right: { readonly artifact_id: string; readonly artifact_type: string },
): boolean {
  return left?.artifact_id === right.artifact_id && left.artifact_type === right.artifact_type;
}

function uniqueRefs(
  refs: readonly { readonly artifact_id: string; readonly artifact_type: string }[],
) {
  return Array.from(
    new Map(refs.map((ref) => [`${ref.artifact_type}:${ref.artifact_id}`, ref] as const)).values(),
  );
}

/**
 * LOCALIZATION-ASSESSMENT-CANONICAL-COLLECTIONS-V2. `evidence_refs` is a SEMANTIC_SET (the
 * evidence that exists within a query radius, sourced from an SQL query with no ordering
 * guarantee) -- canonicalized here by deduplicating by ref identity (same key as `uniqueRefs`)
 * and then sorting by that same explicit, stable, lexical key, so a re-execution over the
 * identical underlying evidence always produces byte-identical `evidence_refs`, regardless of
 * what order the source query happened to return rows in.
 */
function canonicalEvidenceRefs(
  refs: readonly { readonly artifact_id: string; readonly artifact_type: string }[],
): ArtifactReference[] {
  return uniqueRefs(refs).sort((a, b) => {
    const keyA = `${a.artifact_type}:${a.artifact_id}`;
    const keyB = `${b.artifact_type}:${b.artifact_id}`;
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });
}

export function createGovernedLocalizationAssessment(args: {
  readonly draft: LocalizationAssessmentDraft;
  readonly findings: readonly AssessmentFinding[];
  readonly outcome: FrozenExecutionOutcomeIdentity;
  readonly attestation: OutcomeAttestation;
}): LocalizationAssessmentArtifact {
  const executionOutcomeRef = {
    artifact_id: args.outcome.outcome_id,
    artifact_type: args.outcome.artifact_type,
  };
  const outcomeAttestationRef = {
    artifact_id: args.attestation.attestation_id,
    artifact_type: args.attestation.artifact_type,
  };
  const payload: LocalizationAssessmentPayload = {
    project_context_ref: args.draft.project_context_ref,
    property_ref: args.draft.property_ref,
    execution_outcome_ref: executionOutcomeRef,
    outcome_attestation_ref: outcomeAttestationRef,
    findings: args.findings,
    // LOCALIZATION-ASSESSMENT-CANONICAL-COLLECTIONS-V2: dedup + canonical sort, not just dedup --
    // evidence_refs is a SEMANTIC_SET, never an as-received ORDERED_SEQUENCE.
    evidence_refs: canonicalEvidenceRefs(args.draft.evidence_refs),
    // ORDERED_SEQUENCE: preserve findings' own sequence exactly, positional 1:1 map, never sorted.
    rule_refs: args.findings.map((finding) => ({
      rule_id: finding.rule_id,
      rule_version: finding.rule_version,
    })),
    system_summary: args.draft.system_summary,
    ...(args.draft.consultant_commentary_ref
      ? { consultant_commentary_ref: args.draft.consultant_commentary_ref }
      : {}),
    ...(args.draft.localization_geometry_ref
      ? { localization_geometry_ref: args.draft.localization_geometry_ref }
      : {}),
    assessment_contract_version: LOCALIZATION_ASSESSMENT_CONTRACT_VERSION_V2,
  };
  // Constructed FROM the already-canonical payload.evidence_refs -- never independently
  // re-discovering the caller's raw (potentially non-canonical) order.
  const references = uniqueRefs([
    args.draft.project_context_ref,
    args.draft.property_ref,
    ...payload.evidence_refs,
    executionOutcomeRef,
    outcomeAttestationRef,
    ...(args.draft.localization_geometry_ref ? [args.draft.localization_geometry_ref] : []),
  ]);
  const identityBody = {
    artifact_type: "LOCALIZATION_ASSESSMENT" as const,
    references,
    payload,
  };
  const contentHash = sha256ContentHash(identityBody);
  return {
    artifact_id: `assessment-${contentHash.value}`,
    ...identityBody,
    content_hash: contentHash,
  };
}

/**
 * HM1-C authority boundary. A caller may present an artifact, but cannot declare its truth:
 * every binding and the canonical body hash are independently re-verified before persistence.
 */
export class GovernedAssessmentPersistence {
  constructor(
    private readonly repository: ArtifactRepositoryPort,
    private readonly verifyAttestation: VerifyOutcomeAttestation,
  ) {}

  async persist(args: {
    readonly artifact: LocalizationAssessmentArtifact;
    readonly outcome: FrozenExecutionOutcomeIdentity;
    readonly attestation: OutcomeAttestation;
  }): Promise<LocalizationAssessmentArtifact> {
    const failed: string[] = [];
    const outcomeRef = {
      artifact_id: args.outcome.outcome_id,
      artifact_type: args.outcome.artifact_type,
    };
    const attestationRef = {
      artifact_id: args.attestation.attestation_id,
      artifact_type: args.attestation.artifact_type,
    };
    const computedHash = sha256ContentHash(localizationAssessmentCanonicalBody(args.artifact));
    const expectedArtifactId = `assessment-${computedHash.value}`;
    const attestationBody = {
      artifact_type: args.attestation.artifact_type,
      principal_id: args.attestation.principal_id,
      outcome_hash: args.attestation.outcome_hash,
      key_id: args.attestation.key_id,
      signature: args.attestation.signature,
    };
    const expectedAttestationHash = sha256ContentHash(attestationBody);
    const expectedAttestationId = `attest-${expectedAttestationHash.value.slice(0, 16)}`;

    if (!sameRef(args.artifact.payload.execution_outcome_ref, outcomeRef)) {
      failed.push("execution_outcome_ref");
    }
    if (!sameRef(args.artifact.payload.outcome_attestation_ref, attestationRef)) {
      failed.push("outcome_attestation_ref");
    }
    if (!sameHash(args.attestation.outcome_hash, args.outcome.content_hash)) {
      failed.push("attestation_outcome_hash");
    }
    if (!sameHash(args.attestation.content_hash, expectedAttestationHash)) {
      failed.push("attestation_content_hash");
    }
    if (args.attestation.attestation_id !== expectedAttestationId) {
      failed.push("attestation_id");
    }
    if (!this.verifyAttestation(args.attestation)) {
      failed.push("attestation_signature");
    }
    if (!sameHash(args.artifact.content_hash, computedHash)) {
      failed.push("canonical_body_hash");
    }
    if (args.artifact.artifact_id !== expectedArtifactId) {
      failed.push("canonical_artifact_id");
    }
    if (!args.artifact.references.some((ref) => sameRef(ref, outcomeRef))) {
      failed.push("outcome_reference_edge");
    }
    if (!args.artifact.references.some((ref) => sameRef(ref, attestationRef))) {
      failed.push("attestation_reference_edge");
    }

    if (failed.length > 0) {
      throw new Error(`REJECT_LOCALIZATION_ASSESSMENT: ${failed.join(",")}`);
    }

    await this.repository.put({
      artifact_id: args.artifact.artifact_id,
      content_hash: computedHash,
      body: args.artifact,
    });
    return args.artifact;
  }
}
