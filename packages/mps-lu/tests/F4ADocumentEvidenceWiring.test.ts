import { describe, it, expect } from "vitest";

import {
  createLuRuleEngineInvokeHandler,
  runLuAssessmentViaKernel,
} from "../src/execution/LuExecutionKernelClient";
import { LURuleEngine, type LURuleEvaluationInput } from "../src/rules/LURuleEngine";
import type { SpatialEvidenceArtifact } from "../src/artifacts/SpatialEvidenceArtifact";
import { SPATIAL_STACK_V1 } from "../src/artifacts/SpatialEngineFingerprint";
import type { DocumentEvidenceArtifact } from "../src/artifacts/DocumentEvidenceArtifact";

/**
 * ✅ F4A — WIRING GREEN PROOF.
 *
 *   Invariant under test:
 *     F4A — Document evidence SHALL reach rule evaluation through BOTH kernel entrypoints.
 *
 *   THIS PROVES THE TRANSPORT CONTRACT, NOT RULE LOGIC.
 *   F4A introduces no rule predicates. `LU-DOC-BESLUT-001` is F4B and is blocked on an owner
 *   decision about which legal fact it represents.
 *
 *   ⚠️ ACCEPTANCE CRITERION IS NOT "2 findings".
 *   `LUEndToEnd.test.ts:71` and `VerticalProof.test.ts:84` expect two findings and REMAIN RED
 *   after F4A. That is correct and expected — the rule engine still produces only
 *   LU-WATER-001. Judging F4A against those tests would be the wrong criterion.
 *
 *   Why a spy engine is legitimate here: it is injected by monkey-patching
 *   `LURuleEngine.prototype.evaluate`, so the call still travels the REAL kernel entrypoints
 *   and the real production wiring. The spy observes the transport boundary; it does not
 *   replace the path under test. (Same discipline as A1: measure on the real composition
 *   root, not on a hand-built stand-in.)
 *
 *   @see docs/architecture/F4A-IMPACT-MAP-2026-08-12.md
 *   @see docs/architecture/F0C-LU-DEFECT-TRACE-2026-08-12.md  (F4, cause A)
 *   @see docs/architecture/ADR-28-LU-Definition-Scope.md      (§3 Evidence → Rules → Findings)
 */
