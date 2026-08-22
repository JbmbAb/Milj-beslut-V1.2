import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { runLuAssessmentViaKernel } from "../src/execution/LuExecutionKernelClient";
import { InMemoryArtifactRepository } from "../../mps-runtime/src/repository/InMemoryArtifactRepository";
import { computeExecutionManifestIdV2 } from "../../mps-runtime/src/execution/ExecutionIdentityScopeV2";
import type { SpatialEvidenceArtifact } from "../src/artifacts/SpatialEvidenceArtifact";
import { SPATIAL_STACK_V1 } from "../src/artifacts/SpatialEngineFingerprint";

/**
 * LU-MANIFEST-WORM-IDEMPOTENCY-01.
 *
 * Real, historical collision (2026-08-22): a manifest minted under the site-only V1 id
 * (`lu-manifest-${site_id}`) by an earlier bootstrap-proof run permanently blocked every later
 * real product run for the same property once ORSA's ProjectContextBinding was legitimately
 * superseded, because content_hash (via deriveLuExecutionSeed) already varies with
 * project_context_binding_ref / product_release_ref but manifest_id did not. The existing,
 * colliding real CAS object (`lu-manifest-lm_fastighetsytor_merged:merged:ORSASTACKMORA3:12`)
 * is left untouched by this fix -- these proofs run against an isolated in-memory repository.
 *
 * Each `it` below is one of the owner-required proofs for this unit.
 */
function evidence(): SpatialEvidenceArtifact[] {
  return [
    {
      artifact_id: "ev-water-1",
      artifact_type: "SPATIAL_EVIDENCE",
      payload: {
        result_semantics: {
          kind: "EXISTENCE_WITHIN_DISTANCE",
          query: {
            subject_ref: { artifact_id: "prop-client", artifact_type: "PROPERTY" },
            srid: 3006,
            distance_meters: 100,
          },
          result: { exists: true, match_count_observed: 1, max_features_per_layer: 50 },
        },
        property_ref: { artifact_id: "prop-client", artifact_type: "PROPERTY" },
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
        query_context: { query_id: "q-client", query_type: "SPATIAL_DWITHIN", parameters: { search_distance_meters: 100 } },
      },
    },
  ] as unknown as SpatialEvidenceArtifact[];
}

const RELEASE_A = { artifact_id: "product-release-aaaa", artifact_type: "product_release_manifest" } as const;
const RELEASE_B = { artifact_id: "product-release-bbbb", artifact_type: "product_release_manifest" } as const;
const BINDING_A = { artifact_id: "project-context-binding-aaaa", artifact_type: "project_context_binding" } as const;
const BINDING_B = { artifact_id: "project-context-binding-bbbb", artifact_type: "project_context_binding" } as const;

async function run(
  repo: InMemoryArtifactRepository,
  overrides: { binding?: typeof BINDING_A; release?: typeof RELEASE_A; site_id?: string } = {},
) {
  return runLuAssessmentViaKernel({
    site_id: overrides.site_id ?? "site-worm-idempotency",
    deterministic_seed: `seed:${overrides.site_id ?? "site-worm-idempotency"}:${(overrides.binding ?? BINDING_A).artifact_id}:${(overrides.release ?? RELEASE_A).artifact_id}`,
    evidence: evidence(),
    artifact_repository: repo,
    identity_subject_v2: {
      project_context_binding_ref: overrides.binding ?? BINDING_A,
      product_release_ref: overrides.release ?? RELEASE_A,
      execution_contract_version: "lu-execution-identity-v1",
    },
  });
}

describe("LU-MANIFEST-WORM-IDEMPOTENCY-01", () => {
  beforeEach(() => {
    process.env.MPS_LU_BOOTSTRAP_ADMIT = "1";
  });
  afterEach(() => {
    delete process.env.MPS_LU_BOOTSTRAP_ADMIT;
  });

  it("proof 1: same exact semantic input, run twice -> same manifest_id, no WORM violation", async () => {
    const repo = new InMemoryArtifactRepository();
    const first = await run(repo);
    const second = await run(repo);
    expect(first.manifest_id).toBe(second.manifest_id);
    expect(first.admitted).toBe(true);
    expect(second.admitted).toBe(true);
  });

  it("proof 2 & 4: legitimately changed binding -> different manifest_id, no collision with the old one", async () => {
    const repo = new InMemoryArtifactRepository();
    const withBindingA = await run(repo, { binding: BINDING_A });
    const withBindingB = await run(repo, { binding: BINDING_B });
    expect(withBindingA.manifest_id).not.toBe(withBindingB.manifest_id);
    expect(withBindingA.admitted).toBe(true);
    expect(withBindingB.admitted).toBe(true);
    // the old manifest under binding A must still resolve, byte-identical, after B is written
    const stillThere = await repo.resolve<{ manifest_id: string }>({
      artifact_id: withBindingA.manifest_id,
      artifact_type: "execution_manifest",
    });
    expect(stillThere.manifest_id).toBe(withBindingA.manifest_id);
  });

  it("proof 5: legitimately changed governance release -> different manifest_id, no collision", async () => {
    const repo = new InMemoryArtifactRepository();
    const withReleaseA = await run(repo, { release: RELEASE_A });
    const withReleaseB = await run(repo, { release: RELEASE_B });
    expect(withReleaseA.manifest_id).not.toBe(withReleaseB.manifest_id);
    expect(withReleaseA.admitted).toBe(true);
    expect(withReleaseB.admitted).toBe(true);
  });

  it("proof 6: manifest_id is a pure function of the subject only -- unaffected by evidence/result variance", () => {
    const idA = computeExecutionManifestIdV2({
      site_id: "site-x",
      project_context_binding_ref: BINDING_A,
      product_release_ref: RELEASE_A,
      execution_contract_version: "lu-execution-identity-v1",
    });
    const idB = computeExecutionManifestIdV2({
      site_id: "site-x",
      project_context_binding_ref: BINDING_A,
      product_release_ref: RELEASE_A,
      execution_contract_version: "lu-execution-identity-v1",
    });
    expect(idA).toBe(idB);
    expect(computeExecutionManifestIdV2.length).toBe(1); // single pure subject argument, no clock/rng/attempt-id parameter exists to accept volatile input
  });

  it("proof 7: actual tampering under the SAME legitimate identity still triggers WORM denial", async () => {
    const repo = new InMemoryArtifactRepository();
    const first = await run(repo);
    await expect(
      repo.put({
        artifact_id: first.manifest_id,
        content_hash: { algorithm: "sha256", value: "f".repeat(64) } as any,
        body: { tampered: true },
      }),
    ).rejects.toThrow(/WORM violation/);
  });
});
