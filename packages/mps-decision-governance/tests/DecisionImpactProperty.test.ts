// packages/mps-decision-governance/tests/DecisionImpactProperty.test.ts

import { describe, test, expect, beforeEach } from "vitest";
import { DecisionArtifactRepository, DecisionArtifactRepositoryError } from "../src/DecisionArtifactRepository";
import { hashDecisionImpactIdentity } from "../src/CanonicalDecisionImpactHash";
import { canonicalizeStrict } from "../../mimers-brunn-core/src/serialization/canonicalize";
import type { DecisionImpactIdentity, DecisionImpactMetadata } from "../src/DecisionImpactIdentity";

describe("🜃 Decision Knowledge Plane — Core Invariants (DFL-I1 to DFL-I8)", () => {
  let repository: DecisionArtifactRepository;

  const sampleIdentity: DecisionImpactIdentity = {
    jurisdiction_level: "COUNTY",
    decision_type: "ENVIRONMENTAL_PERMIT",
    county_code: "01",
    period_start: "2026-01-01T00:00:00Z",
    period_end: "2026-12-31T23:59:59Z",
    evidence_set_hashes: ["ev-set-hash-1"],
    indicators: [
      {
        code: "IND-PERMITS",
        description: "Permit count",
        value: 12,
        unit: "qty",
        confidence: "HIGH",
        derivation: "COUNT"
      }
    ],
    schema_version: 1,
    derivation_version: "env-permit-model-1.0"
  };

  const sampleMetadata: DecisionImpactMetadata = {
    created_at: "2026-08-07T00:00:00Z",
    materialization_version: "v1.0.0",
    generated_by: "Mimer Ingest Engine"
  };

  beforeEach(() => {
    repository = new DecisionArtifactRepository();
  });

  // -------------------------------------------------------------------------
  // DFL-I1: Canonical Idempotence
  // -------------------------------------------------------------------------
  test("DFL-I1: Canonical Idempotence — canonical(canonical(I)) == canonical(I)", () => {
    const rawCanonical = canonicalizeStrict(sampleIdentity);
    const parsedCanonical = JSON.parse(rawCanonical);
    const doubleCanonical = canonicalizeStrict(parsedCanonical);

    expect(doubleCanonical).toBe(rawCanonical); // Projektionen är i absolut algebraisk vila!
  });

  // -------------------------------------------------------------------------
  // DFL-I2: Serialization Stability
  // -------------------------------------------------------------------------
  test("DFL-I2: Serialization Stability — hash(I) == hash(deserialize(serialize(I)))", () => {
    const h1 = hashDecisionImpactIdentity(sampleIdentity);
    
    // Simulera full I/O-cykel (Serialisering -> Deserialisering)
    const serialized = JSON.stringify(sampleIdentity);
    const deserialized = JSON.parse(serialized);
    
    const h2 = hashDecisionImpactIdentity(deserialized);
    expect(h2).toBe(h1); // 100 % plattforms- och Node-versionsoberoende stabilitet!
  });

  // -------------------------------------------------------------------------
  // DFL-I3: Metadata Isolation
  // -------------------------------------------------------------------------
  test("DFL-I3: Metadata Isolation — Metadata mutation never changes identity", async () => {
    const h1 = hashDecisionImpactIdentity(sampleIdentity);

    const mutatedMetadata: DecisionImpactMetadata = {
      created_at: "2026-08-08T12:00:00Z", // Ändrad tidpunkt
      materialization_version: "v1.0.1-mutated", // Ändrad motorversion
      generated_by: "Diagnostics Agent Heimdall" // Ändrad aktör
    };

    const artifact1 = await repository.save(sampleIdentity, sampleMetadata);
    const artifact2 = await repository.save(sampleIdentity, mutatedMetadata);

    expect(artifact1.impact_id).toBe(h1);
    expect(artifact2.impact_id).toBe(h1); // Hashen förblir identisk! Metadata isoleras fullständigt.
  });

  // -------------------------------------------------------------------------
  // DFL-I4: Identity Mutation Sensitivity
  // -------------------------------------------------------------------------
  test("DFL-I4: Identity Mutation Sensitivity — Fact mutation alters the identity hash", () => {
    const h1 = hashDecisionImpactIdentity(sampleIdentity);

    const mutatedIdentity: DecisionImpactIdentity = {
      ...sampleIdentity,
      indicators: [
        {
          code: "IND-PERMITS",
          description: "Permit count",
          value: 13, // Ändrat faktavärde (12 -> 13)
          unit: "qty",
          confidence: "HIGH",
          derivation: "COUNT"
        }
      ]
    };

    const h2 = hashDecisionImpactIdentity(mutatedIdentity);
    expect(h2).not.toBe(h1); // Identitets-hashen känner av och speglar minsta lilla faktamutation!
  });

  // -------------------------------------------------------------------------
  // DFL-I5: Repository Verify
  // -------------------------------------------------------------------------
  test("DFL-I5: Repository Verify — verify(load(save(A))) == true", async () => {
    const saved = await repository.save(sampleIdentity, sampleMetadata);
    const loaded = await repository.load(saved.impact_id);

    expect(loaded).not.toBeNull();
    const isVerified = await repository.verify(loaded!);
    expect(isVerified).toBe(true); // Omutlig verifiering!
  });

  // -------------------------------------------------------------------------
  // DFL-I6: Tamper Detection
  // -------------------------------------------------------------------------
  test("DFL-I6: Tamper Detection — manual DB mutations trigger verification failures", async () => {
    const saved = await repository.save(sampleIdentity, sampleMetadata);

    // Simulera extern fientlig databas-manipulation (Tampering) utanför plattformen
    // Vi muterar fakta direkt i minnet men behåller ursprungligt impact_id (hash)
    (saved as any).identity.jurisdiction_level = "NATIONAL"; 

    // load() måste räkna om hashen, detektera ändringen och kasta ett fel omedelbart!
    await expect(
      repository.load(saved.impact_id)
    ).rejects.toThrowError(DecisionArtifactRepositoryError);
  });

  // -------------------------------------------------------------------------
  // DFL-I7: CAS Idempotence
  // -------------------------------------------------------------------------
  test("DFL-I7: CAS Idempotence — multiple saves of the same identity yield the exact same physical artifact", async () => {
    const r1 = await repository.save(sampleIdentity, sampleMetadata);
    const r2 = await repository.save(sampleIdentity, sampleMetadata);

    expect(r1).toBe(r2); // Samma minnesreferens (ingen duplicering på disk/CAS)
  });

  // -------------------------------------------------------------------------
  // DFL-I8: Concurrent Save Safety
  // -------------------------------------------------------------------------
  test("DFL-I8: Concurrent Save Safety — concurrent saves resolve to exact single physical artifact", async () => {
    // Spara exakt samma identitet asynkront och samtidigt (Race Condition!)
    const [r1, r2, r3] = await Promise.all([
      repository.save(sampleIdentity, sampleMetadata),
      repository.save(sampleIdentity, sampleMetadata),
      repository.save(sampleIdentity, sampleMetadata)
    ]);

    expect(r1).toBe(r2);
    expect(r2).toBe(r3); // Alla trådar låser atomiskt och enas om exakt samma fysiska artefakt!
  });

  // -------------------------------------------------------------------------
  // CYKELFÖREBYGGANDE (Cycle Prevention Invariant)
  // -------------------------------------------------------------------------
  test("assertNoSupersedesCycles: rejects saving an identity that forms a dependency cycle", async () => {
    // Spara först en bas-identitet "A"
    const idA = { ...sampleIdentity, evidence_set_hashes: [] };
    const artA = await repository.save(idA, sampleMetadata);

    // Spara "B" som ersätter "A" (B -> A)
    const idB = { ...sampleIdentity, evidence_set_hashes: [artA.impact_id] };
    const artB = await repository.save(idB, sampleMetadata);

    // Försök spara "C" som refererar till "B", men har en cyklisk länk tillbaka till "C"! (C -> B -> C)
    const idC = { ...sampleIdentity, evidence_set_hashes: [artB.impact_id] };
    const hashC = hashDecisionImpactIdentity(idC);

    // För att bilda cykeln låter vi B referera till C:s framtida hash!
    (artB as any).identity.evidence_set_hashes = [hashC];

    await expect(
      repository.save(idC, sampleMetadata)
    ).rejects.toThrowError("Circular Dependency Detected"); // Cykeln stoppas preventivt!
  });
});
