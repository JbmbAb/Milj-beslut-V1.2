import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LocalPemSigningKeyProvider,
  createArtifactAttestation,
} from "../../mimers-brunn-core/src/index.js";
import { sha256ContentHash } from "../../mps-compliance/src/canonical/sha256Canonical.js";
import type { ArtifactReference } from "../../mps-compliance/src/artifacts/ArtifactReference.js";
import {
  createLuExecutionAuthorityIssuerArtifact,
  createLuExecutionAuthorityRootArtifact,
} from "../src/artifacts/LuExecutionAuthorityArtifact.js";
import {
  attestLuExecutionAuthorityIssuer,
  attestLuExecutionAuthorityRoot,
} from "../src/execution/LuExecutionAuthorityChain.js";
import {
  buildExecutionIdentityAttestationPredicate,
  executionIdentityCanonicalBody,
  LU_EXECUTION_IDENTITY_ATTESTATION_PREDICATE_TYPE,
} from "../src/execution/ExecutionIdentityAttestation.js";
import { __resetLuExecutionAuthorityVerifierForTests } from "../src/execution/LuExecutionAuthorityVerifier.js";
import {
  LU_EXECUTION_PRINCIPAL_ID,
  runCanonicalLuProductAssessment,
} from "../src/execution/LuExecutionKernelClient.js";
import { createLuRegistryRuntime } from "../src/registry/createLuRegistryRuntime.js";
import { LU_SITE_ASSESSMENT_CAPABILITY_KEY } from "../src/registry/LuSiteAssessmentRegistry.js";
import {
  computeExecutionIdentityArtifactIdV3,
  LU_EXECUTION_IDENTITY_SCOPE_V3,
  type ExecutionIdentitySubjectV3,
} from "../../mps-runtime/src/execution/ExecutionIdentityScopeV2.js";
import type { ExecutionIdentityArtifact } from "../../mps-runtime/src/execution/ExecutionIdentityArtifact.js";
import { InMemoryArtifactRepository } from "../../mps-runtime/src/repository/InMemoryArtifactRepository.js";
import type { ContentHash } from "../../mps-compliance/src/artifacts/ContentHash.js";
import {
  GovernedAssessmentPersistence,
  type AssessmentAuthorityBinding,
} from "../src/governance/GovernedAssessmentPersistence.js";
import type { LuSourceAuthorityEvidenceArtifact } from "../src/governance/LuSourceAuthorityEvidence.js";
import {
  attestLuSourceAuthorityTemporalStatus,
  createLuSourceAuthorityTemporalStatusArtifact,
} from "../src/governance/LuSourceAuthorityTemporalStatus.js";
import { deriveLuCanonicalAssessmentAttemptRef } from "../src/governance/LuSourceAuthorityWiring.js";

class RecordingRepository extends InMemoryArtifactRepository {
  readonly writes: Array<{ artifact_id: string; content_hash: ContentHash; body: unknown }> = [];
  override async put(artifact: { artifact_id: string; content_hash: ContentHash; body: unknown }): Promise<void> {
    this.writes.push(artifact);
    await super.put(artifact);
  }
}

const ENV = [
  "MPS_LU_BOOTSTRAP_ADMIT",
  "LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM",
  "LU_EXECUTION_AUTHORITY_SIGNING_KEY_ID",
  "LU_EXECUTION_AUTHORITY_ROOT_PUBLIC_KEY_PEM",
  "LU_EXECUTION_AUTHORITY_ROOT_KEY_ID",
] as const;
const originals = new Map<string, string | undefined>();

function ref(artifact: { readonly artifact_id: string; readonly artifact_type: string }): ArtifactReference {
  return { artifact_id: artifact.artifact_id, artifact_type: artifact.artifact_type };
}

