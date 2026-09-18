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
  createGovernedLocalizationAssessment,
  GovernedAssessmentPersistence,
} from "../src/governance/GovernedAssessmentPersistence.js";
import {
  verifyLuSourceAuthorityForAssessment,
  type VerifiedLuSourceAuthority,
} from "../src/governance/LuSourceAuthorityWiring.js";
import type { LuSourceAuthorityEvidenceArtifact } from "../src/governance/LuSourceAuthorityEvidence.js";

class RecordingRepository extends InMemoryArtifactRepository {
  readonly writes: Array<{ artifact_id: string; content_hash: ContentHash; body: unknown }> = [];

  override async put(artifact: {
    artifact_id: string;
    content_hash: ContentHash;
    body: unknown;
  }): Promise<void> {
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

async function fixture(siteId: string, seed: string) {
  const repository = new RecordingRepository();
  const rootKey = LocalPemSigningKeyProvider.generate(`ed25519:lu-root-f04-${siteId}`);
  const issuerKey = LocalPemSigningKeyProvider.generate(`ed25519:lu-issuer-f04-${siteId}`);

  process.env.LU_EXECUTION_AUTHORITY_ROOT_KEY_ID = rootKey.provider.keyId;
  process.env.LU_EXECUTION_AUTHORITY_ROOT_PUBLIC_KEY_PEM = rootKey.publicKey;
  process.env.LU_EXECUTION_AUTHORITY_SIGNING_KEY_ID = issuerKey.provider.keyId;
  process.env.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM = issuerKey.publicKey;
  delete process.env.MPS_LU_BOOTSTRAP_ADMIT;
  __resetLuExecutionAuthorityVerifierForTests(null);

  const bareRoot = createLuExecutionAuthorityRootArtifact({
    root_key_id: rootKey.provider.keyId,
    public_key_fingerprint: `root-fingerprint-${siteId}`,
  });
  const root = {
    ...bareRoot,
    attestation: await attestLuExecutionAuthorityRoot({ root: bareRoot, signing: rootKey.provider }),
  };
  const bareIssuer = createLuExecutionAuthorityIssuerArtifact({
    issuer_key_id: issuerKey.provider.keyId,
    public_key_fingerprint: `issuer-fingerprint-${siteId}`,
    root_ref: ref(root),
  });
  const issuer = {
    ...bareIssuer,
    attestation: await attestLuExecutionAuthorityIssuer({
      issuer: bareIssuer,
      root,
      signing: rootKey.provider,
    }),
  };
  await repository.put({ artifact_id: root.artifact_id, content_hash: root.content_hash, body: root });
  await repository.put({ artifact_id: issuer.artifact_id, content_hash: issuer.content_hash, body: issuer });

  const registry = createLuRegistryRuntime();
  const capability = registry.resolveCapabilityByKey(LU_SITE_ASSESSMENT_CAPABILITY_KEY)!;
  const subject: ExecutionIdentitySubjectV3 = {
    site_id: siteId,
    project_context_binding_ref: {
      artifact_id: `binding-${siteId}`,
      artifact_type: "project_context_binding",
    },
    product_release_ref: {
      artifact_id: `release-${siteId}`,
      artifact_type: "product_release_manifest",
    },
    execution_contract_version: "lu-execution-identity-v1",
    localization_geometry_ref: {
      artifact_id: `geometry-${siteId}`,
      artifact_type: "localization_geometry",
    },
  };
  const artifactId = computeExecutionIdentityArtifactIdV3(subject);
  const capabilityRef = ref(capability);
  const signatureRef: ArtifactReference = {
    artifact_id: `lu-identity-attestation-${artifactId}`,
    artifact_type: "outcome_attestation",
  };
  const unsigned: Omit<ExecutionIdentityArtifact, "content_hash"> = {
    artifact_id: artifactId,
    artifact_type: "execution_identity",
    references: [ref(issuer)],
    actor_ref: {
      artifact_id: LU_EXECUTION_PRINCIPAL_ID,
      artifact_type: "execution_identity",
    },
    capability_ref: capabilityRef,
    signature_envelope_ref: signatureRef,
    execution_identity_contract_version: LU_EXECUTION_IDENTITY_SCOPE_V3,
    subject_v3: subject,
  };
  const identity: ExecutionIdentityArtifact = {
    ...unsigned,
    content_hash: sha256ContentHash(
      executionIdentityCanonicalBody(unsigned as ExecutionIdentityArtifact),
    ),
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
  await repository.put({
    artifact_id: signatureRef.artifact_id,
    content_hash: sha256ContentHash(attestation),
    body: attestation,
  });

  return { repository, registry, capability, subject, seed, identity };
}

async function mintAuthority(f: Awaited<ReturnType<typeof fixture>>): Promise<VerifiedLuSourceAuthority> {
  return verifyLuSourceAuthorityForAssessment({
    repository: f.repository,
    execution_identity: f.identity,
    expected_subject_v3: f.subject,
    expected_capability_ref: ref(f.capability),
    release_snapshot_id: f.registry.getReleaseSnapshot().snapshot_id,
    deterministic_seed: f.seed,
  });
}

async function run(f: Awaited<ReturnType<typeof fixture>>) {
  return runCanonicalLuProductAssessment({
    site_id: f.subject.site_id,
    deterministic_seed: f.seed,
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
      project_context_ref: {
        artifact_id: `project-${f.subject.site_id}`,
        artifact_type: "LU_PROJECT_CONTEXT",
      },
      property_ref: {
        artifact_id: f.subject.site_id,
        artifact_type: "LU_PROPERTY_CONTEXT",
      },
      evidence_refs: [],
      system_summary: "04D-R1 F04 cold-audit proof",
      localization_geometry_ref: f.subject.localization_geometry_ref,
    },
  });
}

describe("04D-R1-F04 cold audit — evidence integrity and execution replay binding", () => {
  beforeEach(() => {
    for (const name of ENV) originals.set(name, process.env[name]);
  });

  afterEach(() => {
    for (const name of ENV) {
      const value = originals.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    __resetLuExecutionAuthorityVerifierForTests(null);
  });

  it("F04-A rejects a legitimate verified decision paired with a mutated evidence body and stale hash", async () => {
    const f = await fixture("property-f04-a", "seed-f04-a");
    const result = await run(f);
    const authority = await mintAuthority(f);
    const outcome = await f.repository.resolve<any>({
      artifact_id: result.outcome_id!,
      artifact_type: "execution_outcome",
    });
    const mutatedEvidence: LuSourceAuthorityEvidenceArtifact = {
      ...authority.evidence,
      trust_domain_hash: {
        ...authority.evidence.trust_domain_hash,
        value: "f".repeat(64),
      },
    };
    const writesBefore = f.repository.writes.length;

    await expect(
      new GovernedAssessmentPersistence(
        f.repository,
        () => true,
        { requireAuthorityEvidence: true },
      ).persist({
        artifact: result.assessment!,
        outcome,
        attestation: result.attestation!,
        authority: {
          ...authority,
          evidence: mutatedEvidence,
        },
      }),
    ).rejects.toThrow("authority_evidence_body_hash");

    expect(f.repository.writes.length).toBe(writesBefore);
  });

  it("F04-B rejects replay of legitimate authority A onto an assessment/outcome produced by execution B", async () => {
    const a = await fixture("property-f04-replay-a", "seed-f04-replay-a");
    const authorityA = await mintAuthority(a);

    const b = await fixture("property-f04-replay-b", "seed-f04-replay-b");
    const resultB = await run(b);
    const outcomeB = await b.repository.resolve<any>({
      artifact_id: resultB.outcome_id!,
      artifact_type: "execution_outcome",
    });
    const replayAssessment = createGovernedLocalizationAssessment({
      draft: {
        site_id: b.subject.site_id,
        project_context_ref: {
          artifact_id: `project-${b.subject.site_id}`,
          artifact_type: "LU_PROJECT_CONTEXT",
        },
        property_ref: {
          artifact_id: b.subject.site_id,
          artifact_type: "LU_PROPERTY_CONTEXT",
        },
        evidence_refs: [],
        system_summary: "04D-R1 F04 cross-execution replay probe",
        localization_geometry_ref: b.subject.localization_geometry_ref,
      },
      findings: resultB.findings,
      outcome: outcomeB,
      attestation: resultB.attestation!,
      authority_evidence: authorityA.evidence,
    });
    const writesBefore = b.repository.writes.length;

    await expect(
      new GovernedAssessmentPersistence(
        b.repository,
        () => true,
        { requireAuthorityEvidence: true },
      ).persist({
        artifact: replayAssessment,
        outcome: outcomeB,
        attestation: resultB.attestation!,
        authority: authorityA,
      }),
    ).rejects.toThrow("authority_execution_identity_binding");

    expect(b.repository.writes.length).toBe(writesBefore);
  });
});
