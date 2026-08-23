import { describe, expect, it } from "vitest";
import { InMemoryArtifactRepository } from "../../mps-runtime/src/repository/InMemoryArtifactRepository";
import {
  createProjectContextBindingArtifact,
  createProjectContextBindingArtifactV2,
  validateProjectContextBindingArtifact,
  validateProjectContextBindingArtifactV2,
  validateProjectContextBindingAnyVersion,
  PROJECT_CONTEXT_BINDING_CONTRACT_VERSION_V2,
} from "../src/artifacts/ProjectContextBindingArtifact";
import {
  createProjectContextBindingSupersessionArtifact,
  createProjectContextBindingSupersessionArtifactV2,
  validateProjectContextBindingSupersessionArtifact,
  validateProjectContextBindingSupersessionArtifactV2,
  validateProjectContextBindingSupersessionAnyVersion,
  PROJECT_CONTEXT_BINDING_SUPERSESSION_VERSION,
  PROJECT_CONTEXT_BINDING_SUPERSESSION_VERSION_V2,
} from "../src/artifacts/ProjectContextBindingSupersessionArtifact";

const PROJECT_CONTEXT_REF = { artifact_id: "lu_project_context-env-v2", artifact_type: "LU_PROJECT_CONTEXT" } as const;
const PROPERTY_BINDING_REF = { artifact_id: "project-property-binding-env-v2", artifact_type: "project_property_binding" } as const;
const AUTHORITY_REF = { artifact_id: "pcb-issuer-env-v2", artifact_type: "project_context_binding_issuer" } as const;

describe("ARTIFACT-OPERATIONAL-TEMPORAL-ENVELOPE-V1 (H2/H12) -- ProjectContextBinding V2", () => {
  it("V1 (historical) is completely unaffected: created_at still inside the body, still identity-bearing for content_hash, still verifies under the exact original rule", () => {
    const bindingT1 = createProjectContextBindingArtifact({
      project_id: "proj-1", project_context_ref: PROJECT_CONTEXT_REF, project_property_binding_ref: PROPERTY_BINDING_REF,
      binding_version: "project-context-binding-v2", authority_ref: AUTHORITY_REF, created_at: "2026-01-01T00:00:00.000Z",
    });
    const bindingT2 = createProjectContextBindingArtifact({
      project_id: "proj-1", project_context_ref: PROJECT_CONTEXT_REF, project_property_binding_ref: PROPERTY_BINDING_REF,
      binding_version: "project-context-binding-v2", authority_ref: AUTHORITY_REF, created_at: "2026-01-02T00:00:00.000Z",
    });
    // The known, still-present V1 characteristic this unit does NOT change: same artifact_id,
    // but DIFFERENT content_hash/bytes, because created_at is still inside the V1 body.
    expect(bindingT1.artifact_id).toBe(bindingT2.artifact_id);
    expect(bindingT1.content_hash.value).not.toBe(bindingT2.content_hash.value);
    expect(validateProjectContextBindingArtifact(bindingT1)).toBe(bindingT1);
    expect(validateProjectContextBindingArtifact(bindingT2)).toBe(bindingT2);
  });

  it("CORE PROOF: V2 -- the same semantic binding constructed at two different operational times produces byte-identical artifacts (no created_at parameter exists to differ)", () => {
    const buildArgs = {
      project_id: "proj-2", project_context_ref: PROJECT_CONTEXT_REF, project_property_binding_ref: PROPERTY_BINDING_REF,
      binding_version: "project-context-binding-v2", authority_ref: AUTHORITY_REF,
    };
    const bindingT1 = createProjectContextBindingArtifactV2(buildArgs);
    const bindingT2 = createProjectContextBindingArtifactV2(buildArgs); // simulates a later reconciliation-first retry
    expect(bindingT1.artifact_id).toBe(bindingT2.artifact_id);
    expect(bindingT1.content_hash.value).toBe(bindingT2.content_hash.value);
    expect(JSON.stringify(bindingT1)).toBe(JSON.stringify(bindingT2));
    expect(bindingT1.payload.binding_contract_version).toBe(PROJECT_CONTEXT_BINDING_CONTRACT_VERSION_V2);
  });

  it("CORE PROOF: CAS reuse -- a second put() of the T2 reconstruction against a repository that already has T1 succeeds (no WORM violation), because the bytes are identical", async () => {
    const repo = new InMemoryArtifactRepository();
    const buildArgs = {
      project_id: "proj-3", project_context_ref: PROJECT_CONTEXT_REF, project_property_binding_ref: PROPERTY_BINDING_REF,
      binding_version: "project-context-binding-v2", authority_ref: AUTHORITY_REF,
    };
    const bindingT1 = createProjectContextBindingArtifactV2(buildArgs);
    await repo.put({ artifact_id: bindingT1.artifact_id, content_hash: bindingT1.content_hash, body: bindingT1 });

    const bindingT2 = createProjectContextBindingArtifactV2(buildArgs);
    await expect(repo.put({ artifact_id: bindingT2.artifact_id, content_hash: bindingT2.content_hash, body: bindingT2 })).resolves.toBeUndefined();
  });

  it("V2 validator rejects a tampered/off-contract artifact, and dispatch fails closed on an unknown binding_contract_version", () => {
    const binding = createProjectContextBindingArtifactV2({
      project_id: "proj-4", project_context_ref: PROJECT_CONTEXT_REF, project_property_binding_ref: PROPERTY_BINDING_REF,
      binding_version: "project-context-binding-v2", authority_ref: AUTHORITY_REF,
    });
    expect(validateProjectContextBindingArtifactV2(binding)).toBe(binding);

    const tampered = { ...binding, payload: { ...binding.payload, project_id: "proj-DIFFERENT" } };
    expect(() => validateProjectContextBindingArtifactV2(tampered)).toThrow();

    const unknownVersion = { ...binding, payload: { ...binding.payload, binding_contract_version: "project-context-binding-body-v99" } };
    expect(() => validateProjectContextBindingAnyVersion(unknownVersion as never)).toThrow(/unknown binding_contract_version/);
  });

  it("explicit version dispatch: absent version -> V1 rule, V2 marker -> V2 rule, both real artifacts route correctly", () => {
    const v1 = createProjectContextBindingArtifact({
      project_id: "proj-5", project_context_ref: PROJECT_CONTEXT_REF, project_property_binding_ref: PROPERTY_BINDING_REF,
      binding_version: "project-context-binding-v2", authority_ref: AUTHORITY_REF, created_at: "2026-01-01T00:00:00.000Z",
    });
    const v2 = createProjectContextBindingArtifactV2({
      project_id: "proj-6", project_context_ref: PROJECT_CONTEXT_REF, project_property_binding_ref: PROPERTY_BINDING_REF,
      binding_version: "project-context-binding-v2", authority_ref: AUTHORITY_REF,
    });
    expect(validateProjectContextBindingAnyVersion(v1 as never)).toBe(v1);
    expect(validateProjectContextBindingAnyVersion(v2 as never)).toBe(v2);
  });
});

