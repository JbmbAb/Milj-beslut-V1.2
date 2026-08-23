import { afterEach, beforeEach, describe, it, expect } from "vitest";
import {
  runLuAssessmentViaKernel,
  runCanonicalLuProductAssessment,
  type CanonicalLuKernelRunInput,
} from "../src/execution/LuExecutionKernelClient";
import { InMemoryArtifactRepository } from "../../mps-runtime/src/repository/InMemoryArtifactRepository";
import type { SpatialEvidenceArtifact } from "../src/artifacts/SpatialEvidenceArtifact";
import { SPATIAL_STACK_V1 } from "../src/artifacts/SpatialEngineFingerprint";

/**
 * ASSESSMENT-RELEASE-BINDING-RECON-01 Phase B, part A.
 *
 * LU-MANIFEST-WORM-IDEMPOTENCY-01 already proved release-scoping one layer down, at
 * `manifest_id`. This proves the property the recon actually asked about: holding
 * binding/geometry/evidence_refs/rule_refs constant, do two different ProductRelease artifacts
 * produce two DIFFERENT `LocalizationAssessmentArtifact.content_hash`/`artifact_id`?
 *
 * They must, and this proves it directly against the assessment artifact itself, not just the
 * manifest it's derived from -- via the real, unmodified propagation chain:
 * product_release_ref -> manifest_id -> attempt_id -> outcome_id -> execution_outcome_ref ->
 * assessment content_hash. No schema change was made to LocalizationAssessmentArtifact to make
 * this pass -- the property already held; this closes the recon by proving it where it was only
 * inferred before.
 */
function evidence(): SpatialEvidenceArtifact[] {
  return [
    {
      artifact_id: "ev-water-release-binding-proof",
      artifact_type: "SPATIAL_EVIDENCE",
      payload: {
        result_semantics: {
          kind: "EXISTENCE_WITHIN_DISTANCE",
          query: {
            subject_ref: { artifact_id: "prop-release-binding-proof", artifact_type: "PROPERTY" },
            srid: 3006,
            distance_meters: 100,
          },
          result: { exists: true, match_count_observed: 1, max_features_per_layer: 50 },
        },
        property_ref: { artifact_id: "prop-release-binding-proof", artifact_type: "PROPERTY" },
        source_metadata: {
          provider: "SGU",
          dataset: "water",
          dataset_version: "2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc",
          retrieved_at: "2026-08-13T08:00:00.000Z",
        },
        geometry: null,
        srid: 3006,
        operation: {
          algorithm: "spatial.dwithin_existence",
          engine: "PostGIS",
          engine_fingerprint: SPATIAL_STACK_V1,
        },
        layer_ref: { layer_id: "water", version_hash: "2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc", layer_version: "v1" },
        query_context: { query_id: "q-release-binding-proof", query_type: "SPATIAL_DWITHIN", parameters: { search_distance_meters: 100 } },
      },
    },
  ] as unknown as SpatialEvidenceArtifact[];
}

// Held CONSTANT across both runs -- the recon question's exact precondition.
const BINDING = { artifact_id: "project-context-binding-release-proof", artifact_type: "project_context_binding" } as const;
const GEOMETRY_REF = { artifact_id: "localization-geometry-release-proof", artifact_type: "localization_geometry" } as const;
const PROJECT_CONTEXT_REF = { artifact_id: "lu-project-context-release-proof", artifact_type: "LU_PROJECT_CONTEXT" } as const;
const PROPERTY_REF = { artifact_id: "prop-release-binding-proof", artifact_type: "PROPERTY" } as const;
const EVIDENCE_REFS = [{ artifact_id: "ev-water-release-binding-proof", artifact_type: "SPATIAL_EVIDENCE" }] as const;

const RELEASE_A = { artifact_id: "product-release-release-proof-a", artifact_type: "product_release_manifest" } as const;
const RELEASE_B = { artifact_id: "product-release-release-proof-b", artifact_type: "product_release_manifest" } as const;

async function runWithRelease(repo: InMemoryArtifactRepository, release: { artifact_id: string; artifact_type: string }) {
  return runLuAssessmentViaKernel({
    site_id: "site-release-binding-proof",
    deterministic_seed: `seed:release-binding-proof:${release.artifact_id}`,
    evidence: evidence(),
    artifact_repository: repo,
    identity_subject_v3: {
      project_context_binding_ref: BINDING,
      product_release_ref: release,
      execution_contract_version: "lu-execution-identity-v1",
      localization_geometry_ref: GEOMETRY_REF,
    },
    // Held constant across both runs -- only `release` varies.
    assessment_draft: {
      site_id: "site-release-binding-proof",
      project_context_ref: PROJECT_CONTEXT_REF,
      property_ref: PROPERTY_REF,
      evidence_refs: EVIDENCE_REFS,
      system_summary: "release-binding-proof assessment, content identical across both runs",
      localization_geometry_ref: GEOMETRY_REF,
    },
  });
}

