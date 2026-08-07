/**
 * MAT-I05 — Single Materialization Authority (Commit H.4)
 *
 * Only registered MaterializationPipeline implementations may create
 * DecisionImpactArtifact authority. Everything else is projection.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CanonicalizerRegistry } from "../../alpha-runtime/src/recovery/CanonicalizerRegistry";
import {
  assertSingleMaterializationAuthority,
  CANONICAL_MATERIALIZATION_AUTHORITY,
  isRegisteredMaterializationAuthority,
  listMaterializationAuthorities,
  MaterializationAuthorityError,
  registerMaterializationAuthority,
} from "../src/index.js";

const RUNTIME = join(__dirname, "../../alpha-runtime/src");

function runtimeSource(relative: string): string {
  return readFileSync(join(RUNTIME, relative), "utf8");
}

function violationCodeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (e) {
    return (e as MaterializationAuthorityError).code;
  }
  return undefined;
}

describe("MAT-I05: only one registered authority may create Decision Truth", () => {
  it("the canonical pipeline is the sole registered authority", () => {
    expect(listMaterializationAuthorities()).toEqual([CANONICAL_MATERIALIZATION_AUTHORITY]);
    expect(isRegisteredMaterializationAuthority("MaterializationPipeline")).toBe(true);
  });

  it("unregistered producers are rejected at the write boundary", () => {
    for (const actor of ["MaterializerJob", "ArtifactProjectionBuilder", "Runtime", undefined]) {
      expect(() => assertSingleMaterializationAuthority(actor)).toThrow(
        MaterializationAuthorityError,
      );
      expect(violationCodeOf(() => assertSingleMaterializationAuthority(actor))).toBe(
        "MAT_I05_UNREGISTERED_AUTHORITY",
      );
    }
  });

  it("adding a truth producer requires an ADR and cannot silently take an existing id", () => {
    expect(
      violationCodeOf(() =>
        registerMaterializationAuthority({
          id: "SomeOtherPipeline",
          package: "alpha-runtime",
          adr: "",
        }),
      ),
    ).toBe("MAT_I05_UNDOCUMENTED_AUTHORITY");

    expect(
      violationCodeOf(() =>
        registerMaterializationAuthority({
          id: CANONICAL_MATERIALIZATION_AUTHORITY.id,
          package: "alpha-runtime",
          adr: "ADR-SOMETHING",
        }),
      ),
    ).toBe("MAT_I05_AUTHORITY_CONFLICT");

    expect(listMaterializationAuthorities()).toEqual([CANONICAL_MATERIALIZATION_AUTHORITY]);
  });

  it("the runtime decision repository gates both write paths", () => {
    const source = runtimeSource("recovery/DecisionArtifactRepository.ts");

    expect(source).toContain("assertSingleMaterializationAuthority");
    expect(source.match(/assertSingleMaterializationAuthority\(authority\)/g)).toHaveLength(2);
  });
});

describe("MAT-I05: runtime builds projections, not Decision Truth", () => {
  it("the projection builder cannot create decision artifacts", async () => {
    const { ArtifactProjectionBuilder } = await import(
      "../../alpha-runtime/src/runtime/ArtifactProjectionBuilder"
    );

    expect(
      (ArtifactProjectionBuilder as unknown as Record<string, unknown>)
        .createDecisionImpactArtifact,
    ).toBeUndefined();
    expect(ArtifactProjectionBuilder.prototype.project).toBeTypeOf("function");
    expect(
      (ArtifactProjectionBuilder.prototype as unknown as Record<string, unknown>).materialize,
    ).toBeUndefined();
  });

  it("runtime projection sources never mention Decision Truth artifacts", () => {
    const sources = [
      "runtime/ArtifactProjectionBuilder.ts",
      "runtime/DeterministicRuntimeScheduler.ts",
      "recovery/CanonicalIdentityProvider.ts",
    ];

    for (const relative of sources) {
      const source = runtimeSource(relative);
      // Mentions in the MAT-I05 doc block are allowed; code that builds them is not.
      const code = source.replace(/\/\*\*[\s\S]*?\*\//g, "");
      expect(code).not.toContain("DecisionImpactArtifact");
      expect(code).not.toContain("EvidenceAuthority");
      expect(code).not.toContain("MaterializedTruth");
    }
  });
});

describe("MAT-I05: the canonical version namespace has one owner", () => {
  it("runtime cannot resolve a governance-owned canonicalizer", () => {
    expect(() => CanonicalizerRegistry.get("dg-canonical-1")).toThrowError(
      "CANONICALIZER_NAMESPACE_VIOLATION",
    );
    expect(() =>
      CanonicalizerRegistry.generateIdentityHash("dg-canonical-1", { a: 1 }),
    ).toThrowError("CANONICALIZER_NAMESPACE_VIOLATION");
  });

  it("runtime canonicalizers are runtime-owned", () => {
    expect(CanonicalizerRegistry.get("runtime-projection-1").status).toBe("ACTIVE");
    expect(() => CanonicalizerRegistry.get("runtime-projection-99")).toThrowError(
      "UNKNOWN_CANONICALIZER",
    );
  });
});