async function fixture(options: { readonly actor_ref?: ArtifactReference; readonly signed_seed?: string } = {}) {
  const repository = new RecordingRepository();
  const rootKey = LocalPemSigningKeyProvider.generate("ed25519:lu-root-04d");
  const issuerKey = LocalPemSigningKeyProvider.generate("ed25519:lu-issuer-04d");

  process.env.LU_EXECUTION_AUTHORITY_ROOT_KEY_ID = rootKey.provider.keyId;
  process.env.LU_EXECUTION_AUTHORITY_ROOT_PUBLIC_KEY_PEM = rootKey.publicKey;
  process.env.LU_EXECUTION_AUTHORITY_SIGNING_KEY_ID = issuerKey.provider.keyId;
  process.env.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM = issuerKey.publicKey;
  delete process.env.MPS_LU_BOOTSTRAP_ADMIT;
  __resetLuExecutionAuthorityVerifierForTests(null);

  const bareRoot = createLuExecutionAuthorityRootArtifact({
    root_key_id: rootKey.provider.keyId,
    public_key_fingerprint: "root-fingerprint-04d",
  });
  const root = { ...bareRoot, attestation: await attestLuExecutionAuthorityRoot({ root: bareRoot, signing: rootKey.provider }) };
  const bareIssuer = createLuExecutionAuthorityIssuerArtifact({
    issuer_key_id: issuerKey.provider.keyId,
    public_key_fingerprint: "issuer-fingerprint-04d",
    root_ref: ref(root),
  });
  const issuer = {
    ...bareIssuer,
    attestation: await attestLuExecutionAuthorityIssuer({ issuer: bareIssuer, root, signing: rootKey.provider }),
  };
  await repository.put({ artifact_id: root.artifact_id, content_hash: root.content_hash, body: root });
  await repository.put({ artifact_id: issuer.artifact_id, content_hash: issuer.content_hash, body: issuer });

  const registry = createLuRegistryRuntime();
  const capability = registry.resolveCapabilityByKey(LU_SITE_ASSESSMENT_CAPABILITY_KEY)!;
  const subject: ExecutionIdentitySubjectV3 = {
    site_id: "property-04d",
    project_context_binding_ref: { artifact_id: "binding-04d", artifact_type: "project_context_binding" },
    product_release_ref: { artifact_id: "release-04d", artifact_type: "product_release_manifest" },
    execution_contract_version: "lu-execution-identity-v1",
    localization_geometry_ref: { artifact_id: "geometry-04d", artifact_type: "localization_geometry" },
  };
  const seed = options.signed_seed ?? "seed-04d";
  const artifactId = computeExecutionIdentityArtifactIdV3(subject);
  const actorRef: ArtifactReference = options.actor_ref ?? {
    artifact_id: LU_EXECUTION_PRINCIPAL_ID,
    artifact_type: "execution_identity",
  };
  const capabilityRef = ref(capability);
  const signatureRef: ArtifactReference = {
    artifact_id: `lu-identity-attestation-${artifactId}`,
    artifact_type: "outcome_attestation",
  };
  const unsigned: Omit<ExecutionIdentityArtifact, "content_hash"> = {
    artifact_id: artifactId,
    artifact_type: "execution_identity",
    references: [ref(issuer)],
    actor_ref: actorRef,
    capability_ref: capabilityRef,
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
      release_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
      site_id: subject.site_id,
      deterministic_seed: seed,
    }) as unknown as Record<string, unknown>,
    signing: issuerKey.provider,
  });
  await repository.put({ artifact_id: identity.artifact_id, content_hash: identity.content_hash, body: identity });
  await repository.put({ artifact_id: signatureRef.artifact_id, content_hash: sha256ContentHash(attestation), body: attestation });

  const attemptRef = deriveLuCanonicalAssessmentAttemptRef(subject);
  const bareStatus = createLuSourceAuthorityTemporalStatusArtifact({
    issuer_ref: ref(issuer),
    subject: identity,
    attempt_ref: attemptRef,
    action: "lu.localization_assessment.persist",
    valid_from: "2026-01-01T00:00:00.000Z",
    valid_until: "2027-01-01T00:00:00.000Z",
    decision_time: "2026-09-17T12:00:00.000Z",
    revoked_at: null,
  });
  const status = {
    ...bareStatus,
    attestation: await attestLuSourceAuthorityTemporalStatus({ status: bareStatus, signing: issuerKey.provider }),
  };
  await repository.put({ artifact_id: status.artifact_id, content_hash: status.content_hash, body: status });

  return { repository, registry, capability, subject, seed, identity, status, attemptRef };
}

async function run(f: Awaited<ReturnType<typeof fixture>>, seed = f.seed) {
  return runCanonicalLuProductAssessment({
    site_id: f.subject.site_id,
    deterministic_seed: seed,
    evidence: [],
    artifact_repository: f.repository,
    registry: f.registry,
    identity_subject_v3: {
      project_context_binding_ref: f.subject.project_context_binding_ref,
      product_release_ref: f.subject.product_release_ref,
      execution_contract_version: f.subject.execution_contract_version,
      localization_geometry_ref: f.subject.localization_geometry_ref,
    },
    assessment_draft: {
      site_id: f.subject.site_id,
      project_context_ref: { artifact_id: "project-04d", artifact_type: "LU_PROJECT_CONTEXT" },
      property_ref: { artifact_id: f.subject.site_id, artifact_type: "LU_PROPERTY_CONTEXT" },
      evidence_refs: [],
      system_summary: "04D source-authority proof",
      localization_geometry_ref: f.subject.localization_geometry_ref,
    },
  });
}

