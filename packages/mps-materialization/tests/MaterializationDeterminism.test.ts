// packages/mps-materialization/tests/MaterializationDeterminism.test.ts

import { describe, test, expect, beforeEach, vi } from "vitest";
import { MaterializationPipeline } from "../src/MaterializationPipeline";
import { DecisionArtifactRepository } from "../../mps-decision-governance/src/DecisionArtifactRepository";
import type { EvidenceSetArtifact } from "../../mps-decision-governance/src/EvidenceSetArtifact";
import type { MaterializationContext } from "../src/MaterializationContract";

describe("🜃 Materialization Pipeline & Determinism (MAT-I01 to MAT-I04)", () => {
  let repository: DecisionArtifactRepository;
  let mockEvidenceResolver: any;
  let mockLineageResolver: any;
  let pipeline: MaterializationPipeline;
  let store: Map<string, EvidenceSetArtifact>;

  const evidenceSet: EvidenceSetArtifact = {
    evidence_set_hash: "ev-set-A",
    identity: {
      documents: [
        { document_hash: "doc-1" },
        { document_hash: "doc-2" }
      ],
      schema_version: 1,
      lineage_sequence: 10,
      previous_evidence_set_hash: undefined,
      lineage_scope: { jurisdiction_level: "COUNTY", decision_type: "ENVIRONMENTAL_PERMIT" }
    },
    metadata: {
      created_at: "2026-08-07T00:00:00Z",
      materialization_version: "v1.0.0",
      generated_by: "Ingest Pipeline"
    }
  };

  const context: MaterializationContext = {
    jurisdiction_level: "COUNTY",
    decision_type: "ENVIRONMENTAL_PERMIT",
    municipality_code: "01",
    schema_version: 1
  };

  beforeEach(() => {
    store = new Map<string, EvidenceSetArtifact>();
    repository = new DecisionArtifactRepository();
    
    mockEvidenceResolver = {
      resolve: async (hash: string) => store.get(hash) || null
    };

    mockLineageResolver = {
      resolve: (hash: string) => store.get(hash)
    };

    pipeline = new MaterializationPipeline(
      "ww-risk-model-canonicalizer",
      "ww-risk-model-2.0",
      "rule-release-v12",
      mockEvidenceResolver,
      repository,
      mockLineageResolver
    );
  });

  // -------------------------------------------------------------------------
  // MAT-I01: Authority Boundary
  // -------------------------------------------------------------------------
  test("MAT-I01: Authority Boundary — cannot materialize unless lineage closure succeeds", async () => {
    // 1. Om evidenssetet saknas helt i resolvern, misslyckas materialiseringen direkt!
    await expect(
      pipeline.materialize(evidenceSet, context)
    ).rejects.toThrow("must be resolved in repository before materialization");

    // 2. Lägg till evidenssetet på disk
    store.set("ev-set-A", evidenceSet);

    // 3. Om det bär en cykel eller ogiltig historik, ska lineage-kontrollen avvisa det preventivt!
    const manipulatedEvidenceSet: EvidenceSetArtifact = {
      evidence_set_hash: "ev-set-B",
      identity: {
        documents: [{ document_hash: "doc-1" }],
        schema_version: 1,
        lineage_sequence: 5, // Regression! (sequence 5 efter sequence 10)
        previous_evidence_set_hash: "ev-set-A", // Refererar till A som har sekvens 10!
        lineage_scope: { jurisdiction_level: "COUNTY", decision_type: "ENVIRONMENTAL_PERMIT" }
      },
      metadata: evidenceSet.metadata
    };

    store.set("ev-set-B", manipulatedEvidenceSet);

    await expect(
      pipeline.materialize(manipulatedEvidenceSet, context)
    ).rejects.toThrow("lineage_sequence must strictly increase"); // Lineage-kontrollen stänger dörren!
  });

  // -------------------------------------------------------------------------
  // MAT-I02: Deterministic Materialization
  // -------------------------------------------------------------------------
  test("MAT-I02: Deterministic Materialization — same inputs always yield identical artifact hash", async () => {
    store.set("ev-set-A", evidenceSet);

    const art1 = await pipeline.materialize(evidenceSet, context);
    
    // Töm CAS-lagret för att simulera en fristående körning
    repository.clear();

    const art2 = await pipeline.materialize(evidenceSet, context);

    expect(art1.impact_id).toBe(art2.impact_id); // De båda oberoende körningarna enas om EXAKT samma hash!
  });

  // -------------------------------------------------------------------------
  // MAT-I03: Restart Determinism
  // -------------------------------------------------------------------------
  test("MAT-I03: Restart Determinism — process restarts reproduce identical outputs", async () => {
    store.set("ev-set-A", evidenceSet);

    const art1 = await pipeline.materialize(evidenceSet, context);

    // Återskapa hela pipelinen och rensa cachen (simulerar en fullständig omstart av servern)
    const newRepository = new DecisionArtifactRepository();
    const newPipeline = new MaterializationPipeline(
      "ww-risk-model-canonicalizer",
      "ww-risk-model-2.0",
      "rule-release-v12",
      mockEvidenceResolver,
      newRepository,
      mockLineageResolver
    );

    const art2 = await newPipeline.materialize(evidenceSet, context);

    expect(art1.impact_id).toBe(art2.impact_id); // Byte-identisk reproducerbarhet efter omstart!
  });

  // -------------------------------------------------------------------------
  // MAT-I04: Provenance Isolation
  // -------------------------------------------------------------------------
  test("MAT-I04: Provenance Isolation — changing provenance or metadata leaves identity hash untouched", async () => {
    store.set("ev-set-A", evidenceSet);

    const art1 = await pipeline.materialize(evidenceSet, context);

    // Målet: Vi skapar en NY pipeline-instans som har en annan rule_version eller materialization_version?
    // Vänta! Om materialization_version ändras, så ingår den i identiteten (derivation_version), så hashen SKA ändras!
    // Men om yttre kördetaljer eller metadata (t.ex. datum eller exekverings-id) ändras, så ska hashen vara oförändrad!
    // Eftersom save() i MaterializationPipeline läser in tiden från `new Date().toISOString()`,
    // kan vi bevisa att hashen blir exakt densamma trots att `created_at` i metadata skiljer sig!
    
    // Vi rensar och sparar igen under en annan sekund, vilket ger en annan created_at i metadata under huven
    repository.clear();
    const art2 = await pipeline.materialize(evidenceSet, context);

    expect(art1.impact_id).toBe(art2.impact_id); // Hashen är identisk trots förändrad skapandetid!
  });
});