describe("F4A — document evidence reaches rule evaluation (WIRING GREEN PROOF)", () => {
  function spatialEvidence(id: string): SpatialEvidenceArtifact {
    return {
      artifact_id: id,
      artifact_type: "SPATIAL_EVIDENCE",
      content_hash: { algorithm: "sha256", value: `hash-${id}` },
      references: [{ artifact_id: "prop-f4a", artifact_type: "PROPERTY" }],
      payload: {
        result_semantics: {
          kind: "EXISTENCE_WITHIN_DISTANCE",
          query: {
            subject_ref: { artifact_id: "prop-f4a", artifact_type: "PROPERTY" },
            srid: 3006,
            distance_meters: 100,
          },
          result: { exists: true, match_count_observed: 1, max_features_per_layer: 50 },
        },
        property_ref: { artifact_id: "prop-f4a", artifact_type: "PROPERTY" },
        geometry: null,
        srid: 3006,
        operation: {
          algorithm: "spatial.dwithin_existence",
          engine: "PostGIS",
          engine_fingerprint: SPATIAL_STACK_V1,
        },
        layer_ref: {
          layer_id: "water",
          version_hash: "2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc",
          layer_version: "v1",
        },
        source_metadata: {
          provider: "SGU",
          dataset: "water",
          dataset_version: "2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc",
          retrieved_at: new Date().toISOString(),
        },
        query_context: {
          query_id: "q-f4a",
          query_type: "SPATIAL_DWITHIN",
          parameters: {
            property_ref: { artifact_id: "prop-f4a", artifact_type: "PROPERTY" },
            search_distance_meters: 100,
          },
        },
      },
    } as unknown as SpatialEvidenceArtifact;
  }

  function documentEvidence(id: string): DocumentEvidenceArtifact {
    return {
      artifact_id: id,
      artifact_type: "DOCUMENT_EVIDENCE",
      content_hash: { algorithm: "sha256", value: `hash-${id}` },
      payload: {
        property_ref: { artifact_id: "prop-f4a", artifact_type: "PROPERTY" },
        document_ref: { artifact_id: "doc-f4a", artifact_type: "DOCUMENT" },
        // F4B-0A — conforms to the frozen RelevantDocument contract (description only).
        relevant_document: {
          title: "doc-f4a",
          type: "decision",
          metadata: { source_url: "file:///f4a/beslut.txt", authority: "Länsstyrelsen" },
        },
        source_metadata: { provider: "Länsstyrelsen", retrieved_at: new Date().toISOString() },
        raw_source_ref: { artifact_id: "raw-f4a", artifact_type: "RAW_SOURCE_ARTIFACT" },
      },
    } as unknown as DocumentEvidenceArtifact;
  }

  /** Records every evaluation input while keeping the real engine behaviour. */
  function spyOnRuleEngine(): { inputs: LURuleEvaluationInput[]; restore: () => void } {
    const inputs: LURuleEvaluationInput[] = [];
    const original = LURuleEngine.prototype.evaluate;
    LURuleEngine.prototype.evaluate = function (input: LURuleEvaluationInput) {
      inputs.push(input);
      return original.call(this, input);
    };
    return { inputs, restore: () => { LURuleEngine.prototype.evaluate = original; } };
  }

  it("kernel path A — createLuRuleEngineInvokeHandler delivers document_evidence to the rule engine", async () => {
    const spy = spyOnRuleEngine();
    try {
      const docs = [documentEvidence("doc_ev_path_a")];
      const handler = createLuRuleEngineInvokeHandler([spatialEvidence("spatial-a")], docs);

      await handler([]);

      expect(
        spy.inputs,
        "F4A: the invoke handler must call the rule engine exactly once.",
      ).toHaveLength(1);

      expect(
        spy.inputs[0].document_evidence,
        "F4A: kernel path A must deliver document_evidence to the rule engine. An empty array " +
          "here means the transport still drops document evidence (F0C, F4 cause A).",
      ).toHaveLength(1);

      expect(spy.inputs[0].document_evidence[0].artifact_id).toBe("doc_ev_path_a");
      expect(spy.inputs[0].spatial_evidence).toHaveLength(1);
    } finally {
      spy.restore();
    }
  });

  it("kernel path B — runLuAssessmentViaKernel delivers document_evidence to the rule engine", async () => {
    const spy = spyOnRuleEngine();
    try {
      await runLuAssessmentViaKernel({
        site_id: "f4a-site",
        deterministic_seed: "seed:f4a",
        evidence: [spatialEvidence("spatial-b")],
        document_evidence: [documentEvidence("doc_ev_path_b")],
      });

      expect(
        spy.inputs.length,
        "F4A: the kernel run must reach rule evaluation at least once.",
      ).toBeGreaterThan(0);

      const delivered = spy.inputs.some(
        (i) => i.document_evidence.some((d) => d.artifact_id === "doc_ev_path_b"),
      );

      expect(
        delivered,
        "F4A: kernel path B (runLuAssessmentViaKernel) must deliver document_evidence to the " +
          "rule engine. Before F4A this path called engine.evaluate(input.evidence) and dropped " +
          "document evidence entirely. Fixing only path A would leave F4 partially broken and " +
          "make the outcome depend on which path executes.",
      ).toBe(true);
    } finally {
      spy.restore();
    }
  });

  it("omitting document_evidence normalizes to an empty array, never undefined", async () => {
    const spy = spyOnRuleEngine();
    try {
      await runLuAssessmentViaKernel({
        site_id: "f4a-site-no-docs",
        deterministic_seed: "seed:f4a-no-docs",
        evidence: [spatialEvidence("spatial-c")],
      });

      expect(spy.inputs.length).toBeGreaterThan(0);
      for (const input of spy.inputs) {
        expect(
          Array.isArray(input.document_evidence),
          "F4A: document_evidence must always be an array so rules never branch on undefined.",
        ).toBe(true);
        expect(input.document_evidence).toHaveLength(0);
      }
    } finally {
      spy.restore();
    }
  });

  it("document evidence with no verified fact produces no document finding", () => {
    // Was an F4A scope guard ("no document rule may exist yet"). F4B has since implemented
    // LU-DOC-BESLUT-001, and this assertion is deliberately kept UNCHANGED: the fixture carries
    // type "decision" and no fact_refs, so it now proves the negative case instead — document
    // class alone never yields a finding. See F4BDocumentRule.test.ts for the full predicate.
    const engine = new LURuleEngine();
    const findings = engine.evaluate({
      spatial_evidence: [spatialEvidence("spatial-scope")],
      document_evidence: [documentEvidence("doc_ev_scope")],
    });

    expect(
      findings.map((f) => f.rule_id),
      "LU-DOC-BESLUT-001 requires a VERIFIED_DOCUMENT_FACT. Firing without one would mean the " +
        "rule is predicating on document class or text again.",
    ).toEqual(["LU-WATER-001"]);

    for (const f of findings) {
      for (const ref of f.evidence_refs) {
        expect(
          typeof ref.artifact_id === "string" && ref.artifact_id.length > 0,
          "F4A: findings must bind evidence by artifact reference, never loose document text.",
        ).toBe(true);
      }
    }
  });
});
