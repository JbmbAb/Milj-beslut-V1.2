import { describe, expect, it, vi } from "vitest";
import type { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactReference";
import type { VerificationKeyProvider } from "@miljobeslut/mimers-brunn-core";
import {
  CanonicalProjectContextReader,
  type ProjectContextBindingAuthorityPort,
  type ProjectContextBindingIndexPort,
} from "../src/context/index.js";

const PROJECT_ID = "project-demo-1";

const verification = {
  keyId: "ed25519:test-issuer",
  async verify() {
    return true;
  },
} as unknown as VerificationKeyProvider;

function ref(id: string, type: string): ArtifactReference {
  return { artifact_id: id, artifact_type: type };
}

function makeBinding(overrides?: Record<string, unknown>) {
  return {
    artifact_id: "binding-1",
    artifact_type: "project_context_binding",
    content_hash: { alg: "sha256", value: "b".repeat(64) },
    payload: {
      project_id: PROJECT_ID,
      binding_version: 1,
      project_context_ref: ref("lu-project-1", "LU_PROJECT_CONTEXT"),
      project_property_binding_ref: ref("ppb-1", "project_property_binding"),
      authority_ref: ref("issuer-1", "project_context_binding_issuer"),
      ...(overrides?.payload as object | undefined),
    },
    attestation: {
      signer: "ed25519:test-issuer",
      predicate: { issuer_version: "project-context-binding-issuer-v1" },
    },
    ...overrides,
  };
}

function makePropertyBinding(overrides?: Record<string, unknown>) {
  return {
    artifact_id: "ppb-1",
    artifact_type: "project_property_binding",
    content_hash: { alg: "sha256", value: "p".repeat(64) },
    payload: {
      project_id: PROJECT_ID,
      property_designation: "ORSA STACKMORA 3:12",
      property_identity: "prop-identity-1",
      geometry_ref: ref("geom-1", "CANONICAL_GEOMETRY"),
      ...(overrides?.payload as object | undefined),
    },
    attestation: {
      signer: "ed25519:test-issuer",
      predicate: { issuer_version: "project-context-binding-issuer-v1" },
    },
    ...overrides,
  };
}

function makeLuProject() {
  return {
    artifact_id: "lu-project-1",
    artifact_type: "LU_PROJECT_CONTEXT",
    payload: {
      project_id: PROJECT_ID,
      property_refs: [ref("lu-prop-1", "LU_PROPERTY_CONTEXT")],
    },
  };
}

function makeLuProperty(geometryId = "geom-1") {
  return {
    artifact_id: "lu-prop-1",
    artifact_type: "LU_PROPERTY_CONTEXT",
    payload: {
      property_ref: "ORSA STACKMORA 3:12",
      official_name: "ORSA STACKMORA 3:12",
      geometry_ref: ref(geometryId, "CANONICAL_GEOMETRY"),
      municipality: "Orsa",
      coordinates: [6777906, 481963] as const,
    },
  };
}

function makeGeometry() {
  return {
    artifact_id: "geom-1",
    artifact_type: "CANONICAL_GEOMETRY",
    payload: {
      geometry: { type: "Polygon" as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    },
  };
}

describe("CanonicalProjectContextReader", () => {
  it("A: valid binding chain → canonical result", async () => {
    const store = new Map<string, unknown>([
      ["binding-1", makeBinding()],
      ["ppb-1", makePropertyBinding()],
      ["lu-project-1", makeLuProject()],
      ["lu-prop-1", makeLuProperty()],
      ["geom-1", makeGeometry()],
    ]);
    const index: ProjectContextBindingIndexPort = {
      listBindingRefs: async () => [ref("binding-1", "project_context_binding")],
      listSupersessionRefs: async () => [],
    };
    const authority: ProjectContextBindingAuthorityPort = {
      verifyArtifactAuthority: vi.fn(async () => undefined),
      verifySupersessionAuthority: vi.fn(async () => undefined),
    };
    // Bypass validateProjectContextBindingAnyVersion by stubbing resolveCurrentBinding path:
    // use a reader with authority that passes, but real validate will fail on toy hashes.
    // So we stub resolveCurrentBinding via a subclass for this structural contract test.
    const reader = new CanonicalProjectContextReader({
      artifactRepository: {
        resolve: async <T>(r: ArtifactReference) => {
          const v = store.get(r.artifact_id);
          if (!v) throw new Error(`missing ${r.artifact_id}`);
          return v as T;
        },
      } as never,
      bindingIndex: index,
      authority,
      verification,
    });

    vi.spyOn(reader, "resolveCurrentBinding").mockResolvedValue(makeBinding() as never);

    const result = await reader.resolve(PROJECT_ID);
    expect(result.propertyDesignation).toBe("ORSA STACKMORA 3:12");
    expect(result.municipality).toBe("Orsa");
    expect(result.propertyIdentity).toBe("prop-identity-1");
    expect(result.propertyContextRef.artifact_id).toBe("lu-prop-1");
    expect(result.contextBindingRef.artifact_id).toBe("binding-1");
    expect(result.coordinates).toEqual([6777906, 481963]);
    expect(authority.verifyArtifactAuthority).toHaveBeenCalled();
  });

  it("B: missing current binding → fail closed", async () => {
    const reader = new CanonicalProjectContextReader({
      artifactRepository: { resolve: async () => { throw new Error("none"); } } as never,
      bindingIndex: {
        listBindingRefs: async () => [],
        listSupersessionRefs: async () => [],
      },
      authority: {
        verifyArtifactAuthority: async () => undefined,
        verifySupersessionAuthority: async () => undefined,
      },
      verification,
    });
    await expect(reader.resolve(PROJECT_ID)).rejects.toThrow(
      /REJECT_PROJECT_CONTEXT_BINDING_CURRENT_UNAVAILABLE/,
    );
  });

  it("C/D: failed authority verifier → fail closed", async () => {
    const reader = new CanonicalProjectContextReader({
      artifactRepository: {
        resolve: async <T>(r: ArtifactReference) => {
          if (r.artifact_type === "project_context_binding") return makeBinding() as T;
          throw new Error(`unexpected ${r.artifact_type}`);
        },
      } as never,
      bindingIndex: {
        listBindingRefs: async () => [ref("binding-1", "project_context_binding")],
        listSupersessionRefs: async () => [],
      },
      authority: {
        verifyArtifactAuthority: async () => {
          throw new Error("REJECT_PROJECT_CONTEXT_BINDING_ATTESTATION_SIGNATURE");
        },
        verifySupersessionAuthority: async () => undefined,
      },
      verification,
    });
    await expect(reader.resolveCurrentBinding(PROJECT_ID)).rejects.toThrow(
      /REJECT_PROJECT_CONTEXT_BINDING_CURRENT_UNAVAILABLE/,
    );
  });

  it("E: missing referenced artifact → fail closed", async () => {
    const reader = new CanonicalProjectContextReader({
      artifactRepository: {
        resolve: async () => {
          throw new Error("CAS miss");
        },
      } as never,
      bindingIndex: {
        listBindingRefs: async () => [ref("binding-1", "project_context_binding")],
        listSupersessionRefs: async () => [],
      },
      authority: {
        verifyArtifactAuthority: async () => undefined,
        verifySupersessionAuthority: async () => undefined,
      },
      verification,
    });
    await expect(reader.resolve(PROJECT_ID)).rejects.toThrow(
      /REJECT_PROJECT_CONTEXT_BINDING_CURRENT_UNAVAILABLE/,
    );
  });

  it("F: invalid property binding project_id → fail closed", async () => {
    const reader = new CanonicalProjectContextReader({
      artifactRepository: {
        resolve: async <T>(r: ArtifactReference) => {
          if (r.artifact_type === "project_property_binding") {
            return makePropertyBinding({
              payload: { project_id: "other-project", property_designation: "X", property_identity: "y", geometry_ref: ref("geom-1", "CANONICAL_GEOMETRY") },
            }) as T;
          }
          if (r.artifact_type === "LU_PROJECT_CONTEXT") return makeLuProject() as T;
          if (r.artifact_type === "LU_PROPERTY_CONTEXT") return makeLuProperty() as T;
          if (r.artifact_type === "CANONICAL_GEOMETRY") return makeGeometry() as T;
          throw new Error(`unexpected ${r.artifact_type}`);
        },
      } as never,
      bindingIndex: {
        listBindingRefs: async () => [],
        listSupersessionRefs: async () => [],
      },
      authority: {
        verifyArtifactAuthority: async () => undefined,
        verifySupersessionAuthority: async () => undefined,
      },
      verification,
    });
    vi.spyOn(reader, "resolveCurrentBinding").mockResolvedValue(makeBinding() as never);
    await expect(reader.resolve(PROJECT_ID)).rejects.toThrow(
      /property binding project_id does not match/,
    );
  });

  it("G: geometry mismatch between property context and binding → fail closed", async () => {
    const reader = new CanonicalProjectContextReader({
      artifactRepository: {
        resolve: async <T>(r: ArtifactReference) => {
          if (r.artifact_type === "project_property_binding") return makePropertyBinding() as T;
          if (r.artifact_type === "LU_PROJECT_CONTEXT") return makeLuProject() as T;
          if (r.artifact_type === "LU_PROPERTY_CONTEXT") return makeLuProperty("geom-OTHER") as T;
          if (r.artifact_type === "CANONICAL_GEOMETRY") return makeGeometry() as T;
          throw new Error(`unexpected ${r.artifact_type}`);
        },
      } as never,
      bindingIndex: {
        listBindingRefs: async () => [],
        listSupersessionRefs: async () => [],
      },
      authority: {
        verifyArtifactAuthority: async () => undefined,
        verifySupersessionAuthority: async () => undefined,
      },
      verification,
    });
    vi.spyOn(reader, "resolveCurrentBinding").mockResolvedValue(makeBinding() as never);
    await expect(reader.resolve(PROJECT_ID)).rejects.toThrow(/geometry does not match/);
  });

  it("static: reader source has no Prisma/SQL/spatial/mint imports", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = await fs.readFile(
      path.join(here, "../src/context/CanonicalProjectContextReader.ts"),
      "utf8",
    );
    const importLines = src
      .split("\n")
      .filter((line) => /^\s*import\s/.test(line))
      .join("\n");
    expect(importLines).not.toMatch(/prisma|PrismaClient|pg['\"]|\$queryRaw|spatial-provider|PostGIS/i);
    expect(importLines).not.toMatch(
      /createProductLuPropertyContextArtifact|executeProjectContextBootstrap|luProjectContextBootstrap/,
    );
    expect(src).not.toMatch(/artifactRepository\.put\(|putCanonical\(/);
  });
});