describe("ASSESSMENT-RELEASE-BINDING-RECON-01", () => {
  beforeEach(() => {
    process.env.MPS_LU_BOOTSTRAP_ADMIT = "1";
  });
  afterEach(() => {
    delete process.env.MPS_LU_BOOTSTRAP_ADMIT;
  });

  it("same binding/geometry/evidence_refs/rule_refs, two different releases -> two distinct assessment identities", async () => {
    const repoA = new InMemoryArtifactRepository();
    const repoB = new InMemoryArtifactRepository();
    const withReleaseA = await runWithRelease(repoA, RELEASE_A);
    const withReleaseB = await runWithRelease(repoB, RELEASE_B);

    expect(withReleaseA.admitted).toBe(true);
    expect(withReleaseB.admitted).toBe(true);
    expect(withReleaseA.assessment).not.toBeNull();
    expect(withReleaseB.assessment).not.toBeNull();

    // The chain this actually depends on: different release -> different manifest -> different
    // outcome -> different execution_outcome_ref on the assessment -- proven at every link, not
    // just asserted at the end.
    expect(withReleaseA.manifest_id).not.toBe(withReleaseB.manifest_id);
    expect(withReleaseA.outcome_id).not.toBe(withReleaseB.outcome_id);
    expect(withReleaseA.assessment!.payload.execution_outcome_ref.artifact_id).not.toBe(
      withReleaseB.assessment!.payload.execution_outcome_ref.artifact_id,
    );

    // The property the recon question actually asked about: the assessment artifact's own
    // identity diverges too -- release identity reaches it, indirectly, through the chain above.
    expect(withReleaseA.assessment!.artifact_id).not.toBe(withReleaseB.assessment!.artifact_id);
    expect(withReleaseA.assessment!.content_hash.value).not.toBe(withReleaseB.assessment!.content_hash.value);

    // Everything else about the two assessments' semantic content is identical -- the divergence
    // is caused by the release, not by an incidental difference elsewhere in the draft.
    expect(withReleaseA.assessment!.payload.project_context_ref).toEqual(withReleaseB.assessment!.payload.project_context_ref);
    expect(withReleaseA.assessment!.payload.property_ref).toEqual(withReleaseB.assessment!.payload.property_ref);
    expect(withReleaseA.assessment!.payload.evidence_refs).toEqual(withReleaseB.assessment!.payload.evidence_refs);
    expect(withReleaseA.assessment!.payload.rule_refs).toEqual(withReleaseB.assessment!.payload.rule_refs);
    expect(withReleaseA.assessment!.payload.localization_geometry_ref).toEqual(withReleaseB.assessment!.payload.localization_geometry_ref);
  });

  it("same release, run twice -> same assessment identity (WORM reuse, not a fresh mint)", async () => {
    const repo = new InMemoryArtifactRepository();
    const first = await runWithRelease(repo, RELEASE_A);
    const second = await runWithRelease(repo, RELEASE_A);
    expect(first.assessment!.artifact_id).toBe(second.assessment!.artifact_id);
    expect(first.assessment!.content_hash.value).toBe(second.assessment!.content_hash.value);
  });

  it("runCanonicalLuProductAssessment (the real product entrypoint) requires identity_subject_v3 and produces the same manifest_id as the general engine given the same subject", async () => {
    const repo = new InMemoryArtifactRepository();
    const viaGeneral = await runWithRelease(repo, RELEASE_A);
    const canonicalRepo = new InMemoryArtifactRepository();
    const viaCanonical = await runCanonicalLuProductAssessment({
      site_id: "site-release-binding-proof",
      deterministic_seed: `seed:release-binding-proof:${RELEASE_A.artifact_id}`,
      evidence: evidence(),
      artifact_repository: canonicalRepo,
      identity_subject_v3: {
        project_context_binding_ref: BINDING,
        product_release_ref: RELEASE_A,
        execution_contract_version: "lu-execution-identity-v1",
        localization_geometry_ref: GEOMETRY_REF,
      },
    });
    expect(viaCanonical.manifest_id).toBe(viaGeneral.manifest_id);
  });
});

/**
 * ASSESSMENT-RELEASE-BINDING-RECON-01 Phase B, part B -- executable contract, not a comment.
 *
 * This block is never run (see the early `return` -- vitest still type-checks the file body
 * during `tsc --noEmit`, which is what actually enforces this). If `identity_subject_v3` were
 * ever loosened back to optional on `CanonicalLuKernelRunInput`, the `@ts-expect-error` below
 * would itself become a type error ("Unused '@ts-expect-error' directive"), failing the build --
 * the contract is checked by the compiler, not by a human remembering to look for the comment.
 */
function __typeContract_canonicalRequiresIdentitySubjectV3(): void {
  return;
  // eslint-disable-next-line no-unreachable
  const withoutSubject: Omit<CanonicalLuKernelRunInput, "identity_subject_v3"> = null as never;
  // @ts-expect-error -- identity_subject_v3 is mandatory on CanonicalLuKernelRunInput; omitting
  // it must be a compile error, never a silent runtime fallback to the legacy manifest shape.
  void runCanonicalLuProductAssessment(withoutSubject);
}
void __typeContract_canonicalRequiresIdentitySubjectV3;