describe("ARTIFACT-OPERATIONAL-TEMPORAL-ENVELOPE-V1 (H2/H12) -- ProjectContextBindingSupersession V2", () => {
  const supersedeArgs = {
    project_id: "proj-s1",
    superseded_binding_ref: { artifact_id: "project-context-binding-a", artifact_type: "project_context_binding" },
    successor_binding_ref: { artifact_id: "project-context-binding-b", artifact_type: "project_context_binding" },
    reason_code: "TEST_SUPERSESSION",
    issuer_ref: { artifact_id: "pcb-issuer-env-v2", artifact_type: "project_context_binding_issuer" },
    issuer_key_id: "ed25519:pcb-issuer-env-v2",
  } as const;

  it("V1 (historical) is completely unaffected: issued_at still inside the body, same artifact_id but different content_hash at T1 vs T2", () => {
    const t1 = createProjectContextBindingSupersessionArtifact({
      contract_version: PROJECT_CONTEXT_BINDING_SUPERSESSION_VERSION, ...supersedeArgs, issued_at: "2026-01-01T00:00:00.000Z",
    });
    const t2 = createProjectContextBindingSupersessionArtifact({
      contract_version: PROJECT_CONTEXT_BINDING_SUPERSESSION_VERSION, ...supersedeArgs, issued_at: "2026-01-02T00:00:00.000Z",
    });
    expect(t1.artifact_id).toBe(t2.artifact_id);
    expect(t1.content_hash.value).not.toBe(t2.content_hash.value);
  });

  it("CORE PROOF: V2 -- the same semantic transition at two operational times is byte-identical (no issued_at field exists to differ)", () => {
    const t1 = createProjectContextBindingSupersessionArtifactV2(supersedeArgs);
    const t2 = createProjectContextBindingSupersessionArtifactV2(supersedeArgs);
    expect(t1.artifact_id).toBe(t2.artifact_id);
    expect(t1.content_hash.value).toBe(t2.content_hash.value);
    expect(JSON.stringify(t1)).toBe(JSON.stringify(t2));
    expect(t1.payload.contract_version).toBe(PROJECT_CONTEXT_BINDING_SUPERSESSION_VERSION_V2);
  });

  it("CORE PROOF: CAS reuse -- second put() of the T2 reconstruction succeeds without a WORM violation", async () => {
    const repo = new InMemoryArtifactRepository();
    const t1 = createProjectContextBindingSupersessionArtifactV2(supersedeArgs);
    await repo.put({ artifact_id: t1.artifact_id, content_hash: t1.content_hash, body: t1 });
    const t2 = createProjectContextBindingSupersessionArtifactV2(supersedeArgs);
    await expect(repo.put({ artifact_id: t2.artifact_id, content_hash: t2.content_hash, body: t2 })).resolves.toBeUndefined();
  });

  it("explicit version dispatch across both real markers, and fail-closed on unknown", () => {
    const v1 = createProjectContextBindingSupersessionArtifact({ contract_version: PROJECT_CONTEXT_BINDING_SUPERSESSION_VERSION, ...supersedeArgs, issued_at: "2026-01-01T00:00:00.000Z" });
    const v2 = createProjectContextBindingSupersessionArtifactV2(supersedeArgs);
    expect(validateProjectContextBindingSupersessionAnyVersion(v1 as never)).toBe(v1);
    expect(validateProjectContextBindingSupersessionAnyVersion(v2 as never)).toBe(v2);
    const unknown = { ...v2, payload: { ...v2.payload, contract_version: "PROJECT_CONTEXT_BINDING_SUPERSESSION_V99" } };
    expect(() => validateProjectContextBindingSupersessionAnyVersion(unknown as never)).toThrow(/unknown contract_version/);
  });

  it("V2 constructor still rejects successor === predecessor (fork/self-loop guard preserved from V1)", () => {
    expect(() =>
      createProjectContextBindingSupersessionArtifactV2({ ...supersedeArgs, successor_binding_ref: supersedeArgs.superseded_binding_ref }),
    ).toThrow(/successor must differ from predecessor/);
  });
});