describe("MINIMUM-AUTHORITY-DELTA-04D — LU source authority wiring", () => {
  beforeEach(() => { for (const name of ENV) originals.set(name, process.env[name]); });
  afterEach(() => {
    for (const name of ENV) {
      const value = originals.get(name);
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    __resetLuExecutionAuthorityVerifierForTests(null);
  });

  it("binds verified root -> issuer -> ExecutionIdentity and exact-attempt temporal status to one AuthorityEvidence", async () => {
    const f = await fixture();
    const result = await run(f);
    expect(result.admitted).toBe(true);
    expect(result.assessment).not.toBeNull();
    expect(result.assessment?.payload.assessment_contract_version).toBe("localization-assessment-v4");
    const authorityRef = result.assessment?.payload.authority_evidence_ref;
    expect(authorityRef?.artifact_type).toBe("authority_evidence");
    expect(result.assessment?.references.filter((candidate) => candidate.artifact_type === "authority_evidence")).toEqual([authorityRef]);

    const evidence = await f.repository.resolve<LuSourceAuthorityEvidenceArtifact>(authorityRef!);
    expect(evidence.authority_evidence_contract_version).toBe("lu-source-authority-evidence-v2");
    expect(evidence.authority_claim_state).toBe("UNVERIFIED_REPRESENTATION");
    expect("authorized_at_decision_time" in evidence).toBe(false);
    expect("authorized_now" in evidence).toBe(false);
    expect(evidence.decision_time).toBe(f.status.payload.decision_time);
    expect(evidence.temporal_status_ref?.artifact_id).toBe(f.status.artifact_id);
    expect(evidence.action).toBe("lu.localization_assessment.persist");
    expect(evidence.authority_path.map((entry) => entry.role)).toEqual(["root", "issuer", "subject"]);
    expect(evidence.authority_path[2]?.artifact_ref.artifact_id).toBe(f.identity.artifact_id);
  });

  it("same exact canonical state is replay of the same attempt and reuses authority/assessment identity", async () => {
    const f = await fixture();
    const first = await run(f);
    const second = await run(f);
    expect(first.admitted).toBe(true);
    expect(second.admitted).toBe(true);
    expect(first.attempt_id).toBe(f.attemptRef.artifact_id);
    expect(second.attempt_id).toBe(first.attempt_id);
    expect(second.assessment?.artifact_id).toBe(first.assessment?.artifact_id);
    expect(second.assessment?.payload.authority_evidence_ref).toEqual(first.assessment?.payload.authority_evidence_ref);
  });

  it("denies a correctly signed identity for a caller-chosen actor before the assessment mutation", async () => {
    const f = await fixture({ actor_ref: { artifact_id: "attacker-chosen-actor", artifact_type: "execution_identity" } });
    await expect(run(f)).rejects.toThrow("execution identity actor is not the canonical LU principal");
    expect(f.repository.writes.some((write) => write.body && (write.body as { artifact_type?: string }).artifact_type === "LOCALIZATION_ASSESSMENT")).toBe(false);
  });

  it("denies a different deterministic seed and produces no authority-backed assessment", async () => {
    const f = await fixture();
    const result = await run(f, "different-seed-04d");
    expect(result.admitted).toBe(false);
    expect(result.assessment).toBeNull();
  });

  it("does not accept a caller-fabricated positive decision object at persistence", async () => {
    const f = await fixture();
    const result = await run(f);
    const assessment = result.assessment!;
    const evidence = await f.repository.resolve<LuSourceAuthorityEvidenceArtifact>(assessment.payload.authority_evidence_ref!);
    const outcome = await f.repository.resolve<any>({ artifact_id: result.outcome_id!, artifact_type: "execution_outcome" });
    const forged: AssessmentAuthorityBinding = {
      decision: {
        source_authority_verified: true,
        authorized_at_decision_time: true,
        decision_time: f.status.payload.decision_time,
        attempt_ref: f.attemptRef,
        action: evidence.action,
        authority_scope: evidence.authority_scope,
        evidence_ref: { artifact_id: evidence.artifact_id, artifact_type: "authority_evidence" },
        evidence_hash: evidence.content_hash,
        temporal_status_ref: { artifact_id: f.status.artifact_id, artifact_type: f.status.artifact_type },
        temporal_status_hash: f.status.content_hash,
        subject_ref: evidence.authority_path[2]!.artifact_ref,
        subject_hash: evidence.authority_path[2]!.content_hash,
      },
      evidence,
      supporting_artifacts: [],
    };
    await expect(
      new GovernedAssessmentPersistence(f.repository, () => true, { requireAuthorityEvidence: true }).persist({
        artifact: assessment,
        outcome,
        attestation: result.attestation!,
        authority: forged,
      }),
    ).rejects.toThrow("authority_decision_unverified");
  });
});
