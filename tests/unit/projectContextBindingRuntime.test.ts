import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalPemSigningKeyProvider, LocalPemVerificationKeyProvider } from "@miljobeslut/mimers-brunn-core";
import { MimersIntegration, resetMimersCasCacheForTests } from "@miljobeslut/mps-runtime";
import type { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactReference";
import { sha256ContentHash } from "@miljobeslut/mps-compliance/src/canonical/sha256Canonical";
import {
  createProjectContextBindingArtifact,
  createProjectContextBindingSupersessionArtifact,
  createProjectContextBindingIssuerArtifact,
  createProjectContextBindingSupersessionIssuerArtifact,
  type LocalizationAssessmentArtifact,
} from "@miljobeslut/mps-lu";
import {
  installOwnerIssuedProjectContextBinding,
  installOwnerIssuedProjectContextBindingSupersession,
} from "../../server/modules/localization/installProjectContextBinding";
import {
  authorizeAssessmentPresentation,
  ProjectContextBindingProvider,
} from "../../server/modules/localization/projectContextBindingRuntime";
import {
  attestProjectContextBindingArtifact,
  verifyProjectContextBindingSupersessionAuthority,
} from "../../server/modules/localization/projectContextBindingAuthority";
import {
  attestProjectContextBindingSupersessionArtifact,
  attestProjectContextBindingSupersessionIssuerArtifact,
} from "../../server/modules/localization/projectContextBindingSupersessionAuthority";
import { __resetProjectContextBindingSupersessionVerifierForTests } from "../../server/security/projectContextBindingSupersessionVerifier";
import type { ProjectContextBindingIndex } from "../../server/repositories/projectContextBindingRepository";

class MemoryRepository {
  readonly values = new Map<string, unknown>();

  async put(artifact: { artifact_id: string; body: unknown }): Promise<void> {
    this.values.set(artifact.artifact_id, artifact.body);
  }

  async resolve<T>(reference: ArtifactReference): Promise<T> {
    const value = this.values.get(reference.artifact_id);
    if (!value) throw new Error(`not found: ${reference.artifact_id}`);
    return value as T;
  }
}

class MemoryBindingIndex implements ProjectContextBindingIndex {
  readonly values = new Map<string, string>();
  readonly bindings = new Map<string, ArtifactReference>();
  readonly supersessions = new Map<string, ArtifactReference>();

  private key(projectId: string, context: ArtifactReference): string {
    return `${projectId}:${context.artifact_type}:${context.artifact_id}`;
  }

  async register(binding: ReturnType<typeof createProjectContextBindingArtifact>): Promise<void> {
    const key = this.key(binding.payload.project_id, binding.payload.project_context_ref);
    const existing = this.values.get(key);
    if (existing && existing !== binding.artifact_id) throw new Error("binding collision");
    this.values.set(key, binding.artifact_id);
    this.bindings.set(binding.artifact_id, { artifact_id: binding.artifact_id, artifact_type: binding.artifact_type });
  }

  async resolve(projectId: string, context: ArtifactReference): Promise<string> {
    const bindingId = this.values.get(this.key(projectId, context));
    if (!bindingId) throw new Error("no binding");
    return bindingId;
  }

  async registerSupersession(supersession: ReturnType<typeof createProjectContextBindingSupersessionArtifact>): Promise<void> {
    this.supersessions.set(supersession.artifact_id, {
      artifact_id: supersession.artifact_id,
      artifact_type: supersession.artifact_type,
    });
  }

  async listBindingRefs(projectId: string): Promise<readonly ArtifactReference[]> {
    return [...this.bindings.values()].filter((ref) => {
      const binding = this.values.get(this.key(projectId, contextA)) === ref.artifact_id || this.values.get(this.key(projectId, contextB)) === ref.artifact_id;
      return binding;
    });
  }

  async listSupersessionRefs(_projectId: string): Promise<readonly ArtifactReference[]> {
    return [...this.supersessions.values()];
  }
}

const contextA = { artifact_id: "lu-context-a", artifact_type: "LU_PROJECT_CONTEXT" } as const;
const contextB = { artifact_id: "lu-context-b", artifact_type: "LU_PROJECT_CONTEXT" } as const;
const propertyBinding = { artifact_id: "project-property-binding-a", artifact_type: "project_property_binding" } as const;
const issuerKey = LocalPemSigningKeyProvider.generate("ed25519:project-context-binding-runtime-test");
const verification = new LocalPemVerificationKeyProvider(issuerKey.provider.keyId, issuerKey.publicKey);
const issuer = createProjectContextBindingIssuerArtifact({ issuer_key_id: issuerKey.provider.keyId });
const authority = { artifact_id: issuer.artifact_id, artifact_type: issuer.artifact_type } as const;

// PROJECT-CONTEXT-BINDING-SUPERSESSION-ISSUER-V1: a dedicated, differently-keyed issuer -- never
// the ordinary binding issuer above -- is the only one authorized to sign a supersession.
const supersessionIssuerKey = LocalPemSigningKeyProvider.generate("ed25519:project-context-binding-supersession-runtime-test");

async function installedSupersessionIssuer(repository: { put(a: { artifact_id: string; content_hash?: unknown; body: unknown }): Promise<void> }) {
  process.env.PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_KEY_ID = supersessionIssuerKey.provider.keyId;
  process.env.PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM = supersessionIssuerKey.publicKey;
  __resetProjectContextBindingSupersessionVerifierForTests(null);
  const unsigned = createProjectContextBindingSupersessionIssuerArtifact({
    issuer_key_id: supersessionIssuerKey.provider.keyId,
    owner_authority_ref: authority,
  });
  const supersessionIssuer = {
    ...unsigned,
    attestation: await attestProjectContextBindingSupersessionIssuerArtifact({ issuer: unsigned, signing: supersessionIssuerKey.provider }),
  };
  await repository.put({ artifact_id: supersessionIssuer.artifact_id, content_hash: supersessionIssuer.content_hash, body: supersessionIssuer });
  return { supersessionIssuer, supersessionAuthority: { artifact_id: supersessionIssuer.artifact_id, artifact_type: supersessionIssuer.artifact_type } as const };
}

function assessment(context: ArtifactReference): LocalizationAssessmentArtifact {
  return {
    artifact_id: "assessment-1",
    artifact_type: "LOCALIZATION_ASSESSMENT",
    content_hash: sha256ContentHash({ assessment: context }),
    references: [context],
    payload: {
      project_context_ref: context,
      property_ref: { artifact_id: "property-1", artifact_type: "LU_PROPERTY_CONTEXT" },
      execution_outcome_ref: { artifact_id: "outcome-1", artifact_type: "execution_outcome" },
      outcome_attestation_ref: { artifact_id: "attestation-1", artifact_type: "outcome_attestation" },
      findings: [],
      evidence_refs: [],
      rule_refs: [],
      system_summary: "test",
    },
  };
}

async function installedBinding() {
  const repository = new MemoryRepository();
  const index = new MemoryBindingIndex();
  await repository.put({ artifact_id: authority.artifact_id, body: issuer });
  const binding = createProjectContextBindingArtifact({
    project_id: "project-a",
    project_context_ref: contextA,
    project_property_binding_ref: propertyBinding,
    binding_version: "project-context-binding-v1",
    authority_ref: authority,
    created_at: "2026-08-20T12:00:00.000Z",
  });
  const signedBinding = {
    ...binding,
    attestation: await attestProjectContextBindingArtifact({ artifact: binding, issuer, signing: issuerKey.provider }),
  };
  await installOwnerIssuedProjectContextBinding({
    artifactRepository: repository,
    index,
    binding: signedBinding,
    verification,
  });
  return { repository, index, binding: signedBinding };
}

describe("P3-LU-PROJECT-CONTEXT-BINDING-RUNTIME-01", () => {
  it("fails closed when no owner-installed binding exists", async () => {
    const provider = new ProjectContextBindingProvider(new MemoryRepository(), new MemoryBindingIndex(), verification);
    await expect(provider.resolve("project-a", contextA)).rejects.toThrow(
      "REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE",
    );
  });

  it("persists an owner-issued binding and resolves the exact CAS artifact", async () => {
    const { repository, index, binding } = await installedBinding();
    const resolved = await new ProjectContextBindingProvider(repository, index, verification).resolve("project-a", contextA);
    expect(resolved.artifact_id).toBe(binding.artifact_id);
    expect(resolved.payload.authority_ref).toEqual(authority);
    expect(repository.values.get(binding.artifact_id)).toEqual(binding);
  });

  it("rejects a malformed owner candidate before it can enter CAS or the index", async () => {
    const repository = new MemoryRepository();
    const index = new MemoryBindingIndex();
    await repository.put({ artifact_id: authority.artifact_id, body: issuer });
    const candidate = createProjectContextBindingArtifact({
      project_id: "project-a",
      project_context_ref: contextA,
      project_property_binding_ref: propertyBinding,
      binding_version: "project-context-binding-v1",
      authority_ref: authority,
      created_at: "2026-08-20T12:00:00.000Z",
    });
    const malformed = { ...candidate, content_hash: sha256ContentHash({ forged: true }) };
    await expect(
      installOwnerIssuedProjectContextBinding({ artifactRepository: repository, index, binding: malformed, verification }),
    ).rejects.toThrow("content_hash does not match canonical body");
    await expect(index.resolve("project-a", contextA)).rejects.toThrow("no binding");
    expect(repository.values.has(candidate.artifact_id)).toBe(false);
  });

  it("rejects an owner candidate whose bound authority is not resolvable", async () => {
    const repository = new MemoryRepository();
    const index = new MemoryBindingIndex();
    const candidate = createProjectContextBindingArtifact({
      project_id: "project-a",
      project_context_ref: contextA,
      project_property_binding_ref: propertyBinding,
      binding_version: "project-context-binding-v1",
      authority_ref: authority,
      created_at: "2026-08-20T12:00:00.000Z",
    });
    await expect(
      installOwnerIssuedProjectContextBinding({ artifactRepository: repository, index, binding: candidate, verification }),
    ).rejects.toThrow("not found");
    expect(repository.values.has(candidate.artifact_id)).toBe(false);
  });

  it("allows an accessible project only when its assessment context is bound exactly", async () => {
    const { repository, index } = await installedBinding();
    const allowed = await authorizeAssessmentPresentation({
      projectId: "project-a",
      assessment: assessment(contextA),
      assertProjectAccess: async () => undefined,
      bindingProvider: new ProjectContextBindingProvider(repository, index, verification),
    });
    expect(allowed.payload.project_context_ref).toEqual(contextA);
  });

  it("denies a context from another project even when the caller can access the requested project", async () => {
    const { repository, index } = await installedBinding();
    await expect(
      authorizeAssessmentPresentation({
        projectId: "project-a",
        assessment: assessment(contextB),
        assertProjectAccess: async () => undefined,
        bindingProvider: new ProjectContextBindingProvider(repository, index, verification),
      }),
    ).rejects.toThrow("REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE");
  });

  it("denies a CAS binding whose body no longer has a valid authority attestation", async () => {
    const { repository, index, binding } = await installedBinding();
    const forged = createProjectContextBindingArtifact({
      project_id: "project-b",
      project_context_ref: contextA,
      project_property_binding_ref: propertyBinding,
      binding_version: binding.payload.binding_version,
      authority_ref: authority,
      created_at: binding.payload.created_at,
    });
    repository.values.set(binding.artifact_id, forged);
    await expect(
      new ProjectContextBindingProvider(repository, index, verification).resolve("project-a", contextA),
    ).rejects.toThrow("REJECT_PROJECT_CONTEXT_BINDING_AUTHORITY_INVALID");
  });

  it("denies an inaccessible project before resolving a binding", async () => {
    const { repository, index } = await installedBinding();
    let indexCalls = 0;
    const guardedProvider = new ProjectContextBindingProvider(repository, {
      register: index.register.bind(index),
      registerSupersession: index.registerSupersession.bind(index),
      resolve: async (...args) => {
        indexCalls += 1;
        return index.resolve(...args);
      },
      listBindingRefs: index.listBindingRefs.bind(index),
      listSupersessionRefs: index.listSupersessionRefs.bind(index),
    }, verification);
    await expect(
      authorizeAssessmentPresentation({
        projectId: "project-a",
        assessment: assessment(contextA),
        assertProjectAccess: async () => {
          throw new Error("access denied");
        },
        bindingProvider: guardedProvider,
      }),
    ).rejects.toThrow("access denied");
    expect(indexCalls).toBe(0);
  });

  it("resolves a verified supersession successor as the only current head after fresh construction", async () => {
    const repository = new MemoryRepository();
    const index = new MemoryBindingIndex();
    const v2Issuer = createProjectContextBindingIssuerArtifact({
      issuer_key_id: issuerKey.provider.keyId,
      issuer_version: "project-context-binding-issuer-v2",
    });
    const v2Authority = { artifact_id: v2Issuer.artifact_id, artifact_type: v2Issuer.artifact_type } as const;
    await repository.put({ artifact_id: v2Issuer.artifact_id, body: v2Issuer });
    const { supersessionIssuer, supersessionAuthority } = await installedSupersessionIssuer(repository);
    const oldBinding = createProjectContextBindingArtifact({
      project_id: "project-a", project_context_ref: contextA, project_property_binding_ref: propertyBinding,
      binding_version: "project-context-binding-v1", authority_ref: v2Authority, created_at: "2026-08-20T12:00:00.000Z",
    });
    const corrected = createProjectContextBindingArtifact({
      project_id: "project-a", project_context_ref: contextB, project_property_binding_ref: propertyBinding,
      binding_version: "project-context-binding-v1", authority_ref: v2Authority, created_at: "2026-08-21T12:00:00.000Z",
    });
    const signedOld = { ...oldBinding, attestation: await attestProjectContextBindingArtifact({ artifact: oldBinding, issuer: v2Issuer, signing: issuerKey.provider }) };
    const signedCorrected = { ...corrected, attestation: await attestProjectContextBindingArtifact({ artifact: corrected, issuer: v2Issuer, signing: issuerKey.provider }) };
    await installOwnerIssuedProjectContextBinding({ artifactRepository: repository, index, binding: signedOld, verification });
    await installOwnerIssuedProjectContextBinding({ artifactRepository: repository, index, binding: signedCorrected, verification });
    const relation = createProjectContextBindingSupersessionArtifact({
      contract_version: "PROJECT_CONTEXT_BINDING_SUPERSESSION_V1", project_id: "project-a",
      superseded_binding_ref: { artifact_id: signedOld.artifact_id, artifact_type: signedOld.artifact_type },
      successor_binding_ref: { artifact_id: signedCorrected.artifact_id, artifact_type: signedCorrected.artifact_type },
      reason_code: "CANONICAL_PROPERTY_COORDINATE_ORDER_CORRECTION", issuer_ref: supersessionAuthority,
      issuer_key_id: supersessionIssuerKey.provider.keyId, issued_at: "2026-08-21T13:00:00.000Z",
    });
    const signedRelation = { ...relation, attestation: await attestProjectContextBindingSupersessionArtifact({ artifact: relation, issuer: supersessionIssuer, signing: supersessionIssuerKey.provider }) };
    const current = await installOwnerIssuedProjectContextBindingSupersession({ artifactRepository: repository, index, supersession: signedRelation, verification });
    expect(current.artifact_id).toBe(signedCorrected.artifact_id);
    expect(await new ProjectContextBindingProvider(repository, index, verification).resolve("project-a", contextA)).toEqual(signedOld);
    expect(await new ProjectContextBindingProvider(repository, index, verification).resolveCurrent("project-a")).toEqual(signedCorrected);
  });

  it("rejects supersession authority at mint time from the ordinary V1 binding issuer (scope-closed)", async () => {
    const oldBinding = createProjectContextBindingArtifact({
      project_id: "project-a", project_context_ref: contextA, project_property_binding_ref: propertyBinding,
      binding_version: "project-context-binding-v1", authority_ref: authority, created_at: "2026-08-20T12:00:00.000Z",
    });
    const corrected = createProjectContextBindingArtifact({
      project_id: "project-a", project_context_ref: contextB, project_property_binding_ref: propertyBinding,
      binding_version: "project-context-binding-v1", authority_ref: authority, created_at: "2026-08-21T12:00:00.000Z",
    });
    const relation = createProjectContextBindingSupersessionArtifact({
      contract_version: "PROJECT_CONTEXT_BINDING_SUPERSESSION_V1", project_id: "project-a",
      superseded_binding_ref: { artifact_id: oldBinding.artifact_id, artifact_type: oldBinding.artifact_type },
      successor_binding_ref: { artifact_id: corrected.artifact_id, artifact_type: corrected.artifact_type },
      reason_code: "CORRECTION", issuer_ref: authority, issuer_key_id: issuerKey.provider.keyId,
      issued_at: "2026-08-21T13:00:00.000Z",
    });
    // The ordinary V1 issuer's allowed_artifact_types never includes supersession -- proven
    // already at mint time via the ordinary (non-dedicated) attest function.
    await expect(attestProjectContextBindingArtifact({ artifact: relation, issuer, signing: issuerKey.provider }))
      .rejects.toThrow("REJECT_PROJECT_CONTEXT_BINDING_ISSUER_SCOPE");
  });

  it("PROJECT-CONTEXT-BINDING-SUPERSESSION-ISSUER-V1: a real historical supersession minted under the old scope-widened ordinary issuer remains verifiable forever, frozen to its own original rule", async () => {
    // Exactly one real supersession in production was minted this way before this dedicated issuer
    // existed (project-context-binding-supersession-4890a5ab5abed82ada799e97). Historical artifact
    // versions are never rehashed or reinterpreted under a later rule -- this proves the legacy
    // dispatch branch keeps that one real artifact verifiable, without making the widened-issuer
    // path a sanctioned route for any NEW work (nothing in this codebase mints this way any more).
    const repository = new MemoryRepository();
    process.env.PROJECT_CONTEXT_BINDING_ISSUER_KEY_ID = issuerKey.provider.keyId;
    process.env.PROJECT_CONTEXT_BINDING_ISSUER_PUBLIC_KEY_PEM = issuerKey.publicKey;
    const v2Issuer = createProjectContextBindingIssuerArtifact({
      issuer_key_id: issuerKey.provider.keyId,
      issuer_version: "project-context-binding-issuer-v2",
    });
    const v2Authority = { artifact_id: v2Issuer.artifact_id, artifact_type: v2Issuer.artifact_type } as const;
    await repository.put({ artifact_id: v2Issuer.artifact_id, body: v2Issuer });
    const relation = createProjectContextBindingSupersessionArtifact({
      contract_version: "PROJECT_CONTEXT_BINDING_SUPERSESSION_V1", project_id: "project-a",
      superseded_binding_ref: { artifact_id: "irrelevant-old", artifact_type: "project_context_binding" },
      successor_binding_ref: { artifact_id: "irrelevant-new", artifact_type: "project_context_binding" },
      reason_code: "CANONICAL_PROPERTY_COORDINATE_ORDER_CORRECTION", issuer_ref: v2Authority, issuer_key_id: issuerKey.provider.keyId,
      issued_at: "2026-08-21T13:00:00.000Z",
    });
    const signed = { ...relation, attestation: await attestProjectContextBindingArtifact({ artifact: relation, issuer: v2Issuer, signing: issuerKey.provider }) };
    await expect(
      verifyProjectContextBindingSupersessionAuthority({ artifact: signed, artifactRepository: repository }),
    ).resolves.toBeUndefined();
    delete process.env.PROJECT_CONTEXT_BINDING_ISSUER_KEY_ID;
    delete process.env.PROJECT_CONTEXT_BINDING_ISSUER_PUBLIC_KEY_PEM;
  });

  it("PROJECT-CONTEXT-BINDING-SUPERSESSION-ISSUER-V1 negative proof: an issuer_ref that resolves to neither the ordinary nor the dedicated supersession issuer is rejected", async () => {
    const repository = new MemoryRepository();
    await repository.put({ artifact_id: "not-an-issuer", body: { artifact_id: "not-an-issuer", artifact_type: "product_release", payload: {} } });
    const relation = createProjectContextBindingSupersessionArtifact({
      contract_version: "PROJECT_CONTEXT_BINDING_SUPERSESSION_V1", project_id: "project-a",
      superseded_binding_ref: { artifact_id: "irrelevant-old", artifact_type: "project_context_binding" },
      successor_binding_ref: { artifact_id: "irrelevant-new", artifact_type: "project_context_binding" },
      reason_code: "CORRECTION", issuer_ref: { artifact_id: "not-an-issuer", artifact_type: "product_release" }, issuer_key_id: issuerKey.provider.keyId,
      issued_at: "2026-08-21T13:00:00.000Z",
    });
    const forged = {
      ...relation,
      attestation: { signer: issuerKey.provider.keyId, subjectDigest: "x", predicateType: "x", predicate: {}, signature: "x", alg: "ed25519" as const },
    };
    await expect(
      verifyProjectContextBindingSupersessionAuthority({ artifact: forged, artifactRepository: repository }),
    ).rejects.toThrow("REJECT_PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_TYPE");
  });

  it("freshly reopens persistent CAS and derives the same verified current head from a rebuilt projection", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "project-context-supersession-"));
    try {
      const env = { MIMERS_ROOT: root, MIMERS_REQUIRED: "1", MIMERS_DURABILITY_MODE: "none" } as NodeJS.ProcessEnv;
      const first = await MimersIntegration.create({ env, forceMimers: true });
      const firstIndex = new MemoryBindingIndex();
      const v2Issuer = createProjectContextBindingIssuerArtifact({ issuer_key_id: issuerKey.provider.keyId, issuer_version: "project-context-binding-issuer-v2" });
      const v2Authority = { artifact_id: v2Issuer.artifact_id, artifact_type: v2Issuer.artifact_type } as const;
      await first.artifactRepository.put({ artifact_id: v2Issuer.artifact_id, content_hash: v2Issuer.content_hash, body: v2Issuer });
      const { supersessionIssuer, supersessionAuthority } = await installedSupersessionIssuer(first.artifactRepository);
      const oldBinding = createProjectContextBindingArtifact({ project_id: "project-a", project_context_ref: contextA, project_property_binding_ref: propertyBinding, binding_version: "v1", authority_ref: v2Authority, created_at: "2026-08-20T00:00:00.000Z" });
      const successor = createProjectContextBindingArtifact({ project_id: "project-a", project_context_ref: contextB, project_property_binding_ref: propertyBinding, binding_version: "v1", authority_ref: v2Authority, created_at: "2026-08-21T00:00:00.000Z" });
      const signedOld = { ...oldBinding, attestation: await attestProjectContextBindingArtifact({ artifact: oldBinding, issuer: v2Issuer, signing: issuerKey.provider }) };
      const signedSuccessor = { ...successor, attestation: await attestProjectContextBindingArtifact({ artifact: successor, issuer: v2Issuer, signing: issuerKey.provider }) };
      await installOwnerIssuedProjectContextBinding({ artifactRepository: first.artifactRepository, index: firstIndex, binding: signedOld, verification });
      await installOwnerIssuedProjectContextBinding({ artifactRepository: first.artifactRepository, index: firstIndex, binding: signedSuccessor, verification });
      const unsigned = createProjectContextBindingSupersessionArtifact({ contract_version: "PROJECT_CONTEXT_BINDING_SUPERSESSION_V1", project_id: "project-a", superseded_binding_ref: { artifact_id: signedOld.artifact_id, artifact_type: signedOld.artifact_type }, successor_binding_ref: { artifact_id: signedSuccessor.artifact_id, artifact_type: signedSuccessor.artifact_type }, reason_code: "CORRECTION", issuer_ref: supersessionAuthority, issuer_key_id: supersessionIssuerKey.provider.keyId, issued_at: "2026-08-21T01:00:00.000Z" });
      const signed = { ...unsigned, attestation: await attestProjectContextBindingSupersessionArtifact({ artifact: unsigned, issuer: supersessionIssuer, signing: supersessionIssuerKey.provider }) };
      await installOwnerIssuedProjectContextBindingSupersession({ artifactRepository: first.artifactRepository, index: firstIndex, supersession: signed, verification });
      resetMimersCasCacheForTests();
      const reopened = await MimersIntegration.create({ env, forceMimers: true });
      const rebuiltIndex = new MemoryBindingIndex();
      await rebuiltIndex.register(signedOld); await rebuiltIndex.register(signedSuccessor); await rebuiltIndex.registerSupersession(signed);
      await expect(new ProjectContextBindingProvider(reopened.artifactRepository, rebuiltIndex, verification).resolveCurrent("project-a"))
        .resolves.toMatchObject({ artifact_id: signedSuccessor.artifact_id });
    } finally {
      resetMimersCasCacheForTests();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps minting and persistence outside the runtime presentation resolver", async () => {
    const [runtime, authorization] = await Promise.all([
      readFile("server/modules/localization/projectContextBindingRuntime.ts", "utf8"),
      readFile("server/modules/localization/installProjectContextBinding.ts", "utf8"),
    ]);
    expect(runtime).not.toContain("artifactRepository.put");
    expect(runtime).not.toContain("createProjectContextBindingArtifact");
    expect(authorization).toContain("artifactRepository.put");
  });
});
