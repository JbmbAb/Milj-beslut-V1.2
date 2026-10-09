import { describe, expect, it, vi } from "vitest";

const resolveMock = vi.fn(async () => ({
  projectContextRef: { artifact_id: "lu-project-1", artifact_type: "LU_PROJECT_CONTEXT" },
  propertyContextRef: { artifact_id: "lu-prop-1", artifact_type: "LU_PROPERTY_CONTEXT" },
  contextBindingRef: { artifact_id: "binding-1", artifact_type: "project_context_binding" },
  geometryRef: { artifact_id: "geom-1", artifact_type: "CANONICAL_GEOMETRY" },
  propertyDesignation: "ORSA STACKMORA 3:12",
  propertyIdentity: "prop-1",
  municipality: "Orsa",
  coordinates: [1, 2] as const,
  geometry: { type: "Polygon" as const, coordinates: [] },
}));

vi.mock("@miljobeslut/mps-lu", async () => {
  const actual = await vi.importActual<typeof import("@miljobeslut/mps-lu")>("@miljobeslut/mps-lu");
  return {
    ...actual,
    CanonicalProjectContextReader: class {
      resolve = resolveMock;
      resolveCurrentBinding = vi.fn();
    },
  };
});

vi.mock("../../server/security/projectContextBindingIssuerKey", () => ({
  getProjectContextBindingIssuerVerifier: () => ({ keyId: "ed25519:test" }),
}));

vi.mock("../../server/repositories/projectContextBindingRepository", () => ({
  PrismaProjectContextBindingIndex: class {
    listBindingRefs = async () => [];
    listSupersessionRefs = async () => [];
  },
}));

vi.mock("../../server/modules/localization/projectContextBindingAuthorityPortAdapter", () => ({
  createProjectContextBindingAuthorityPort: () => ({
    verifyArtifactAuthority: async () => undefined,
    verifySupersessionAuthority: async () => undefined,
  }),
}));

vi.mock("../../server/modules/localization/projectContextBindingIndexPortAdapter", () => ({
  asProjectContextBindingIndexPort: (index: unknown) => index,
}));

describe("resolveCanonicalProjectContext product wrapper", () => {
  it("delegates to CanonicalProjectContextReader (one implementation)", async () => {
    const { resolveCanonicalProjectContext } = await import(
      "../../src/application/resolveCanonicalProjectContext"
    );
    const repo = { resolve: vi.fn() } as never;
    const result = await resolveCanonicalProjectContext("project-demo-1", repo);
    expect(resolveMock).toHaveBeenCalledWith("project-demo-1");
    expect(result.propertyDesignation).toBe("ORSA STACKMORA 3:12");
    expect(result.municipality).toBe("Orsa");
  });
});
