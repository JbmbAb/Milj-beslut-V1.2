import {
  LocalPemSigningKeyProvider,
  createArtifactAttestation,
} from "../../../mimers-brunn-core/src/index.js";
import { sha256ContentHash } from "../../../mps-compliance/src/canonical/sha256Canonical.js";
import type { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference.js";
import {
  createLuExecutionAuthorityIssuerArtifact,
  createLuExecutionAuthorityRootArtifact,
} from "../../src/artifacts/LuExecutionAuthorityArtifact.js";
import {
  attestLuExecutionAuthorityIssuer,
  attestLuExecutionAuthorityRoot,
} from "../../src/execution/LuExecutionAuthorityChain.js";
import {
  buildExecutionIdentityAttestationPredicate,
  executionIdentityCanonicalBody,
  LU_EXECUTION_IDENTITY_ATTESTATION_PREDICATE_TYPE,
} from "../../src/execution/ExecutionIdentityAttestation.js";
import { __resetLuExecutionAuthorityVerifierForTests } from "../../src/execution/LuExecutionAuthorityVerifier.js";
import {
  LU_EXECUTION_PRINCIPAL_ID,
  runCanonicalLuProductAssessment,
} from "../../src/execution/LuExecutionKernelClient.js";
import { createLuRegistryRuntime } from "../../src/registry/createLuRegistryRuntime.js";
import { LU_SITE_ASSESSMENT_CAPABILITY_KEY } from "../../src/registry/LuSiteAssessmentRegistry.js";
import {
  computeExecutionIdentityArtifactIdV3,
  LU_EXECUTION_IDENTITY_SCOPE_V3,
  type ExecutionIdentitySubjectV3,
} from "../../../mps-runtime/src/execution/ExecutionIdentityScopeV2.js";
import type { ExecutionIdentityArtifact } from "../../../mps-runtime/src/execution/ExecutionIdentityArtifact.js";
import type { ArtifactRepositoryPort } from "../../../mps-runtime/src/kernel/ExecutionKernel.js";
import {
  attestLuExecutionAuthorityLifecycle,
  createLuExecutionAuthorityLifecycleArtifact,
} from "../../src/governance/LuExecutionAuthorityLifecycle.js";
import {
  attestLuSourceAuthorityTemporalStatus,
  createLuSourceAuthorityTemporalStatusArtifact,
} from "../../src/governance/LuSourceAuthorityTemporalStatus.js";
import { deriveLuCanonicalAssessmentAttemptRef } from "../../src/governance/LuSourceAuthorityWiring.js";
import type { SpatialEvidenceArtifact } from "../../src/artifacts/SpatialEvidenceArtifact.js";
import type { SpatialLayerUnavailable } from "../../src/services/SpatialQueryContract.js";

/**
 * U30-R3 test fixture: the real canonical LU product chain (MINIMUM-AUTHORITY-DELTA-04D/04E), so a
 * re-execution proof can run against a genuine V4 assessment -- AuthorityEvidence -> exact-attempt
 * temporal status -> V3 ExecutionIdentity -> manifest/attempt/outcome -- instead of a V3 assessment
 * relabelled "v4". Same construction as LuSourceAuthorityWiring04D.test.ts, with one authority and
 * any number of execution subjects. Keys are generated in memory; nothing is read from or written
 * to disk.
 *
 * The fixture sets the LU_EXECUTION_AUTHORITY_* environment the canonical path reads; callers save
 * and restore it (`LU_CANONICAL_AUTHORITY_ENV`).
 */
export const LU_CANONICAL_AUTHORITY_ENV = [
  "MPS_LU_BOOTSTRAP_ADMIT",
  "LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM",
  "LU_EXECUTION_AUTHORITY_SIGNING_KEY_ID",
  "LU_EXECUTION_AUTHORITY_ROOT_PUBLIC_KEY_PEM",
  "LU_EXECUTION_AUTHORITY_ROOT_KEY_ID",
  "LU_EXECUTION_AUTHORITY_LIFECYCLE_ID",
] as const;

function ref(artifact: { readonly artifact_id: string; readonly artifact_type: string }): ArtifactReference {
  return { artifact_id: artifact.artifact_id, artifact_type: artifact.artifact_type };
}

export async function createLuCanonicalAuthority(repository: ArtifactRepositoryPort) {
  const rootKey = LocalPemSigningKeyProvider.generate("ed25519:lu-root-u30r3");
  const issuerKey = LocalPemSigningKeyProvider.generate("ed25519:lu-issuer-u30r3");

  process.env.LU_EXECUTION_AUTHORITY_ROOT_KEY_ID = rootKey.provider.keyId;
  process.env.LU_EXECUTION_AUTHORITY_ROOT_PUBLIC_KEY_PEM = rootKey.publicKey;
  process.env.LU_EXECUTION_AUTHORITY_SIGNING_KEY_ID = issuerKey.provider.keyId;
  process.env.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM = issuerKey.publicKey;
  delete process.env.MPS_LU_BOOTSTRAP_ADMIT;
  __resetLuExecutionAuthorityVerifierForTests(null);

  const bareRoot = createLuExecutionAuthorityRootArtifact({
    root_key_id: rootKey.provider.keyId,
    public_key_fingerprint: "root-fingerprint-u30r3",
  });
  const root = { ...bareRoot, attestation: await attestLuExecutionAuthorityRoot({ root: bareRoot, signing: rootKey.provider }) };
  const bareIssuer = createLuExecutionAuthorityIssuerArtifact({
    issuer_key_id: issuerKey.provider.keyId,
    public_key_fingerprint: "issuer-fingerprint-u30r3",
    root_ref: ref(root),
  });
  const issuer = {
    ...bareIssuer,
    attestation: await attestLuExecutionAuthorityIssuer({ issuer: bareIssuer, root, signing: rootKey.provider }),
  };
  await repository.put({ artifact_id: root.artifact_id, content_hash: root.content_hash, body: root });
  await repository.put({ artifact_id: issuer.artifact_id, content_hash: issuer.content_hash, body: issuer });

  const bareLifecycle = createLuExecutionAuthorityLifecycleArtifact({
    root,
    issuer,
    valid_from: "2020-01-01T00:00:00.000Z",
    valid_until: "2035-01-01T00:00:00.000Z",
  });
  const lifecycle = {
    ...bareLifecycle,
    attestation: await attestLuExecutionAuthorityLifecycle({ lifecycle: bareLifecycle, root, signing: rootKey.provider }),
  };
  await repository.put({ artifact_id: lifecycle.artifact_id, content_hash: lifecycle.content_hash, body: lifecycle });
  process.env.LU_EXECUTION_AUTHORITY_LIFECYCLE_ID = lifecycle.artifact_id;

  const registry = createLuRegistryRuntime();
  const capability = registry.resolveCapabilityByKey(LU_SITE_ASSESSMENT_CAPABILITY_KEY)!;
  return { repository, issuerKey, issuer, lifecycle, registry, capability };
}

export type LuCanonicalAuthority = Awaited<ReturnType<typeof createLuCanonicalAuthority>>;

/** One owner-provisioned execution subject: its V3 identity (issuer-signed) and exact-attempt ticket. */
export async function provisionLuCanonicalSubject(
  authority: LuCanonicalAuthority,
  name: string,
): Promise<{ readonly subject: ExecutionIdentitySubjectV3; readonly seed: string; readonly identity: ExecutionIdentityArtifact }> {
  const subject: ExecutionIdentitySubjectV3 = {
    site_id: `property-${name}`,
    project_context_binding_ref: { artifact_id: `binding-${name}`, artifact_type: "project_context_binding" },
    product_release_ref: { artifact_id: "release-u30r3", artifact_type: "product_release_manifest" },
    execution_contract_version: "lu-execution-identity-v1",
    localization_geometry_ref: { artifact_id: `geometry-${name}`, artifact_type: "localization_geometry" },
  };
  const seed = `seed-${name}`;
  const artifactId = computeExecutionIdentityArtifactIdV3(subject);
  const signatureRef: ArtifactReference = {
    artifact_id: `lu-identity-attestation-${artifactId}`,
    artifact_type: "outcome_attestation",
  };
  const unsigned: Omit<ExecutionIdentityArtifact, "content_hash"> = {
    artifact_id: artifactId,
    artifact_type: "execution_identity",
    references: [ref(authority.issuer)],
    actor_ref: { artifact_id: LU_EXECUTION_PRINCIPAL_ID, artifact_type: "execution_identity" },
    capability_ref: ref(authority.capability),
    signature_envelope_ref: signatureRef,
    execution_identity_contract_version: LU_EXECUTION_IDENTITY_SCOPE_V3,
    subject_v3: subject,
  };
  const identity: ExecutionIdentityArtifact = {
    ...unsigned,
    content_hash: sha256ContentHash(executionIdentityCanonicalBody(unsigned as ExecutionIdentityArtifact)),
  };
  const attestation = await createArtifactAttestation({
    subjectDigest: identity.content_hash.value,
    predicateType: LU_EXECUTION_IDENTITY_ATTESTATION_PREDICATE_TYPE,
    predicate: buildExecutionIdentityAttestationPredicate({
      execution_identity_id: identity.artifact_id,
      actor_ref: identity.actor_ref,
      capability_ref: identity.capability_ref,
      release_snapshot_id: authority.registry.getReleaseSnapshot().snapshot_id,
      site_id: subject.site_id,
      deterministic_seed: seed,
    }) as unknown as Record<string, unknown>,
    signing: authority.issuerKey.provider,
  });
  await authority.repository.put({ artifact_id: identity.artifact_id, content_hash: identity.content_hash, body: identity });
  await authority.repository.put({ artifact_id: signatureRef.artifact_id, content_hash: sha256ContentHash(attestation), body: attestation });

  const bareStatus = createLuSourceAuthorityTemporalStatusArtifact({
    issuer_ref: ref(authority.issuer),
    subject: identity,
    attempt_ref: deriveLuCanonicalAssessmentAttemptRef(subject),
    lifecycle: authority.lifecycle,
    action: "lu.localization_assessment.persist",
    decision_time: "2026-09-17T12:00:00.000Z",
  });
  const status = {
    ...bareStatus,
    attestation: await attestLuSourceAuthorityTemporalStatus({ status: bareStatus, signing: authority.issuerKey.provider }),
  };
  await authority.repository.put({ artifact_id: status.artifact_id, content_hash: status.content_hash, body: status });
  return { subject, seed, identity };
}

/** The canonical product entrypoint for one provisioned subject; the evidence is stored in CAS first. */
export async function runLuCanonicalSubject(
  authority: LuCanonicalAuthority,
  provisioned: Awaited<ReturnType<typeof provisionLuCanonicalSubject>>,
  input: { readonly evidence: SpatialEvidenceArtifact[]; readonly unavailable_layers?: readonly SpatialLayerUnavailable[] },
) {
  for (const ev of input.evidence) {
    await authority.repository.put({ artifact_id: ev.artifact_id, content_hash: ev.content_hash, body: ev });
  }
  const { subject } = provisioned;
  return runCanonicalLuProductAssessment({
    site_id: subject.site_id,
    deterministic_seed: provisioned.seed,
    evidence: input.evidence,
    unavailable_layers: input.unavailable_layers ?? [],
    artifact_repository: authority.repository,
    registry: authority.registry,
    identity_subject_v3: {
      project_context_binding_ref: subject.project_context_binding_ref,
      product_release_ref: subject.product_release_ref,
      execution_contract_version: subject.execution_contract_version,
      localization_geometry_ref: subject.localization_geometry_ref,
    },
    assessment_draft: {
      site_id: subject.site_id,
      project_context_ref: { artifact_id: `project-${subject.site_id}`, artifact_type: "LU_PROJECT_CONTEXT" },
      property_ref: { artifact_id: subject.site_id, artifact_type: "LU_PROPERTY_CONTEXT" },
      evidence_refs: input.evidence.map((ev) => ({ artifact_id: ev.artifact_id, artifact_type: ev.artifact_type })),
      system_summary: "U30-R3 canonical V4 proof",
      localization_geometry_ref: subject.localization_geometry_ref,
    },
  });
}
